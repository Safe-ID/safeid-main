import { Module } from '@nestjs/common';
import { DatabaseModule } from '../../infra/database/database.module';
import { UserBreachRepository } from './user-breach.repository';

/**
 * Base de vazamentos conhecidos por usuário. Módulo próprio para o Scan e o
 * Monitoramento usarem o repositório sem dependência circular entre eles.
 */
@Module({
  imports: [DatabaseModule],
  providers: [UserBreachRepository],
  exports: [UserBreachRepository],
})
export class BreachesModule {}
