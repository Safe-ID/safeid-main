import axios, { AxiosInstance } from 'axios';
import CircuitBreaker from 'opossum';
import { createHash } from 'crypto';

export interface HibpClientOptions {
  apiKey: string;
  baseUrl?: string;
  userAgent?: string;
}

/**
 * Erro lançado quando o HIBP não pôde ser consultado (chave inválida, sem chave,
 * circuito aberto). Não pode virar "nenhum vazamento": seria um falso negativo.
 */
export class HibpUnavailableError extends Error {
  constructor(reason: string) {
    super(`HIBP indisponível: ${reason}`);
    this.name = 'HibpUnavailableError';
  }
}

export class HibpClient {
  private axios: AxiosInstance;
  private breaker: any;
  private hasApiKey: boolean;
  private missingApiKeyWarned = false;

  constructor(options: HibpClientOptions) {
    const baseUrl = options.baseUrl || 'https://haveibeenpwned.com/api/v3';
    const apiKey = (options.apiKey || '').trim();

    this.hasApiKey = apiKey.length > 0;

    this.axios = axios.create({
      baseURL: baseUrl,
      timeout: 10000,
      headers: {
        'hibp-api-key': apiKey,
        'User-Agent': options.userAgent || 'safeid-backend',
      },
    });

    // Wrap the HTTP call in a circuit breaker
    const httpCall = async (email: string) => {
      try {
        return await this.checkAccountDirect(email);
      } catch (err: any) {
        const status = err?.response?.status;

        if (status === 401 || status === 403) {
          return this.checkAccountByRange(email);
        }

        throw err;
      }
    };

    this.breaker = new CircuitBreaker(httpCall, {
      errorThresholdPercentage: 50,
      resetTimeout: 30000,
      rollingCountTimeout: 10000,
      rollingCountBuckets: 10,
    });

    // Optional: forward breaker events to console for now
    this.breaker.on('open', () => console.warn('[HIBP Circuit] OPEN'));
    this.breaker.on('halfOpen', () => console.info('[HIBP Circuit] HALF_OPEN'));
    this.breaker.on('close', () => console.info('[HIBP Circuit] CLOSED'));
  }

  private async checkAccountDirect(email: string): Promise<any[]> {
    const url = `/breachedaccount/${encodeURIComponent(email)}`;

    try {
      const res = await this.axios.get(url, {
        params: { truncateResponse: false },
      });

      return res.data || [];
    } catch (err: any) {
      // HIBP returns 404 when no breaches found — treat as empty array
      if (err?.response?.status === 404) {
        return [];
      }

      // propagate other errors
      throw err;
    }
  }

  private async checkAccountByRange(email: string): Promise<any[]> {
    try {
      const normalizedEmail = email.trim().toLowerCase();
      const sha1 = createHash('sha1').update(normalizedEmail).digest('hex').toUpperCase();
      const prefix = sha1.slice(0, 6);
      const suffix = sha1.slice(6);

      const response = await this.axios.get(`/breachedaccount/range/${prefix}`);
      const entries = Array.isArray(response.data) ? response.data : [];
      const matchedAccount = entries.find((entry: any) => {
        const entrySuffix = entry?.hashSuffix || entry?.HashSuffix || entry?.suffix;
        return entrySuffix === suffix;
      });

      if (!matchedAccount) {
        return [];
      }

      const websites =
        (matchedAccount.websites as string[]) ||
        (matchedAccount.Websites as string[]) ||
        (matchedAccount.breaches as string[]) ||
        [];

      const uniqueBreachNames = Array.from(new Set(websites));
      const breaches = await Promise.all(
        uniqueBreachNames.map(async (breachName: string) => {
          const breachResponse = await this.axios.get(`/breach/${encodeURIComponent(breachName)}`);
          return breachResponse.data;
        })
      );

      return breaches.filter(Boolean);
    } catch (err: any) {
      const status = err?.response?.status;

      // 404 no range significa que nenhum hash com esse prefixo foi encontrado
      if (status === 404) {
        return [];
      }

      if (status === 401 || status === 403) {
        throw new HibpUnavailableError(`acesso negado pela API (status ${status})`);
      }

      throw err;
    }
  }

  async checkAccount(email: string): Promise<any[]> {
    if (!this.hasApiKey) {
      if (!this.missingApiKeyWarned) {
        console.warn('[HIBP Client] HIBP_API_KEY not configured. Scans cannot be verified.');
        this.missingApiKeyWarned = true;
      }

      throw new HibpUnavailableError('HIBP_API_KEY não configurada');
    }

    try {
      return await this.breaker.fire(email);
    } catch (err: any) {
      const status = err?.response?.status;
      const message = String(err?.message || '');

      if (err instanceof HibpUnavailableError) {
        throw err;
      }

      if (status === 401 || status === 403) {
        throw new HibpUnavailableError(`acesso negado pela API (status ${status})`);
      }

      if (/breaker is open/i.test(message)) {
        throw new HibpUnavailableError('muitas falhas seguidas, consulta pausada temporariamente');
      }

      throw err;
    }
  }
}
