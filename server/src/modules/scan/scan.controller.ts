import { Controller, Get, Param, UseGuards } from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ScanService } from './services/scan.service';
import { ScanHistoryDto } from './dto/scan.dto';
import { CurrentUser } from '../../api/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('scan')
@ApiBearerAuth()
// Não há rota para o usuário disparar um scan: ele roda no cadastro, quando surge um
// vazamento novo (monitoramento) e de novo, sozinho, se o do cadastro falhar
@Controller('api/v1/scan')
@UseGuards(JwtAuthGuard)
export class ScanController {
  constructor(private scanService: ScanService) {}

  @Get('history')
  @ApiOperation({ summary: 'Get user scan history' })
  @ApiResponse({
    status: 200,
    description: 'List of user scans',
    type: [ScanHistoryDto],
  })
  async getHistory(@CurrentUser('sub') userId: number): Promise<ScanHistoryDto[]> {
    return this.scanService.getUserHistory(userId);
  }

  @Get(':jobId')
  @ApiOperation({ summary: 'Get scan result by job ID' })
  @ApiResponse({
    status: 200,
    description: 'Scan result details',
  })
  async getScanDetail(
    @CurrentUser('sub') userId: number,
    @Param('jobId') jobId: string,
  ): Promise<any> {
    return this.scanService.getScanDetail(userId, jobId);
  }
}
