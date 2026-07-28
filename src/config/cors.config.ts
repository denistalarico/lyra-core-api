import type { CorsOptions } from '@nestjs/common/interfaces/external/cors-options.interface';

export const CORS_ALLOWED_HEADERS = [
  'Content-Type',
  'Authorization',
  'Idempotency-Key',
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
] as const;

export const DEFAULT_ADMIN_WEB_ORIGIN = 'http://localhost:3002';

export function parseConfiguredOrigins(value?: string): string[] {
  return (value ?? '')
    .split(',')
    .map((origin) => normalizeOrigin(origin))
    .filter((origin): origin is string => Boolean(origin));
}

export function getAdminWebOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const configured = parseConfiguredOrigins(environment.ADMIN_WEB_ORIGIN);
  if (configured.length > 0) {
    return configured;
  }

  return environment.NODE_ENV === 'production'
    ? []
    : [DEFAULT_ADMIN_WEB_ORIGIN];
}

export function getCorsAllowedOrigins(
  environment: NodeJS.ProcessEnv = process.env,
): string[] {
  const sharedOrigins = parseConfiguredOrigins(
    environment.CORS_ORIGINS ??
      environment.APP_FRONTEND_URL ??
      'http://localhost:3003',
  );

  return [...new Set([...sharedOrigins, ...getAdminWebOrigins(environment)])];
}

export function buildCorsOptions(
  environment: NodeJS.ProcessEnv = process.env,
): CorsOptions {
  const allowedOrigins = getCorsAllowedOrigins(environment);

  return {
    origin(origin, callback) {
      if (!origin || allowedOrigins.includes(normalizeOrigin(origin) ?? '')) {
        callback(null, true);
        return;
      }

      callback(null, false);
    },
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    credentials: true,
  };
}

export function normalizeOrigin(value?: string): string | null {
  const candidate = value?.trim();
  if (!candidate) {
    return null;
  }

  try {
    return new URL(candidate).origin;
  } catch {
    return null;
  }
}
