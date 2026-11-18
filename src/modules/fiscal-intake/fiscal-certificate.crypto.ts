import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createCipheriv, createDecipheriv, randomBytes } from 'crypto';

export const FISCAL_CERT_KEY_ENV = 'FISCAL_CERT_ENCRYPTION_KEY';
export const FISCAL_CERT_KEY_VERSION_ENV = 'FISCAL_CERT_ENCRYPTION_KEY_VERSION';

type EnvSource = Pick<NodeJS.ProcessEnv, string>;

type ResolvedKey = { version: number; key: Buffer };

function parseKey(raw: string | undefined): Buffer | null {
  const value = raw?.trim();
  if (!value) return null;
  const key = Buffer.from(value, 'base64');
  // `openssl rand -base64 32` → exactly 32 bytes; anything else is a typo.
  return key.length === 32 && key.toString('base64') === value ? key : null;
}

/**
 * Current key and the older ones still needed to read stored certificates.
 *
 * `FISCAL_CERT_ENCRYPTION_KEY` is the current key, with version
 * `FISCAL_CERT_ENCRYPTION_KEY_VERSION` (default 1). Rotation (§8.4): keep the
 * previous value under `FISCAL_CERT_ENCRYPTION_KEY_V<n>`, set the new key and
 * bump the version; rows keep their own `certificate_key_version`.
 */
export function resolveFiscalCertKeys(env: EnvSource = process.env): {
  current: ResolvedKey | null;
  byVersion: Map<number, Buffer>;
} {
  const byVersion = new Map<number, Buffer>();
  for (const [name, value] of Object.entries(env)) {
    const match = /^FISCAL_CERT_ENCRYPTION_KEY_V(\d+)$/.exec(name);
    const key = match ? parseKey(value) : null;
    if (match && key) byVersion.set(Number(match[1]), key);
  }
  const key = parseKey(env[FISCAL_CERT_KEY_ENV]);
  const version = Number(env[FISCAL_CERT_KEY_VERSION_ENV]?.trim() || '1');
  if (!key || !Number.isInteger(version) || version < 1)
    return { current: null, byVersion };
  byVersion.set(version, key);
  return { current: { version, key }, byVersion };
}

export class FiscalCertificateKeyUnavailableError extends Error {
  constructor(
    message = 'O envio de certificado está desativado: a chave de criptografia fiscal não está configurada.',
  ) {
    super(message);
    this.name = 'FiscalCertificateKeyUnavailableError';
  }
}

/**
 * Envelope for the A1 certificate and its passwords (§8.4): AES-256-GCM with
 * a dedicated key, separate from SETTINGS_ENCRYPTION_KEY. Fail-closed: there
 * is no fallback key in any environment — without the key, upload is off.
 */
@Injectable()
export class FiscalCertificateCrypto implements OnModuleInit {
  private readonly logger = new Logger(FiscalCertificateCrypto.name);

  onModuleInit() {
    if (!this.isAvailable()) {
      // Only the variable name: a boot log may be shipped to third parties.
      this.logger.warn(
        `${FISCAL_CERT_KEY_ENV} is missing or is not 32 bytes in base64; A1 certificate upload is disabled.`,
      );
    }
  }

  isAvailable(): boolean {
    return resolveFiscalCertKeys().current !== null;
  }

  /** Returns the ciphertext (iv|tag|data) and the key version used. */
  encrypt(plain: Buffer): { payload: Buffer; keyVersion: number } {
    const { current } = resolveFiscalCertKeys();
    if (!current) throw new FiscalCertificateKeyUnavailableError();
    const iv = randomBytes(12);
    const cipher = createCipheriv('aes-256-gcm', current.key, iv);
    const data = Buffer.concat([cipher.update(plain), cipher.final()]);
    return {
      payload: Buffer.concat([iv, cipher.getAuthTag(), data]),
      keyVersion: current.version,
    };
  }

  /** Text secrets (passwords) carry their key version: `v<n>:<base64>`. */
  encryptText(value: string): string {
    const { payload, keyVersion } = this.encrypt(Buffer.from(value, 'utf8'));
    return `v${keyVersion}:${payload.toString('base64')}`;
  }

  decrypt(payload: Buffer, keyVersion: number): Buffer {
    const key = resolveFiscalCertKeys().byVersion.get(keyVersion);
    if (!key)
      throw new FiscalCertificateKeyUnavailableError(
        `A chave fiscal da versão ${keyVersion} não está configurada.`,
      );
    const decipher = createDecipheriv(
      'aes-256-gcm',
      key,
      payload.subarray(0, 12),
    );
    decipher.setAuthTag(payload.subarray(12, 28));
    return Buffer.concat([
      decipher.update(payload.subarray(28)),
      decipher.final(),
    ]);
  }

  decryptText(value: string): string {
    const match = /^v(\d+):(.+)$/s.exec(value);
    if (!match)
      throw new FiscalCertificateKeyUnavailableError(
        'Segredo fiscal em formato desconhecido.',
      );
    return this.decrypt(
      Buffer.from(match[2], 'base64'),
      Number(match[1]),
    ).toString('utf8');
  }
}
