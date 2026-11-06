import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import { AppModule } from './app.module';
import { getAppRole, servesHttp } from './shared/config/app-role';
import { log } from './shared/utils/logger';
import { applyServerTimeouts } from './shared/http/server-timeouts';

async function bootstrap() {
  // APP_ROLE=worker: só workers e agendamentos, sem abrir porta HTTP
  if (!servesHttp()) {
    const context = await NestFactory.createApplicationContext(AppModule);
    context.enableShutdownHooks();
    log('info', 'Bootstrap', 'app.started', { role: getAppRole() });
    return;
  }

  const app = await NestFactory.create(AppModule);

  // Repassa SIGTERM/SIGINT para os hooks de shutdown: fecha workers, filas e conexões
  // antes do ECS derrubar a task (stopTimeout de 120 s no deploy)
  app.enableShutdownHooks();

  // Environment variables
  const port = process.env.APP_PORT || 3000;
  const nodeEnv = process.env.NODE_ENV || 'development';

  // Security middleware
  app.use(helmet());
  app.use(compression());

  // CORS configuration
  app.enableCors({
    origin: process.env.CORS_ORIGIN || 'http://localhost:3001',
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
  });

  // Global validation pipe
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: {
        enableImplicitConversion: true,
      },
    }),
  );

  // Swagger/OpenAPI documentation
  if (process.env.SWAGGER_ENABLED === 'true') {
    const config = new DocumentBuilder()
      .setTitle('SafeID Backend API')
      .setDescription('API REST para o sistema SafeID - Proteção de Identidade Segura')
      .setVersion('0.1.0')
      .addBearerAuth()
      .addServer(`http://localhost:${port}`, 'Development')
      .build();

    const document = SwaggerModule.createDocument(app, config);
    SwaggerModule.setup(process.env.SWAGGER_PATH || 'api/docs', app, document, {
      swaggerOptions: {
        persistAuthorization: true,
      },
    });
  }

  // Global error handling middleware can be added here
  // Global interceptors can be added here

  // Keep-alive maior que o idle timeout do ALB: evita 502 em conexões reaproveitadas
  applyServerTimeouts(app.getHttpServer());

  await app.listen(port, () => {
    log('info', 'Bootstrap', 'app.started', {
      port,
      env: nodeEnv,
      swaggerPath: process.env.SWAGGER_ENABLED === 'true' ? `/${process.env.SWAGGER_PATH || 'api/docs'}` : null,
    });
  });
}

bootstrap().catch((err) => {
  log('error', 'Bootstrap', 'app.start_failed', { error: err });
  process.exit(1);
});
