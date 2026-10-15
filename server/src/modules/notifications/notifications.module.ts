import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/database/database.module';
import { EmailProcessor } from './processors/email.processor';
import { NotificationsService } from './notifications.service';
import { BreachesModule } from '../breaches/breaches.module';

/**
 * Notificações (e-mail e in-app): e-mail de verificação (F1) e criação das notificações
 * de vazamento novo (F4). Rotas, envio do alerta e opt-out entram na F5.
 */
@Module({
  imports: [DatabaseModule, BreachesModule],
  providers: [EmailProcessor, NotificationsService],
  exports: [NotificationsService],
})
export class NotificationsModule {}
