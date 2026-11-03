import { describe, expect, it, jest } from '@jest/globals';
import { AIEngine } from '../../src/core/engines/ai.engine';
import { ExecuteRiskScanUseCase } from '../../src/core/use-cases/execute-risk-scan.usecase';
import { anonymizeSensitiveBreaches, SENSITIVE_BREACH_LABEL } from '../../src/shared/utils/sensitive-breaches';

const normal = { Name: 'Adobe', Title: 'Adobe', Domain: 'adobe.com', BreachDate: '2013-10-04', DataClasses: ['Passwords'], IsVerified: true };
const sensitive = {
  Name: 'AdultSite',
  Title: 'Adult Site',
  Domain: 'adult.example',
  Description: 'Adult Site was breached',
  LogoPath: 'https://logos.example/adult.png',
  BreachDate: '2015-01-01',
  DataClasses: ['Email addresses'],
  IsVerified: true,
  IsSensitive: true,
};

describe('anonymizeSensitiveBreaches', () => {
  it('hides what identifies a sensitive breach and keeps the rest', () => {
    const [first, second] = anonymizeSensitiveBreaches<any>([normal, sensitive]);

    expect(first).toEqual(normal);
    expect(second).toMatchObject({
      Name: SENSITIVE_BREACH_LABEL,
      Title: SENSITIVE_BREACH_LABEL,
      Domain: '',
      Description: '',
      LogoPath: '',
      BreachDate: '2015-01-01',
      DataClasses: ['Email addresses'],
    });
    expect(JSON.stringify(second)).not.toMatch(/adult/i);
  });
});

describe('ExecuteRiskScanUseCase and sensitive breaches', () => {
  it('sends the AI only the anonymized name, but keeps the real one in the result stored for the user', async () => {
    const aiSpy = jest.spyOn(AIEngine.prototype, 'generateRecommendation').mockResolvedValue({
      executive_summary: 'Resumo',
      mitigation_steps: [],
      urgency_level: 'LOW',
      source: 'fallback',
    } as any);
    const repository: any = { create: jest.fn(async () => undefined) };
    const cache: any = { get: jest.fn(async () => null), del: jest.fn(async () => undefined), setex: jest.fn(async () => undefined) };
    const useCase = new ExecuteRiskScanUseCase(repository, cache, { add: jest.fn() } as any, 'test-key');
    jest.spyOn(console, 'log').mockImplementation(() => undefined);

    await useCase.scoreAndPersist({ userId: 1, email: 'a@example.com', breaches: [normal, sensitive] as any, source: 'SIGNUP' });

    const sentToAi = JSON.stringify(aiSpy.mock.calls[0][0]);
    expect(sentToAi).toContain('Adobe');
    expect(sentToAi).toContain(SENSITIVE_BREACH_LABEL);
    expect(sentToAi).not.toMatch(/adult/i);
    expect(JSON.stringify(repository.create.mock.calls[0][0].breachData)).toContain('AdultSite');

    jest.restoreAllMocks();
  });
});
