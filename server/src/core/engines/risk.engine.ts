/**
 * RiskEngine - Motor de Cálculo de Risco Cibernético
 *
 * Implementa o cálculo determinístico do Risk Score (RN02 e RN03):
 * - Cada vazamento soma os pesos das Data Classes expostas: sum(w_i)
 * - O fator temporal T(t_j) reduz o peso de vazamentos antigos: S_j = T(t_j) * sum(w_i)
 * - O score bruto é normalizado em [0, 100]: min(100, S_bruto / S_MAX * 100)
 */

interface DataClassWeight {
  [key: string]: number;
}

interface BreachData {
  Name: string;
  Title: string;
  BreachDate: string;
  DataClasses: string[];
  IsVerified: boolean;
}

interface SubScore {
  breach: string;
  ageInMonths: number;
  temporalFactor: number;
  rawScore: number;
  score: number;
}

export type RiskClassification = 'LOW' | 'MODERATE' | 'HIGH' | 'CRITICAL';

interface RiskCalculation {
  totalScore: number;
  classification: RiskClassification;
  subscores: SubScore[];
  breachesFound: number;
}

// Constante de saturação: score bruto a partir do qual o risco chega a 100
const S_MAX = 50;

// Peso usado para Data Classes que não estão no dicionário
const DEFAULT_WEIGHT = 3;

/**
 * Pesos das Data Classes (Tabela 7 da documentação), com os nomes exatos
 * que a API do HIBP devolve em DataClasses
 */
const DATA_CLASS_WEIGHTS: DataClassWeight = {
  // Nível 4: Altíssima
  'Passwords': 10,
  'Credit cards': 10,
  'Credit card CVV': 10,
  'Bank account numbers': 10,
  'Financial transactions': 10,

  // Nível 3: Alta
  'Partial credit card data': 8,
  'Government issued IDs': 8,
  'Social security numbers': 8,
  'Passport numbers': 8,
  "Driver's licenses": 8,
  'Auth tokens': 8,
  'Biometric data': 8,
  'Security questions and answers': 8,
  'Password hints': 7,

  // Nível 2: Média
  'Phone numbers': 5,
  'Physical addresses': 5,
  'Dates of birth': 4,

  // Nível 1: Baixa
  'Usernames': 3,
  'Names': 3,
  'Email addresses': 2,
  'IP addresses': 2,
  'Geographic locations': 2,
  'User agent details': 1,
  'Browser user agent details': 1,
  'Device information': 1,
};

export class RiskEngine {
  // Busca sem diferenciar maiúsculas, para não perder peso por variação de grafia.
  // Map em vez de objeto: nomes como "__proto__" ou "constructor" não podem achar
  // propriedades herdadas (o score viraria NaN; achado pelo fuzz testing).
  private readonly dataClassWeights = new Map<string, number>(
    Object.entries(DATA_CLASS_WEIGHTS).map(([dataClass, weight]) => [dataClass.toLowerCase(), weight]),
  );

  /**
   * Calcula o fator temporal T(t_j) conforme RN03:
   * t_j <= 24 meses -> 1.0
   * 24 < t_j <= 60 meses -> 0.7
   * t_j > 60 meses -> 0.4
   */
  private calculateTemporalFactor(breachDateStr: string): { factor: number; ageInMonths: number } {
    const breachDate = new Date(breachDateStr);

    // Data inválida conta como recente, para não reduzir o risco por falta de informação
    if (Number.isNaN(breachDate.getTime())) {
      return { factor: 1.0, ageInMonths: 0 };
    }

    const now = new Date();
    const diffInMonths =
      (now.getFullYear() - breachDate.getFullYear()) * 12 + (now.getMonth() - breachDate.getMonth());
    const ageInMonths = Math.max(0, diffInMonths);

    if (ageInMonths <= 24) {
      return { factor: 1.0, ageInMonths };
    } else if (ageInMonths <= 60) {
      return { factor: 0.7, ageInMonths };
    }
    return { factor: 0.4, ageInMonths };
  }

  private getDataClassWeight(dataClass: string): number {
    return this.dataClassWeights.get(String(dataClass).toLowerCase()) ?? DEFAULT_WEIGHT;
  }

  /**
   * Calcula o SubScore para um vazamento individual
   * Formula: S_j = T(t_j) * sum(w_i)
   */
  private calculateSubScore(breach: BreachData): SubScore {
    const { factor: temporalFactor, ageInMonths } = this.calculateTemporalFactor(breach.BreachDate);
    const rawScore = (breach.DataClasses || []).reduce(
      (sum, dataClass) => sum + this.getDataClassWeight(dataClass),
      0,
    );

    return {
      breach: breach.Name,
      ageInMonths,
      temporalFactor,
      rawScore,
      score: Number((temporalFactor * rawScore).toFixed(2)),
    };
  }

  private classify(score: number): RiskClassification {
    if (score >= 76) return 'CRITICAL';
    if (score >= 51) return 'HIGH';
    if (score >= 26) return 'MODERATE';
    return 'LOW';
  }

  /**
   * Calcula o Risk Score final normalizado em [0, 100]
   * Formula: RiskScore = min(100, (S_bruto / S_MAX) * 100)
   */
  calculate(breaches: BreachData[]): RiskCalculation {
    if (!breaches || breaches.length === 0) {
      return {
        totalScore: 0,
        classification: 'LOW',
        subscores: [],
        breachesFound: 0,
      };
    }

    const subscores: SubScore[] = breaches.map(breach =>
      this.calculateSubScore(breach)
    );

    const rawTotal = subscores.reduce((sum, sub) => sum + sub.score, 0);
    const totalScore = Math.min(100, Math.round((rawTotal / S_MAX) * 100));

    return {
      totalScore,
      classification: this.classify(totalScore),
      subscores,
      breachesFound: breaches.length,
    };
  }
}
