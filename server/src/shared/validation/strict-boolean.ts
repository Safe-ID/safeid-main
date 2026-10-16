import { applyDecorators } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { IsBoolean } from 'class-validator';

/**
 * Booleano estrito. O ValidationPipe global usa enableImplicitConversion, que converte
 * qualquer string em true (inclusive "false"). Aqui a validação usa o valor original
 * do corpo: só true/false de verdade passam. Importante para consentimentos (LGPD).
 */
export function StrictBoolean(): PropertyDecorator {
  return applyDecorators(
    Transform(({ obj, key }) => obj[key], { toClassOnly: true }),
    IsBoolean(),
  );
}
