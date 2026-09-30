import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import OpenAI from 'openai';
import { AIEngine } from '../../src/core/engines/ai.engine';

jest.mock('openai');

const OpenAIMock = OpenAI as unknown as jest.MockedClass<typeof OpenAI>;

describe('AIEngine', () => {
  const originalAiEndpoint = process.env.AI_ENDPOINT;
  const originalEnv = process.env;
  let createMock: any;

  beforeEach(() => {
    process.env = { ...originalEnv, AI_ENDPOINT: 'https://example.ai/openai/v1' };
    createMock = jest.fn();
    OpenAIMock.mockImplementation(() => ({
      chat: {
        completions: {
          create: createMock,
        },
      },
    } as any));
  });

  afterEach(() => {
    process.env = originalEnv;
    process.env.AI_ENDPOINT = originalAiEndpoint;
    jest.resetAllMocks();
  });

  it('builds a safe prompt without leaking extra breach fields', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              executive_summary: 'Resumo seguro.',
              mitigation_steps: ['Passo 1', 'Passo 2', 'Passo 3', 'Passo 4'],
              urgency_level: 'HIGH',
            }),
          },
        },
      ],
    });

    const engine = new AIEngine('test-key');
    const result = await engine.generateRecommendation({
      breaches: [
        {
          Name: 'Sample breach',
          Title: 'Sample breach',
          BreachDate: '2026-03-10T00:00:00.000Z',
          DataClasses: ['Passwords'],
          IsVerified: true,
          email: 'secret@example.com',
          cpf: '123.456.789-00',
        } as any,
      ],
      riskScore: 80,
    });

    expect(createMock).toHaveBeenCalledTimes(1);
    const messages = (createMock.mock.calls[0] as any)[0].messages as Array<{ role: string; content: string }>;
    expect(messages[0].role).toBe('system');
    const prompt = messages.find((message) => message.role === 'user')!.content;

    expect(prompt).toContain('Sample breach');
    expect(prompt).toContain('Passwords');
    expect(prompt).not.toContain('secret@example.com');
    expect(prompt).not.toContain('123.456.789-00');
    expect(result.urgency_level).toBe('HIGH');
  });

  it('falls back when the model returns JSON outside the expected format', async () => {
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              executive_summary: 'Resumo sem passos.',
              mitigation_steps: [],
              urgency_level: 'EXTREME',
            }),
          },
        },
      ],
    });

    const engine = new AIEngine('test-key');
    const result = await engine.generateRecommendation({
      breaches: [{
        Name: 'Wrong format',
        Title: 'Wrong format',
        BreachDate: '2024-02-15',
        DataClasses: ['Emails'],
        IsVerified: true,
      }],
      riskScore: 40,
      classification: 'MODERATE',
    });

    expect(result.executive_summary).toContain('Wrong format');
    expect(result.mitigation_steps.length).toBeGreaterThan(0);
  });

  it('returns a safe fallback recommendation when the model is unavailable', async () => {
    process.env.AI_ENDPOINT = '';

    const engine = new AIEngine('test-key');
    const result = await engine.generateRecommendation({
      breaches: [{
        Name: 'Legacy breach',
        Title: 'Legacy breach',
        BreachDate: '2010-01-01',
        DataClasses: ['Passwords', 'Names'],
        IsVerified: true,
      }],
      riskScore: 85,
    });

    expect(result.urgency_level).toBe('HIGH');
    expect(result.mitigation_steps[0]).toContain('Troque a senha');
  });

  it('falls back to the safe recommendation when model output is empty or invalid', async () => {
    createMock.mockResolvedValue({
      choices: [{ message: { content: '' } }],
    });

    const engine = new AIEngine('test-key');
    const result = await engine.generateRecommendation({
      breaches: [{
        Name: 'Broken output',
        Title: 'Broken output',
        BreachDate: '2024-02-15',
        DataClasses: ['Emails'],
        IsVerified: false,
      }],
      riskScore: 55,
    });

    expect(result.urgency_level).toBe('MEDIUM');
    expect(result.executive_summary).toContain('Broken output');

    createMock.mockResolvedValue({
      choices: [{ message: { content: 'not-json' } }],
    });

    const secondResult = await engine.generateRecommendation({
      breaches: [{
        Name: 'Invalid json',
        Title: 'Invalid json',
        BreachDate: '2025-01-20',
        DataClasses: ['Emails'],
        IsVerified: true,
      }],
      riskScore: 40,
    });

    expect(secondResult.urgency_level).toBe('MEDIUM');
    expect(secondResult.executive_summary).toContain('Invalid json');
  });

  it('reads the model and timeout from the environment and marks model answers', async () => {
    process.env.AI_MODEL = 'custom-model';
    process.env.AI_TIMEOUT_MS = '5000';
    createMock.mockResolvedValue({
      choices: [
        {
          message: {
            content: JSON.stringify({
              executive_summary: 'Resumo.',
              mitigation_steps: ['Passo 1'],
              urgency_level: 'low',
            }),
          },
        },
      ],
    });

    const engine = new AIEngine('test-key');
    const result = await engine.generateRecommendation({
      breaches: [{
        Name: 'Env breach',
        Title: 'Env breach',
        BreachDate: '2024-02-15',
        DataClasses: ['Emails'],
        IsVerified: true,
      }],
      riskScore: 10,
    });

    expect(OpenAIMock).toHaveBeenCalledWith(expect.objectContaining({ timeout: 5000, maxRetries: 0 }));
    expect((createMock.mock.calls[0] as any)[0].model).toBe('custom-model');
    expect(result.urgency_level).toBe('LOW');
    expect(result.source).toBe('ai');
  });

  it('builds fallback steps from the exposed data types and follows the risk classification', async () => {
    process.env.AI_ENDPOINT = '';

    const engine = new AIEngine('test-key');
    const result = await engine.generateRecommendation({
      breaches: [{
        Name: 'Contact leak',
        Title: 'Contact leak',
        BreachDate: '2019-05-01',
        DataClasses: ['Email addresses', 'Phone numbers', 'Physical addresses'],
        IsVerified: true,
      }],
      riskScore: 20,
      classification: 'LOW',
    });

    expect(result.source).toBe('fallback');
    expect(result.urgency_level).toBe('LOW');
    expect(result.executive_summary).toContain('e-mails, telefones, endereços');
    expect(result.executive_summary).not.toContain('Troque sua senha');
    expect(result.mitigation_steps.some((step) => step.includes('Troque a senha'))).toBe(false);
    expect(result.mitigation_steps.some((step) => step.includes('WhatsApp'))).toBe(true);
    expect(result.mitigation_steps.some((step) => step.includes('Registrato'))).toBe(true);
  });

  it('adds banking guidance to the fallback when financial data is exposed', async () => {
    process.env.AI_ENDPOINT = '';

    const engine = new AIEngine('test-key');
    const result = await engine.generateRecommendation({
      breaches: [{
        Name: 'Store leak',
        Title: 'Store leak',
        BreachDate: '2026-01-01',
        DataClasses: ['Credit cards', 'Passwords'],
        IsVerified: true,
      }],
      riskScore: 71,
    });

    expect(result.urgency_level).toBe('HIGH');
    expect(result.mitigation_steps[0]).toContain('Troque a senha');
    expect(result.mitigation_steps[1]).toContain('banco');
  });

  it('keeps the fallback urgency aligned with the RiskEngine thresholds', async () => {
    process.env.AI_ENDPOINT = '';

    const engine = new AIEngine('test-key');
    const breach = {
      Name: 'Threshold',
      Title: 'Threshold',
      BreachDate: '2020-01-01',
      DataClasses: [],
      IsVerified: true,
    };

    const atSeventy = await engine.generateRecommendation({ breaches: [breach], riskScore: 70 });
    const low = await engine.generateRecommendation({ breaches: [breach], riskScore: 30 });

    expect(atSeventy.urgency_level).toBe('MEDIUM');
    expect(low.urgency_level).toBe('LOW');
    expect(low.executive_summary).toContain('dados não especificados');
  });
});