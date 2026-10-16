import { Controller, Get, UseGuards } from '@nestjs/common';
import { ApiHeader, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { AdminTokenGuard } from '../../api/guards/admin-token.guard';
import { JobsHealthReport, JobsHealthService } from './services/jobs-health.service';

@ApiTags('health')
@Controller('api/health')
export class JobsHealthController {
  constructor(private readonly jobsHealth: JobsHealthService) {}

  @Get('jobs')
  @UseGuards(AdminTokenGuard)
  @ApiOperation({ summary: 'Estado das filas, agendamentos e workers do monitoramento (operação)' })
  @ApiHeader({ name: 'X-Admin-Token', required: true, description: 'Valor de ADMIN_TOKEN' })
  @ApiResponse({ status: 200, description: 'Relatório; cada parte indisponível vem como { error }' })
  @ApiResponse({ status: 401, description: 'Token administrativo inválido' })
  @ApiResponse({ status: 403, description: 'ADMIN_TOKEN não configurado (rota desligada)' })
  async jobs(): Promise<JobsHealthReport> {
    return this.jobsHealth.getReport();
  }
}
