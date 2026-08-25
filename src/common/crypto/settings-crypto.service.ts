import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

/**
 * Secret used when `SETTINGS_ENCRYPTION_KEY` is absent outside production.
 *
 * It exists so a developer can run the API without provisioning secrets, and
 * so the existing specs keep a stable key. It is a known constant published in
 * this repository: anything encrypted with it is readable by anyone who can
 * read this file, which is why production refuses to boot with it.
 */
export const DEV_FALLBACK_SETTINGS_ENCRYPTION_SECRET =
  'lyra_dev_fallback_secret';

export const SETTINGS_ENCRYPTION_KEY_ENV = 'SETTINGS_ENCRYPTION_KEY';

/**
 * Thrown at boot when production cannot produce a usable encryption key.
 *
 * The message never carries the configured value — a boot failure is logged
 * and frequently shipped to third parties, so it may only name the variable.
 */
export class SettingsEncryptionKeyError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'SettingsEncryptionKeyError';
  }
}

type EnvSource = Pick<NodeJS.ProcessEnv, string>;

function isProductionEnv(env: EnvSource) {
  return (env.NODE_ENV ?? '').trim().toLowerCase() === 'production';
}

/**
 * Resolves the secret the AES key is derived from.
 *
 * Production is fail-closed: a missing key, a blank key, or the development
 * fallback all abort instead of silently deriving a key that everyone knows.
 * Encrypting a WhatsApp token, a Meta Ads token or a vault note under a public
 * constant is worse than not encrypting it, because the column name claims a
 * protection that is not there.
 *
 * Development and test keep the previous behavior so local runs and the
 * existing suites are unaffected. The only change outside production is that a
 * blank value now falls back instead of deriving a key from the empty string.
 */
export function resolveSettingsEncryptionSecret(
  env: EnvSource = process.env,
): string {
  const configured = env[SETTINGS_ENCRYPTION_KEY_ENV]?.trim();

  if (!isProductionEnv(env)) {
    return configured || DEV_FALLBACK_SETTINGS_ENCRYPTION_SECRET;
  }

  if (!configured) {
    throw new SettingsEncryptionKeyError(
      `${SETTINGS_ENCRYPTION_KEY_ENV} is required when NODE_ENV=production. ` +
        'Set it in the API environment before starting the service.',
    );
  }

  if (configured === DEV_FALLBACK_SETTINGS_ENCRYPTION_SECRET) {
    throw new SettingsEncryptionKeyError(
      `${SETTINGS_ENCRYPTION_KEY_ENV} is set to the development fallback, ` +
        'which is a public constant. Set a private value before starting the service.',
    );
  }

  return configured;
}

@Injectable()
export class SettingsCryptoService implements OnModuleInit {
  private readonly logger = new Logger(SettingsCryptoService.name);

  /**
   * Fails the boot rather than the first encrypt/decrypt.
   *
   * A key resolved lazily would let the process come up healthy and only break
   * when someone tries to connect a channel — by which point the failure looks
   * like a provider problem, not a configuration one.
   */
  onModuleInit() {
    resolveSettingsEncryptionSecret();

    if (!process.env[SETTINGS_ENCRYPTION_KEY_ENV]?.trim()) {
      this.logger.warn(
        `${SETTINGS_ENCRYPTION_KEY_ENV} is not set; using the development ` +
          'fallback secret. Stored credentials are not protected.',
      );
    }
  }

  private getKey() {
    return createHash('sha256')
      .update(resolveSettingsEncryptionSecret())
      .digest();
  }

  encrypt(value: string | null | undefined): string | null {
    if (!value) return null;

    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', this.getKey(), iv);

    const encrypted = Buffer.concat([
      cipher.update(value, 'utf8'),
      cipher.final(),
    ]);

    const authTag = cipher.getAuthTag();

    return Buffer.concat([iv, authTag, encrypted]).toString('base64');
  }

  decrypt(payload: string | null | undefined): string | null {
    if (!payload) return null;

    const raw = Buffer.from(payload, 'base64');
    const iv = raw.subarray(0, 12);
    const authTag = raw.subarray(12, 28);
    const encrypted = raw.subarray(28);

    const decipher = createDecipheriv('aes-256-gcm', this.getKey(), iv);
    decipher.setAuthTag(authTag);

    return Buffer.concat([
      decipher.update(encrypted),
      decipher.final(),
    ]).toString('utf8');
  }
}
