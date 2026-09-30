import { Controller, Get, HttpCode, ServiceUnavailableException } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse } from '@nestjs/swagger';
import { SkipThrottle } from '@nestjs/throttler';
import { HealthService, HealthStatus } from './health.service';

@ApiTags('Health')
@SkipThrottle()
@Controller('api/health')
export class HealthController {
  constructor(private healthService: HealthService) {}

  @Get()
  @HttpCode(200)
  @ApiOperation({ summary: 'Verificar saúde da aplicação' })
  @ApiResponse({
    status: 200,
    description: 'Aplicação está saudável',
    type: Object,
  })
  @ApiResponse({
    status: 503,
    description: 'Banco de dados ou Redis indisponível',
  })
  async check(): Promise<HealthStatus> {
    const health = await this.healthService.getHealth();

    // 503 faz o HEALTHCHECK do Docker e o ALB perceberem que a instância não está saudável
    if (health.status !== 'ok') {
      throw new ServiceUnavailableException(health);
    }

    return health;
  }
}
