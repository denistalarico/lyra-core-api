import { Injectable, InternalServerErrorException } from "@nestjs/common";
import { createCipheriv, createDecipheriv, randomBytes } from "crypto";

type EncryptedPayload = {
  encryptedValue: string;
  iv: string;
  authTag: string;
  keyVersion: number;
};

@Injectable()
export class KnowledgeVaultCryptoService {
  private readonly algorithm = "aes-256-gcm";

  encrypt(value: string): EncryptedPayload {
    const key = this.getMasterKey();
    const iv = randomBytes(12);
    const cipher = createCipheriv(this.algorithm, key, iv);

    const encrypted = Buffer.concat([
      cipher.update(value, "utf8"),
      cipher.final(),
    ]);

    return {
      encryptedValue: encrypted.toString("base64"),
      iv: iv.toString("base64"),
      authTag: cipher.getAuthTag().toString("base64"),
      keyVersion: Number(process.env.LYRA_VAULT_KEY_VERSION ?? 1),
    };
  }

  decrypt(encryptedValue: string, iv: string, authTag: string): string {
    const key = this.getMasterKey();
    const decipher = createDecipheriv(
      this.algorithm,
      key,
      Buffer.from(iv, "base64"),
    );

    decipher.setAuthTag(Buffer.from(authTag, "base64"));

    const decrypted = Buffer.concat([
      decipher.update(Buffer.from(encryptedValue, "base64")),
      decipher.final(),
    ]);

    return decrypted.toString("utf8");
  }

  private getMasterKey(): Buffer {
    const rawKey =
      process.env.LYRA_VAULT_MASTER_KEY ??
      process.env.SETTINGS_ENCRYPTION_KEY;

    if (!rawKey) {
      throw new InternalServerErrorException(
        "LYRA_VAULT_MASTER_KEY is not configured",
      );
    }

    return Buffer.from(rawKey.padEnd(32, "0").slice(0, 32), "utf8");
  }
}
