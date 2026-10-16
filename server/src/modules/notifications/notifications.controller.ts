import { Controller, Get, HttpCode, HttpStatus, Param, ParseIntPipe, Patch, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiResponse, ApiTags } from '@nestjs/swagger';
import { CurrentUser } from '../../api/decorators/current-user.decorator';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { ListNotificationsQueryDto } from './dto/notifications.dto';
import { NotificationDto, NotificationsService } from './notifications.service';

const notificationSchema = {
  type: 'object',
  properties: {
    id: { type: 'number' },
    type: { type: 'string', example: 'NEW_BREACH' },
    title: { type: 'string' },
    body: { type: 'string' },
    breachNames: { type: 'array', items: { type: 'string' } },
    riskScoreBefore: { type: 'number', nullable: true },
    riskScoreAfter: { type: 'number', nullable: true },
    classification: { type: 'string', nullable: true },
    readAt: { type: 'string', nullable: true },
    createdAt: { type: 'string' },
  },
};

@ApiTags('notifications')
@ApiBearerAuth()
@Controller('api/v1/notifications')
@UseGuards(JwtAuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get()
  @ApiOperation({ summary: 'Lista as notificações do usuário (paginada por cursor)' })
  @ApiResponse({
    status: 200,
    schema: {
      type: 'object',
      properties: {
        items: { type: 'array', items: notificationSchema },
        nextCursor: { type: 'number', nullable: true },
      },
    },
  })
  async list(
    @CurrentUser('sub') userId: number,
    @Query() query: ListNotificationsQueryDto,
  ): Promise<{ items: NotificationDto[]; nextCursor: number | null }> {
    return this.notifications.list(userId, query.cursor, query.limit);
  }

  @Get('unread-count')
  @ApiOperation({ summary: 'Quantidade de notificações não lidas (sino do Navbar)' })
  @ApiResponse({ status: 200, schema: { type: 'object', properties: { count: { type: 'number' } } } })
  async unreadCount(@CurrentUser('sub') userId: number): Promise<{ count: number }> {
    return { count: await this.notifications.unreadCount(userId) };
  }

  @Patch('read-all')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marca todas as notificações como lidas' })
  async markAllRead(@CurrentUser('sub') userId: number): Promise<void> {
    await this.notifications.markAllRead(userId);
  }

  @Patch(':id/read')
  @HttpCode(HttpStatus.NO_CONTENT)
  @ApiOperation({ summary: 'Marca uma notificação como lida' })
  @ApiResponse({ status: 404, description: 'Notificação não encontrada' })
  async markRead(@CurrentUser('sub') userId: number, @Param('id', ParseIntPipe) id: number): Promise<void> {
    await this.notifications.markRead(userId, id);
  }
}
