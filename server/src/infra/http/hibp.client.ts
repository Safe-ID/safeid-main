import axios, { AxiosInstance } from 'axios';
import CircuitBreaker from 'opossum';
import { HibpAuthError, HibpRateLimitError, HibpUnavailableError, toHibpError } from './hibp.errors';
import { BreachedAccountOptions, HibpClientLike, HibpSubscriptionStatus } from './hibp.types';
import { log } from '../../shared/utils/logger';

export interface HibpClientOptions {
  apiKey: string;
  baseUrl?: string;
  userAgent?: string;
}

/**
 * Cliente autenticado da HIBP. Só o worker da fila hibp-check faz consultas de conta,
 * para que o limite de requisições do plano valha para todas as tasks juntas.
 */
export class HibpClient implements HibpClientLike {
  private axios: AxiosInstance;
  private breaker: CircuitBreaker;
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

    this.breaker = new CircuitBreaker(
      (email: string, truncate: boolean) => this.fetchBreachedAccount(email, truncate),
      {
        errorThresholdPercentage: 50,
        resetTimeout: 30000,
        rollingCountTimeout: 10000,
        rollingCountBuckets: 10,
        // 429 é limite de uso, não falha da HIBP: não deve abrir o circuito
        errorFilter: (err: unknown) => err instanceof HibpRateLimitError,
      },
    );

    this.breaker.on('open', () => log('warn', 'HibpClient', 'hibp.circuit_open'));
    this.breaker.on('halfOpen', () => log('info', 'HibpClient', 'hibp.circuit_half_open'));
    this.breaker.on('close', () => log('info', 'HibpClient', 'hibp.circuit_closed'));
  }

  private async fetchBreachedAccount(email: string, truncate: boolean): Promise<any[]> {
    try {
      const res = await this.axios.get(`/breachedaccount/${encodeURIComponent(email)}`, {
        params: { truncateResponse: truncate },
      });

      return Array.isArray(res.data) ? res.data : [];
    } catch (err: any) {
      // 404 = e-mail sem vazamentos
      if (err?.response?.status === 404) {
        return [];
      }

      throw toHibpError(err);
    }
  }

  /**
   * Consulta estrita: 404 → []; 429 → HibpRateLimitError; 401/403 → HibpAuthError;
   * 5xx, timeout ou circuito aberto → HibpUnavailableError. Nunca devolve [] por erro.
   */
  async getBreachedAccountStrict(email: string, options: BreachedAccountOptions = {}): Promise<any[]> {
    if (!this.hasApiKey) {
      throw new HibpAuthError('HIBP_API_KEY not configured');
    }

    try {
      return await this.breaker.fire(email, options.truncate ?? true);
    } catch (err) {
      throw toHibpError(err);
    }
  }

  /**
   * Fluxo manual (scan): modo degradado só para chave ausente/inválida e HIBP fora do ar.
   * Rate limit sempre se propaga, para o worker esperar e tentar de novo.
   */
  async checkAccount(email: string): Promise<any[]> {
    if (!this.hasApiKey) {
      if (!this.missingApiKeyWarned) {
        console.warn('[HIBP Client] HIBP_API_KEY not configured. Returning empty result in degraded mode.');
        this.missingApiKeyWarned = true;
      }

      return [];
    }

    try {
      return await this.getBreachedAccountStrict(email, { truncate: false });
    } catch (err) {
      if (err instanceof HibpAuthError || err instanceof HibpUnavailableError) {
        log('warn', 'HibpClient', err instanceof HibpAuthError ? 'hibp.auth_failed' : 'hibp.unavailable', {
          status: err.status,
          degraded: true,
        });
        return [];
      }

      throw err;
    }
  }

  /** Plano contratado (nome, RPM, validade). Usado para derivar o limite do worker. */
  async getSubscriptionStatus(): Promise<HibpSubscriptionStatus> {
    if (!this.hasApiKey) {
      throw new HibpAuthError('HIBP_API_KEY not configured');
    }

    try {
      const res = await this.axios.get('/subscription/status');
      return res.data as HibpSubscriptionStatus;
    } catch (err) {
      throw toHibpError(err);
    }
  }

  async shutdown(): Promise<void> {
    await this.breaker.shutdown();
  }
}
