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
    const prompt = (createMock.mock.calls[0] as any)[0].messages[0].content as string;

    expect(prompt).toContain('Sample breach');
    expect(prompt).toContain('Passwords');
    expect(prompt).not.toContain('secret@example.com');
    expect(prompt).not.toContain('123.456.789-00');
    expect(result.urgency_level).toBe('HIGH');
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
});