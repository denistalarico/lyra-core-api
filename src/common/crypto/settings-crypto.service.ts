import { Injectable } from '@nestjs/common';
import {
  createCipheriv,
  createDecipheriv,
  createHash,
  randomBytes,
} from 'crypto';

@Injectable()
export class SettingsCryptoService {
  private getKey() {
    const secret =
      process.env.SETTINGS_ENCRYPTION_KEY ?? 'lyra_dev_fallback_secret';
    return createHash('sha256').update(secret).digest();
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
