import { NotFoundException } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { CLIENT_AREA_ERROR_CODES } from './client-area.types';

export const CLIENT_AREA_ENABLED_ENV = 'CLIENT_AREA_ENABLED';
export const CLIENT_AREA_ACCESS_SECRET_ENV = 'JWT_CLIENT_AREA_ACCESS_SECRET';

/** Shorter secrets are treated as absent: the surface stays closed. */
export const CLIENT_AREA_MIN_SECRET_LENGTH = 32;

/**
 * The Client Area signing secret, or `null` when the surface must stay closed.
 *
 * There is intentionally **no fallback** to `JWT_ACCESS_SECRET`: Agency
 * controllers trust `x-tenant-id`/`x-user-id` headers after `JwtAuthGuard`,
 * so a Client Area token that verified under the Agency secret would be a
 * master key (CA0 risk 1). For the same reason a secret equal to the Agency
 * or 2FA secret is rejected — equal values would make the tokens
 * interchangeable at the signature level.
 */
export function resolveClientAreaAccessSecret(
  config: Pick<ConfigService, 'get'>,
): string | null {
  const secret = config.get<string>(CLIENT_AREA_ACCESS_SECRET_ENV)?.trim();

  if (!secret || secret.length < CLIENT_AREA_MIN_SECRET_LENGTH) {
    return null;
  }

  const foreignSecrets = ['JWT_ACCESS_SECRET', 'JWT_2FA_SECRET'].map((name) =>
    config.get<string>(name)?.trim(),
  );

  if (foreignSecrets.includes(secret)) {
    return null;
  }

  return secret;
}

/**
 * Fail-closed feature gate: OFF unless `CLIENT_AREA_ENABLED=true` **and** a
 * valid dedicated secret is configured.
 */
export function isClientAreaEnabled(config: Pick<ConfigService, 'get'>) {
  const flag = config
    .get<string>(CLIENT_AREA_ENABLED_ENV)
    ?.trim()
    .toLowerCase();

  return flag === 'true' && resolveClientAreaAccessSecret(config) !== null;
}

export function assertClientAreaEnabled(config: Pick<ConfigService, 'get'>) {
  if (!isClientAreaEnabled(config)) {
    throw new NotFoundException({
      statusCode: 404,
      error: 'Not Found',
      message: 'Client Area is not available.',
      code: CLIENT_AREA_ERROR_CODES.disabled,
    });
  }
}
