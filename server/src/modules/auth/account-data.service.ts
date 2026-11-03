import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../infra/database/prisma.service';
import { openBreachData } from '../../shared/crypto/breach-data.cipher';
import { log } from '../../shared/utils/logger';

/**
 * Cópia dos dados da conta em formato estruturado (portabilidade, LGPD art. 18, V).
 * Ficam de fora a senha, os tokens e os hashes internos: não são dados úteis ao titular
 * e não devem sair do sistema.
 */
@Injectable()
export class AccountDataService {
  constructor(private readonly prisma: PrismaService) {}

  async exportUserData(userId: number) {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        email: true,
        googleId: true,
        createdAt: true,
        emailVerifiedAt: true,
        termsAcceptedAt: true,
        termsVersion: true,
        monitoringEnabled: true,
        monitoringConsentAt: true,
        lastMonitoredAt: true,
      },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    const [scans, knownBreaches, notifications] = await Promise.all([
      this.prisma.scanHistory.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: {
          riskScore: true,
          classification: true,
          breachesFound: true,
          breachData: true,
          recommendation: true,
          mitigationSteps: true,
          urgencyLevel: true,
          source: true,
          createdAt: true,
        },
      }),
      this.prisma.userBreach.findMany({
        where: { userId },
        orderBy: { firstSeenAt: 'asc' },
        select: { breachName: true, source: true, firstSeenAt: true, notifiedAt: true },
      }),
      this.prisma.notification.findMany({
        where: { userId },
        orderBy: { createdAt: 'asc' },
        select: { title: true, body: true, readAt: true, emailStatus: true, emailSentAt: true, createdAt: true },
      }),
    ]);

    log('info', 'AccountData', 'account.exported', { userId });

    const { googleId, ...account } = user;
    return {
      geradoEm: new Date().toISOString(),
      conta: { ...account, entraComGoogle: Boolean(googleId) },
      // Os vazamentos ficam criptografados no banco e são abertos só aqui
      analises: scans.map(scan => ({ ...scan, breachData: openBreachData(scan.breachData) })),
      vazamentosConhecidos: knownBreaches,
      notificacoes: notifications,
    };
  }
}
