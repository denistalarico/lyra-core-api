import { ValidationPipe } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { AppModule } from './app.module';

function parseCorsOrigins(): string[] {
  const configuredOrigins =
    process.env.CORS_ORIGINS ??
    process.env.APP_FRONTEND_URL ??
    'http://localhost:3003';

  return configuredOrigins
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
}

async function bootstrap() {
  const app = await NestFactory.create<NestExpressApplication>(AppModule, {
    rawBody: true,
  });
  app.enableShutdownHooks();

  const allowedOrigins = parseCorsOrigins();

  app.enableCors({
    origin(origin, callback) {
      // Requisições server-to-server, healthchecks e curl podem não ter Origin.
      if (!origin || allowedOrigins.includes(origin)) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-tenant-id',
      'x-workspace-id',
      'x-user-id',
      'x-user-role',
      'x-user-name',
      'x-lyra-product-key',
      'x-lyra-operating-mode',
      'x-lyra-client-id',
      'x-leadflow-operating-mode',
      'x-client-id',
    ],
    credentials: false,
  });

  // Use Nest's adapter-aware parsers so `rawBody: true` keeps the exact
  // request bytes required for Meta's X-Hub-Signature-256 validation.
  app.useBodyParser('json', { limit: '10mb' });
  app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });

  app.setGlobalPrefix('api');

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      transform: true,
      forbidNonWhitelisted: true,
    }),
  );

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  const host = process.env.HOST ?? '127.0.0.1';

  await app.listen(port, host);
}

void bootstrap();
