import { Body, Controller, Get, HttpCode, HttpStatus, Patch, Post, Query, Res, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Response } from 'express';
import { CurrentUser } from '../../api/decorators/current-user.decorator';
import { RATE_LIMITS } from '../../infra/rate-limit/rate-limit.module';
import { getFrontendUrl } from '../../shared/config/urls';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { MonitoringPreferencesDto } from './dto/monitoring.dto';
import { MonitoringPreferencesService, MonitoringStatus } from './services/monitoring-preferences.service';

@ApiTags('monitoring')
@Controller('api/v1/monitoring')
export class MonitoringController {
  constructor(private readonly preferences: MonitoringPreferencesService) {}

  @Get('status')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Estado do monitoramento de vazamentos do usuário' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        enabled: { type: 'boolean' },
        lastMonitoredAt: { type: 'string', nullable: true },
        lastCatalogSyncAt: { type: 'string', nullable: true },
      },
    },
  })
  async status(@CurrentUser('sub') userId: number): Promise<MonitoringStatus> {
    return this.preferences.getStatus(userId);
  }

  @Patch('preferences')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Liga ou desliga os alertas. Ao ligar, agenda uma checagem imediata.' })
  async updatePreferences(
    @CurrentUser('sub') userId: number,
    @Body() dto: MonitoringPreferencesDto,
  ): Promise<MonitoringStatus> {
    return this.preferences.setEnabled(userId, dto.enabled);
  }

  @Get('unsubscribe')
  @Throttle(RATE_LIMITS.unsubscribe)
  @ApiOperation({ summary: 'Link de opt-out do e-mail: desliga os alertas e redireciona para o site' })
  @ApiQuery({ name: 'token', required: true })
  @ApiResponse({ status: 302, description: 'Redireciona para /?monitoring=disabled (ou =invalid)' })
  async unsubscribeLink(@Query('token') token: string, @Res() res: Response): Promise<void> {
    const ok = await this.preferences.unsubscribeByToken(token);
    res.redirect(302, `${getFrontendUrl()}/?monitoring=${ok ? 'disabled' : 'invalid'}`);
  }

  @Post('unsubscribe')
  @Throttle(RATE_LIMITS.unsubscribe)
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Opt-out one-click (RFC 8058), chamado pelo próprio cliente de e-mail' })
  @ApiQuery({ name: 'token', required: true })
  @ApiResponse({ status: 200, description: 'Alertas desligados' })
  @ApiResponse({ status: 400, description: 'Token inválido' })
  async unsubscribeOneClick(@Query('token') token: string, @Res() res: Response): Promise<void> {
    const ok = await this.preferences.unsubscribeByToken(token);
    if (!ok) {
      res.status(HttpStatus.BAD_REQUEST).json({ code: 'TOKEN_INVALID', message: 'Link de descadastro inválido.' });
      return;
    }
    res.status(HttpStatus.OK).json({ message: 'Alertas de vazamento desativados.' });
  }
}
