import { describe, expect, it } from '@jest/globals';
import fc from 'fast-check';
import { RiskEngine } from '../../src/core/engines/risk.engine';

/**
 * Fuzz testing do RiskEngine (propriedades que valem para qualquer entrada).
 * Em caso de falha, o fast-check imprime a seed e o menor contraexemplo encontrado.
 */

const engine = new RiskEngine();
const RUNS = { numRuns: 300 };

// Nomes reais do HIBP (com pesos diferentes) misturados com classes desconhecidas
const knownDataClass = fc.constantFrom(
  'Passwords',
  'Credit cards',
  'Government issued IDs',
  'Password hints',
  'Phone numbers',
  'Dates of birth',
  'Names',
  'Email addresses',
  'IP addresses',
  'User agent details',
);
// Nomes que todo objeto JavaScript herda: já deixaram o score como NaN
const inheritedName = fc.constantFrom('__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf');
const dataClass = fc.oneof(knownDataClass, inheritedName, fc.string({ maxLength: 30 }));

const validDate = fc
  .date({ min: new Date('1990-01-01T00:00:00Z'), max: new Date('2035-12-31T00:00:00Z'), noInvalidDate: true })
  .map(date => date.toISOString().slice(0, 10));
const invalidDate = fc.constantFrom('', 'not-a-date', '2024-13-45', 'ontem');
const breachDate = fc.oneof({ weight: 9, arbitrary: validDate }, { weight: 1, arbitrary: invalidDate });

const breach = fc.record({
  Name: fc.string({ minLength: 1, maxLength: 20 }),
  Title: fc.string({ maxLength: 20 }),
  BreachDate: breachDate,
  DataClasses: fc.array(dataClass, { maxLength: 12 }),
  IsVerified: fc.boolean(),
});
const breaches = fc.array(breach, { maxLength: 15 });

function expectedClassification(score: number): string {
  if (score >= 76) return 'CRITICAL';
  if (score >= 51) return 'HIGH';
  if (score >= 26) return 'MODERATE';
  return 'LOW';
}

describe('RiskEngine (fuzz)', () => {
  it('gives the default weight to data class names inherited from Object', () => {
    for (const name of ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf']) {
      const result = engine.calculate([{ Name: 'X', Title: 'X', BreachDate: '', DataClasses: [name], IsVerified: true }]);
      // Peso padrão 3, fator 1.0 (data inválida): 3 / 50 * 100 = 6
      expect(result.subscores[0].rawScore).toBe(3);
      expect(result.totalScore).toBe(6);
    }
  });

  it('always returns an integer score between 0 and 100 without throwing', () => {
    fc.assert(
      fc.property(breaches, list => {
        const result = engine.calculate(list);
        expect(Number.isInteger(result.totalScore)).toBe(true);
        expect(result.totalScore).toBeGreaterThanOrEqual(0);
        expect(result.totalScore).toBeLessThanOrEqual(100);
        expect(result.breachesFound).toBe(list.length);
        expect(result.subscores).toHaveLength(list.length);
      }),
      RUNS,
    );
  });

  it('classifies the score with the documented bands', () => {
    fc.assert(
      fc.property(breaches, list => {
        const result = engine.calculate(list);
        expect(result.classification).toBe(expectedClassification(result.totalScore));
      }),
      RUNS,
    );
  });

  it('keeps every temporal factor in {1.0, 0.7, 0.4} and every subscore non-negative', () => {
    fc.assert(
      fc.property(breaches, list => {
        for (const sub of engine.calculate(list).subscores) {
          expect([1.0, 0.7, 0.4]).toContain(sub.temporalFactor);
          expect(sub.score).toBeGreaterThanOrEqual(0);
          expect(sub.ageInMonths).toBeGreaterThanOrEqual(0);
        }
      }),
      RUNS,
    );
  });

  it('does not depend on the order of the breaches', () => {
    fc.assert(
      fc.property(
        breaches.chain(list => fc.tuple(fc.constant(list), fc.shuffledSubarray(list, { minLength: list.length, maxLength: list.length }))),
        ([list, shuffled]) => {
          expect(engine.calculate(shuffled).totalScore).toBe(engine.calculate(list).totalScore);
        },
      ),
      RUNS,
    );
  });

  it('ignores the letter case of the data classes', () => {
    fc.assert(
      fc.property(breaches, list => {
        const upper = list.map(item => ({ ...item, DataClasses: item.DataClasses.map(name => name.toUpperCase()) }));
        const lower = list.map(item => ({ ...item, DataClasses: item.DataClasses.map(name => name.toLowerCase()) }));
        expect(engine.calculate(upper).totalScore).toBe(engine.calculate(lower).totalScore);
      }),
      RUNS,
    );
  });

  it('never lowers the score when a data class is exposed in a breach', () => {
    fc.assert(
      fc.property(breaches, fc.nat(), dataClass, (list, index, extra) => {
        fc.pre(list.length > 0);
        const target = index % list.length;
        const more = list.map((item, i) => (i === target ? { ...item, DataClasses: [...item.DataClasses, extra] } : item));
        expect(engine.calculate(more).totalScore).toBeGreaterThanOrEqual(engine.calculate(list).totalScore);
      }),
      RUNS,
    );
  });

  it('never lowers the score when a new breach is found', () => {
    fc.assert(
      fc.property(breaches, breach, (list, extra) => {
        expect(engine.calculate([...list, extra]).totalScore).toBeGreaterThanOrEqual(engine.calculate(list).totalScore);
      }),
      RUNS,
    );
  });

  it('never gives an older breach more weight than a newer one', () => {
    fc.assert(
      fc.property(breach, validDate, validDate, (item, a, b) => {
        const [older, newer] = a <= b ? [a, b] : [b, a];
        const olderScore = engine.calculate([{ ...item, BreachDate: older }]).subscores[0].score;
        const newerScore = engine.calculate([{ ...item, BreachDate: newer }]).subscores[0].score;
        expect(olderScore).toBeLessThanOrEqual(newerScore);
      }),
      RUNS,
    );
  });

  it('treats an invalid breach date as recent (factor 1.0)', () => {
    fc.assert(
      fc.property(breach, invalidDate, (item, date) => {
        const [sub] = engine.calculate([{ ...item, BreachDate: date }]).subscores;
        expect(sub.temporalFactor).toBe(1.0);
        expect(sub.score).toBe(sub.rawScore);
      }),
      RUNS,
    );
  });
});
