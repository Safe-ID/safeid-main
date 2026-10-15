import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/database/database.module';
import { EmailProcessor } from './processors/email.processor';

/**
 * Notificações (e-mail e in-app). Na F1 só envia o e-mail de verificação;
 * notificações de vazamento novo e o opt-out entram nas fases seguintes.
 */
@Module({
  imports: [DatabaseModule],
  providers: [EmailProcessor],
})
export class NotificationsModule {}
