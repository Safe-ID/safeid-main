import axios, { AxiosInstance } from 'axios';
import { toHibpError } from './hibp.errors';
import { HibpBreach, HibpCatalogClientLike } from './hibp.types';

export interface HibpCatalogClientOptions {
  baseUrl?: string;
  userAgent?: string;
}

/**
 * Endpoints públicos da HIBP (sem chave, não descontam da cota do plano).
 * Usados para detectar vazamentos novos ou alterados no catálogo.
 */
export class HibpCatalogClient implements HibpCatalogClientLike {
  private axios: AxiosInstance;

  constructor(options: HibpCatalogClientOptions = {}) {
    this.axios = axios.create({
      baseURL: options.baseUrl || 'https://haveibeenpwned.com/api/v3',
      // O catálogo completo tem ~2 MB
      timeout: 30000,
      headers: {
        'User-Agent': options.userAgent || 'safeid-backend',
      },
    });
  }

  async getAllBreaches(): Promise<HibpBreach[]> {
    try {
      const res = await this.axios.get('/breaches');
      return Array.isArray(res.data) ? res.data : [];
    } catch (err) {
      throw toHibpError(err);
    }
  }

  async getBreach(name: string): Promise<HibpBreach | null> {
    try {
      const res = await this.axios.get(`/breach/${encodeURIComponent(name)}`);
      return res.data || null;
    } catch (err: any) {
      if (err?.response?.status === 404) {
        return null;
      }
      throw toHibpError(err);
    }
  }

  /** Último vazamento publicado (por AddedDate); resposta pequena, para o probe de hora em hora */
  async getLatestBreach(): Promise<HibpBreach | null> {
    try {
      const res = await this.axios.get('/latestbreach');
      return res.data || null;
    } catch (err: any) {
      if (err?.response?.status === 404) {
        return null;
      }
      throw toHibpError(err);
    }
  }
}
