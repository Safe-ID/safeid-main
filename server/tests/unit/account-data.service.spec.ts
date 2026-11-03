import { beforeEach, describe, expect, it, jest } from '@jest/globals';
import { AccountDataService } from '../../src/modules/auth/account-data.service';
import { sealBreachData } from '../../src/shared/crypto/breach-data.cipher';

describe('AccountDataService', () => {
  let prisma: any;
  let service: AccountDataService;

  beforeEach(() => {
    jest.spyOn(console, 'log').mockImplementation(() => undefined);
    prisma = {
      user: { findUnique: jest.fn() },
      scanHistory: { findMany: jest.fn(async () => []) },
      userBreach: { findMany: jest.fn(async () => []) },
      notification: { findMany: jest.fn(async () => []) },
    };
    service = new AccountDataService(prisma);
  });

  it('exports the account with breaches decrypted and only for that user', async () => {
    process.env.ENCRYPTION_KEY = 'a'.repeat(32);
    prisma.user.findUnique.mockResolvedValue({ email: 'a@example.com', googleId: 'g-1', createdAt: new Date(), termsVersion: '2026-11-03' });
    prisma.scanHistory.findMany.mockResolvedValue([
      { riskScore: 40, classification: 'MODERATE', breachData: sealBreachData([{ Name: 'Adobe' }]) },
    ]);
    prisma.userBreach.findMany.mockResolvedValue([{ breachName: 'Adobe', source: 'SIGNUP' }]);
    prisma.notification.findMany.mockResolvedValue([{ title: 'Alerta', body: 'Adobe' }]);

    const data: any = await service.exportUserData(7);
    delete process.env.ENCRYPTION_KEY;

    expect(data.conta).toMatchObject({ email: 'a@example.com', entraComGoogle: true, termsVersion: '2026-11-03' });
    expect(data.conta.googleId).toBeUndefined();
    expect(data.analises[0].breachData).toEqual([{ Name: 'Adobe' }]);
    expect(data.vazamentosConhecidos).toHaveLength(1);
    expect(data.notificacoes).toHaveLength(1);
    for (const model of [prisma.scanHistory, prisma.userBreach, prisma.notification]) {
      expect(model.findMany.mock.calls[0][0].where).toEqual({ userId: 7 });
    }
  });

  it('never selects the password or internal hashes', async () => {
    prisma.user.findUnique.mockResolvedValue({ email: 'a@example.com', googleId: null });

    await service.exportUserData(7);

    expect(prisma.user.findUnique.mock.calls[0][0].select.passwordHash).toBeUndefined();
    expect(prisma.scanHistory.findMany.mock.calls[0][0].select.emailHash).toBeUndefined();
  });

  it('refuses an account that no longer exists', async () => {
    prisma.user.findUnique.mockResolvedValue(null);
    await expect(service.exportUserData(999)).rejects.toThrow('Usuário não encontrado');
  });
});
