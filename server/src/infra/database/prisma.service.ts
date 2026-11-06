import { Injectable, OnModuleInit, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@prisma/client';

import { log } from '../../shared/utils/logger';
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleInit, OnModuleDestroy {
  async onModuleInit() {
    await this.$connect();
    log('info', 'Prisma', 'db.connected');
  }

  async onModuleDestroy() {
    await this.$disconnect();
    log('info', 'Prisma', 'db.disconnected');
  }
}
