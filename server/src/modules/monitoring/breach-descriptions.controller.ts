import { BadRequestException, Controller, Get, Query, UseGuards } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { BreachDescription, BreachDescriptionService } from './services/breach-description.service';

const MAX_NAMES = 50;
const MAX_NAME_LENGTH = 120;

/** Converte "A,B,C" em nomes únicos e válidos; recusa listas grandes ou nomes absurdos */
export function parseNames(raw: unknown): string[] {
  if (typeof raw !== 'string' || raw.trim() === '') {
    throw new BadRequestException('Informe os vazamentos em names (separados por vírgula).');
  }
  const names = Array.from(new Set(raw.split(',').map(name => name.trim()).filter(Boolean)));
  if (names.length === 0) {
    throw new BadRequestException('Informe os vazamentos em names (separados por vírgula).');
  }
  if (names.length > MAX_NAMES) {
    throw new BadRequestException(`No máximo ${MAX_NAMES} vazamentos por consulta.`);
  }
  if (names.some(name => name.length > MAX_NAME_LENGTH)) {
    throw new BadRequestException('Nome de vazamento inválido.');
  }
  return names;
}

@ApiTags('breaches')
@Controller('api/v1/breaches')
export class BreachDescriptionsController {
  constructor(private readonly descriptions: BreachDescriptionService) {}

  @Get('descriptions')
  @UseGuards(JwtAuthGuard)
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Descrições dos vazamentos (Have I Been Pwned, CC BY 4.0), traduzidas quando disponível',
    description:
      'Cada descrição vem em trechos { text, href?, em?, strong? } para o front montar sem HTML. ' +
      'lang "pt" indica tradução automática; "en", o texto original da HIBP.',
  })
  @ApiQuery({ name: 'names', description: 'Nomes dos vazamentos (Breach.Name), separados por vírgula', example: 'Adobe,Canva' })
  async list(@Query('names') names: string): Promise<Record<string, BreachDescription>> {
    return this.descriptions.getDescriptions(parseNames(names));
  }
}
