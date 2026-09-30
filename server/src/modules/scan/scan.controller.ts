import {
  Controller,
  Post,
  Get,
  Param,
  UseGuards,
  HttpCode,
  HttpStatus,
} from '@nestjs/common';
import { ApiTags, ApiOperation, ApiResponse, ApiBearerAuth } from '@nestjs/swagger';
import { ScanService } from './services/scan.service';
import { ScanResultDto, ScanHistoryDto } from './dto/scan.dto';
import { CurrentUser } from '../../api/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';

@ApiTags('scan')
@ApiBearerAuth()
@Controller('api/v1/scan')
@UseGuards(JwtAuthGuard)
export class ScanController {
  constructor(private scanService: ScanService) {}

  @Post()
  @HttpCode(HttpStatus.CREATED)
  @ApiOperation({ summary: 'Run a breach analysis for the logged-in user email' })
  @ApiResponse({
    status: 201,
    description: 'Scan submitted successfully',
    type: ScanResultDto,
  })
  async submitScan(@CurrentUser('sub') userId: number): Promise<ScanResultDto> {
    // O email vem da conta logada, nunca do corpo da requisição,
    // para ninguém consultar os vazamentos de outra pessoa
    return this.scanService.submitScanForUser(userId);
  }

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
