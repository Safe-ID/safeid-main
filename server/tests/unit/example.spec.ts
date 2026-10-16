import { describe, it, expect, beforeEach, afterEach, jest } from '@jest/globals';
import { RiskEngine } from '../../src/core/engines/risk.engine';

describe('RiskEngine', () => {
  const fixedNow = new Date('2026-09-10T00:00:00.000Z');
  let riskEngine: RiskEngine;

  const breachWith = (dataClasses: string[], breachDate = '2026-03-10T00:00:00.000Z', name = 'Breach') => ({
    Name: name,
    Title: name,
    BreachDate: breachDate,
    DataClasses: dataClasses,
    IsVerified: true,
  });

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

  it('sums the weights of the HIBP data classes and normalizes by S_MAX', () => {
    const result = riskEngine.calculate([
      breachWith(['Passwords', 'IP addresses', 'Names'], '2026-03-10T00:00:00.000Z', 'Fresh breach'),
    ]);

    // (10 + 2 + 3) * 1.0 = 15 -> 15 / 50 * 100 = 30
    expect(result.totalScore).toBe(30);
    expect(result.classification).toBe('MODERATE');
    expect(result.breachesFound).toBe(1);
    expect(result.subscores[0]).toEqual({
      breach: 'Fresh breach',
      ageInMonths: 6,
      temporalFactor: 1,
      rawScore: 15,
      score: 15,
    });
  });

  it.each([
    ['2024-09-10T00:00:00.000Z', 24, 1.0],
    ['2024-08-10T00:00:00.000Z', 25, 0.7],
    ['2021-09-10T00:00:00.000Z', 60, 0.7],
    ['2021-08-10T00:00:00.000Z', 61, 0.4],
  ])('applies the temporal factor for a breach from %s', (breachDate, ageInMonths, temporalFactor) => {
    const result = riskEngine.calculate([breachWith(['Passwords'], breachDate)]);

    expect(result.subscores[0]).toMatchObject({ ageInMonths, temporalFactor, score: 10 * temporalFactor });
  });

  it('weights data classes with the exact names returned by HIBP, ignoring case', () => {
    const result = riskEngine.calculate([
      breachWith(['Phone numbers', 'physical addresses', 'Dates of birth', 'Government issued IDs']),
    ]);

    // 5 + 5 + 4 + 8 = 22
    expect(result.subscores[0].rawScore).toBe(22);
  });

  it('uses the default weight for unknown data classes', () => {
    const result = riskEngine.calculate([breachWith(['Some new data class'])]);

    expect(result.subscores[0].rawScore).toBe(3);
  });

  it('treats an invalid breach date as recent instead of lowering the risk', () => {
    const result = riskEngine.calculate([breachWith(['Passwords'], 'not-a-date')]);

    expect(result.subscores[0]).toMatchObject({ ageInMonths: 0, temporalFactor: 1, score: 10 });
  });

  it('aggregates breaches of different ages into the high band', () => {
    const result = riskEngine.calculate([
      breachWith(['Passwords', 'IP addresses', 'Names'], '2026-03-15', 'LojaX'),
      breachWith(['Password hints', 'Usernames'], '2023-09-10', 'ServicoY'),
      breachWith(['Credit cards', 'Phone numbers'], '2025-09-20', 'PlataformaZ'),
    ]);

    // 15 * 1.0 + 10 * 0.7 + 15 * 1.0 = 37 -> 74
    expect(result.subscores.map(sub => sub.score)).toEqual([15, 7, 15]);
    expect(result.totalScore).toBe(74);
    expect(result.classification).toBe('HIGH');
    expect(result.breachesFound).toBe(3);
  });

  it.each([
    [['Passwords', 'Email addresses'], 24, 'LOW'],
    [['Passwords', 'Names'], 26, 'MODERATE'],
    [['Passwords', 'Credit cards', 'Phone numbers'], 50, 'MODERATE'],
    [['Passwords', 'Credit cards', 'Phone numbers', 'Device information'], 52, 'HIGH'],
    [['Passwords', 'Credit cards', 'Credit card CVV', 'Passport numbers'], 76, 'CRITICAL'],
  ])('classifies %j as %i (%s)', (dataClasses, totalScore, classification) => {
    const result = riskEngine.calculate([breachWith(dataClasses as string[])]);

    expect(result.totalScore).toBe(totalScore);
    expect(result.classification).toBe(classification);
  });

  it('caps the total score at 100 and classifies the result as critical', () => {
    const breaches = Array.from({ length: 8 }, (_, index) =>
      breachWith(['Passwords', 'Credit cards', 'Bank account numbers'], '2026-03-10T00:00:00.000Z', `Critical breach ${index + 1}`),
    );

    const result = riskEngine.calculate(breaches);

    expect(result.totalScore).toBe(100);
    expect(result.classification).toBe('CRITICAL');
    expect(result.subscores).toHaveLength(8);
  });
});
