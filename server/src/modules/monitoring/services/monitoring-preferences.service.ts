import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../infra/database/prisma.service';
import { verifyUnsubscribeToken } from '../../../shared/crypto/unsubscribe-token';
import { log } from '../../../shared/utils/logger';
import { BreachCatalogService } from './breach-catalog.service';
import { MonitoringService } from './monitoring.service';

export interface MonitoringStatus {
  enabled: boolean;
  lastMonitoredAt: Date | null;
  lastCatalogSyncAt: Date | null;
}

/**
 * Preferência de monitoramento do usuário (opt-in/opt-out) e o descadastro pelo link do e-mail.
 */
@Injectable()
export class MonitoringPreferencesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly monitoring: MonitoringService,
    private readonly catalog: BreachCatalogService,
  ) {}

  async getStatus(userId: number): Promise<MonitoringStatus> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { monitoringEnabled: true, lastMonitoredAt: true },
    });

    if (!user) {
      throw new NotFoundException('Usuário não encontrado');
    }

    return {
      enabled: user.monitoringEnabled,
      lastMonitoredAt: user.lastMonitoredAt,
      lastCatalogSyncAt: await this.catalog.getLastSyncAt(),
    };
  }

  /**
   * Ao religar: grava o novo consentimento e agenda uma checagem imediata (T4.7),
   * sem esperar a próxima varredura.
   */
  async setEnabled(userId: number, enabled: boolean): Promise<MonitoringStatus> {
    const current = await this.prisma.user.findUnique({
      where: { id: userId },
      select: { monitoringEnabled: true },
    });

    if (!current) {
      throw new NotFoundException('Usuário não encontrado');
    }

    if (current.monitoringEnabled !== enabled) {
      await this.prisma.user.update({
        where: { id: userId },
        data: enabled ? { monitoringEnabled: true, monitoringConsentAt: new Date() } : { monitoringEnabled: false },
      });

      if (enabled) {
        await this.monitoring.enqueueCheck(userId, 'OPT_IN');
      }

      log('info', 'MonitoringPreferences', enabled ? 'monitoring.opt_in' : 'monitoring.opt_out', { userId, via: 'dashboard' });
    }

    return this.getStatus(userId);
  }

  /** Opt-out pelo link do e-mail. Idempotente; devolve false se o token for inválido. */
  async unsubscribeByToken(token: string): Promise<boolean> {
    const userId = verifyUnsubscribeToken(token);
    if (userId === null) {
      log('warn', 'MonitoringPreferences', 'monitoring.unsubscribe_invalid_token');
      return false;
    }

    // Conta já apagada: o link continua respondendo como sucesso, não há mais nada a desligar
    const result = await this.prisma.user.updateMany({
      where: { id: userId, monitoringEnabled: true },
      data: { monitoringEnabled: false },
    });

    if (result.count > 0) {
      log('info', 'MonitoringPreferences', 'monitoring.opt_out', { userId, via: 'email_link' });
    }
    return true;
  }
}
