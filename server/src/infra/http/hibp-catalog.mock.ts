import { existsSync, readFileSync } from 'fs';
import { resolve } from 'path';
import { HibpBreach, HibpCatalogClientLike } from './hibp.types';

/**
 * Catálogo HIBP simulado, lido de uma fixture JSON (HIBP_CATALOG_FIXTURE ou
 * tests/fixtures/hibp-breaches.json). addBreach/updateBreach simulam a HIBP
 * publicando ou alterando um vazamento entre dois syncs.
 */
export class MockHibpCatalogClient implements HibpCatalogClientLike {
  private breaches: HibpBreach[];

  constructor(private readonly fixturePath = MockHibpCatalogClient.defaultFixturePath()) {
    this.breaches = this.loadFixture();
  }

  static defaultFixturePath(): string {
    return process.env.HIBP_CATALOG_FIXTURE || resolve(process.cwd(), 'tests/fixtures/hibp-breaches.json');
  }

  private loadFixture(): HibpBreach[] {
    if (!existsSync(this.fixturePath)) {
      console.warn('[MockHibpCatalogClient] Fixture não encontrada, catálogo vazio.');
      return [];
    }

    const data = JSON.parse(readFileSync(this.fixturePath, 'utf-8'));
    return Array.isArray(data) ? data : [];
  }

  async getAllBreaches(): Promise<HibpBreach[]> {
    return this.breaches.map(breach => ({ ...breach }));
  }

  async getBreach(name: string): Promise<HibpBreach | null> {
    const breach = this.breaches.find(item => item.Name.toLowerCase() === name.toLowerCase());
    return breach ? { ...breach } : null;
  }

  async getLatestBreach(): Promise<HibpBreach | null> {
    if (this.breaches.length === 0) {
      return null;
    }

    const latest = [...this.breaches].sort(
      (a, b) => new Date(b.AddedDate || 0).getTime() - new Date(a.AddedDate || 0).getTime(),
    )[0];
    return { ...latest };
  }

  addBreach(breach: HibpBreach): void {
    this.breaches = [...this.breaches.filter(item => item.Name !== breach.Name), breach];
  }

  updateBreach(name: string, changes: Partial<HibpBreach>): void {
    this.breaches = this.breaches.map(item => (item.Name === name ? { ...item, ...changes } : item));
  }

  reset(): void {
    this.breaches = this.loadFixture();
  }
}
