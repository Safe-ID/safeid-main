import { NestFactory } from '@nestjs/core';
import { SwaggerModule, DocumentBuilder } from '@nestjs/swagger';
import { ValidationPipe } from '@nestjs/common';
import helmet from 'helmet';
import compression from 'compression';
import session from 'express-session';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  // Environment variables
  const port = process.env.APP_PORT || 3000;
  const nodeEnv = process.env.NODE_ENV || 'development';

  // Security middleware
  app.use(helmet());
  app.use(compression());

  // Session middleware
  app.use(
    session({
      secret: process.env.SESSION_SECRET || 'local-session-secret',
      resave: false,
      saveUninitialized: false,
      cookie: {
        httpOnly: true,
        secure: nodeEnv === 'production',
        sameSite: 'strict',
        maxAge: 24 * 60 * 60 * 1000, // 24 hours
      },
    }),
  );

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

  await app.listen(port, () => {
    console.log(`🚀 SafeID Backend iniciado em http://localhost:${port}`);
    if (process.env.SWAGGER_ENABLED === 'true') {
      console.log(`📚 Swagger disponível em http://localhost:${port}/${process.env.SWAGGER_PATH || 'api/docs'}`);
    }
    console.log(`🌍 Ambiente: ${nodeEnv}`);
  });
}

bootstrap().catch((err) => {
  console.error('❌ Erro ao iniciar a aplicação:', err);
  process.exit(1);
});
