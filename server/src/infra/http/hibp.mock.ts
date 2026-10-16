/**
 * Mock HIBP Client para testes sem chave real
 * Simula respostas reais da API HIBP.
 * addBreachForTesting simula um vazamento novo entre duas checagens (testes de monitoramento).
 */

import { EventEmitter } from 'events';
import { BreachedAccountOptions, HibpBreach, HibpClientLike, HibpSubscriptionStatus } from './hibp.types';

function defaultBreaches(): Record<string, HibpBreach[]> {
  return {
    'breached@example.com': [
      {
        Name: 'Equifax',
        Title: 'Equifax Data Breach',
        BreachDate: '2017-07-29',
        DataClasses: ['Email addresses', 'Names', 'SSNs'],
        IsVerified: true,
      },
      {
        Name: 'LinkedIn',
        Title: 'LinkedIn Data Exposure',
        BreachDate: '2021-06-22',
        DataClasses: ['Email addresses', 'Phone numbers'],
        IsVerified: true,
      },
    ],
    'clean@example.com': [],
    'test@example.com': [
      {
        Name: 'TestBreach',
        Title: 'Test Data Breach',
        BreachDate: '2024-01-15',
        DataClasses: ['Email addresses', 'Passwords'],
        IsVerified: false,
      },
    ],
  };
}

export class MockHibpClient extends EventEmitter implements HibpClientLike {
  private breachesByEmail: Record<string, HibpBreach[]> = defaultBreaches();

  constructor(private readonly delayMs = 500) {
    super();
  }

  private async lookup(email: string): Promise<HibpBreach[]> {
    // Simula delay da API
    if (this.delayMs > 0) {
      await new Promise(resolve => setTimeout(resolve, this.delayMs));
    }

    return [...(this.breachesByEmail[email.toLowerCase()] || [])];
  }

  async checkAccount(email: string): Promise<any[]> {
    const breaches = await this.lookup(email);
    console.log(`[MockHibpClient] Checking account: ${breaches.length} breach(es) found`);
    return breaches;
  }

  async getBreachedAccountStrict(email: string, options: BreachedAccountOptions = {}): Promise<any[]> {
    const breaches = await this.lookup(email);
    return (options.truncate ?? true) ? breaches.map(breach => ({ Name: breach.Name })) : breaches;
  }

  async getSubscriptionStatus(): Promise<HibpSubscriptionStatus> {
    return {
      SubscriptionName: 'Mock Core 1',
      SubscribedUntil: '2099-12-31T00:00:00',
      Rpm: 10,
    };
  }

  /** Acrescenta um vazamento ao e-mail (não duplica pelo Name) */
  addBreachForTesting(email: string, breach: HibpBreach): void {
    const key = email.toLowerCase();
    const current = this.breachesByEmail[key] || [];
    if (!current.some(existing => existing.Name === breach.Name)) {
      this.breachesByEmail[key] = [...current, breach];
    }
  }

  /** Volta aos vazamentos padrão do mock */
  reset(): void {
    this.breachesByEmail = defaultBreaches();
  }

  on(event: string, listener: any): this {
    if (event === 'open') {
      console.log('[MockHibpClient] Circuit breaker opened (mock)');
    } else if (event === 'close') {
      console.log('[MockHibpClient] Circuit breaker closed (mock)');
    }
    return super.on(event, listener);
  }

  async shutdown(): Promise<void> {
    console.log('[MockHibpClient] Shutdown');
  }
}
