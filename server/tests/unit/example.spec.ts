import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RiskEngine } from '../../src/core/engines/risk.engine';

describe('RiskEngine', () => {
  const fixedNow = new Date('2026-09-10T00:00:00.000Z');
  let riskEngine: RiskEngine;

  beforeEach(() => {
    jest.useFakeTimers();
    jest.setSystemTime(fixedNow);
    riskEngine = new RiskEngine();
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it('returns zero score for empty breach lists', () => {
    const result = riskEngine.calculate([]);

    expect(result).toEqual({
      totalScore: 0,
      classification: 'LOW',
      subscores: [],
      breachesFound: 0,
    });
  });

  it('applies recency, confidence and weight for a recent verified breach', () => {
    const result = riskEngine.calculate([
      {
        Name: 'Fresh breach',
        Title: 'Fresh breach',
        BreachDate: '2026-03-10T00:00:00.000Z',
        DataClasses: ['Passwords'],
        IsVerified: true,
      },
    ]);

    expect(result.totalScore).toBe(15);
    expect(result.classification).toBe('LOW');
    expect(result.breachesFound).toBe(1);
    expect(result.subscores[0]).toMatchObject({
      breach: 'Fresh breach',
      maxPClass: 10,
      recencyFactor: 1.5,
      confidenceFactor: 1,
      score: 15,
    });
  });

  it('downgrades older and unverified breaches with lower recency and confidence factors', () => {
    const result = riskEngine.calculate([
      {
        Name: 'Old breach',
        Title: 'Old breach',
        BreachDate: '2021-01-10T00:00:00.000Z',
        DataClasses: ['Credit Cards'],
        IsVerified: false,
      },
    ]);

    expect(result.totalScore).toBe(3);
    expect(result.classification).toBe('LOW');
    expect(result.subscores[0]).toMatchObject({
      maxPClass: 10,
      recencyFactor: 0.6,
      confidenceFactor: 0.5,
      score: 3,
    });
  });

  it('classifies aggregated breaches as moderate when the total score passes the threshold', () => {
    const result = riskEngine.calculate([
      {
        Name: 'Breach one',
        Title: 'Breach one',
        BreachDate: '2026-03-10T00:00:00.000Z',
        DataClasses: ['Passwords'],
        IsVerified: true,
      },
      {
        Name: 'Breach two',
        Title: 'Breach two',
        BreachDate: '2026-03-10T00:00:00.000Z',
        DataClasses: ['Phone Numbers'],
        IsVerified: true,
      },
      {
        Name: 'Breach three',
        Title: 'Breach three',
        BreachDate: '2026-03-10T00:00:00.000Z',
        DataClasses: ['Passport Numbers'],
        IsVerified: true,
      },
      {
        Name: 'Breach four',
        Title: 'Breach four',
        BreachDate: '2026-03-10T00:00:00.000Z',
        DataClasses: ['Names'],
        IsVerified: true,
      },
    ]);

    expect(result.totalScore).toBe(42);
    expect(result.classification).toBe('MODERATE');
    expect(result.breachesFound).toBe(4);
  });

  it('caps the total score at 100 and classifies the result as critical', () => {
    const breaches = Array.from({ length: 8 }, (_, index) => ({
      Name: `Critical breach ${index + 1}`,
      Title: `Critical breach ${index + 1}`,
      BreachDate: '2026-03-10T00:00:00.000Z',
      DataClasses: ['Passwords', 'Credit Cards', 'Banking Information'],
      IsVerified: true,
    }));

    const result = riskEngine.calculate(breaches);

    expect(result.totalScore).toBe(100);
    expect(result.classification).toBe('CRITICAL');
    expect(result.subscores).toHaveLength(8);
  });
});
