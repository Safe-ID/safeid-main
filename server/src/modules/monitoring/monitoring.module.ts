import { Module } from '@nestjs/common';
import { HibpProcessor } from './processors/hibp.processor';

/**
 * Monitoramento contínuo de vazamentos. Na F0 só tem o worker da fila hibp-check;
 * catálogo, varreduras e agendamentos entram nas fases seguintes.
 */
@Module({
  providers: [HibpProcessor],
  exports: [HibpProcessor],
})
export class MonitoringModule {}
