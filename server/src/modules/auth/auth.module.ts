/**
 * Authentication Module
 * Configura JWT, estratégia, e provedores de autenticação
 */

import { Module } from '@nestjs/common';
import { JwtModule } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { AuthService } from './auth.service';
import { AuthController } from './auth.controller';
import { JwtStrategy } from './strategies/jwt.strategy';
import { DatabaseModule } from '../../infra/database/database.module';
import { ScanModule } from '../scan/scan.module';

@Module({
  imports: [
    PassportModule.register({ defaultStrategy: 'jwt' }),
    // registerAsync lê o segredo depois que o ConfigModule carregou o .env.
    // Com register, o JWT_SECRET era lido antes e ficava undefined.
    JwtModule.registerAsync({
      useFactory: () => ({
        secret: process.env.JWT_SECRET,
        signOptions: {
          expiresIn: '24h' as any,
        },
      }),
    }),
    DatabaseModule,
    ScanModule,
  ],
  controllers: [AuthController],
  providers: [AuthService, JwtStrategy],
  exports: [AuthService, JwtStrategy, PassportModule],
})
export class AuthModule {}
