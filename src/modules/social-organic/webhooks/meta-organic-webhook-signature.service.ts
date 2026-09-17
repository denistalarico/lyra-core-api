import { Injectable } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import {
  requireSocialMetaAppSecret,
  requireSocialMetaInstagramAppSecret,
} from '../providers/meta/meta-organic-oauth.support';

export const META_SIGNATURE_HEADER = 'x-hub-signature-256';
const SIGNATURE_PREFIX = 'sha256=';
const HEX_DIGEST_LENGTH = 64;

/**
 * Why the failure reasons are this granular internally and this coarse
 * externally: an operator debugging a Meta subscription needs to know whether
 * the header was absent or merely wrong, but a caller must learn nothing that
 * distinguishes "your secret is stale" from "your body was rewritten". These
 * codes are logged and persisted; the HTTP response carries one message.
 */
export type MetaOrganicSignatureFailure =
  | 'signature_secret_not_configured'
  | 'signature_missing'
  | 'signature_malformed'
  | 'raw_body_unavailable'
  | 'signature_mismatch';

export class MetaOrganicWebhookSignatureError extends Error {
  constructor(readonly code: MetaOrganicSignatureFailure) {
    super(code);
    this.name = 'MetaOrganicWebhookSignatureError';
  }
}

/**
 * HMAC verification for Meta Organic webhook deliveries.
 *
 * **This is a separate app from Inbox and must stay separate.** The secret is
 * the Lyra Social app's (`SOCIAL_META_APP_SECRET`, via the existing
 * `requireSocialMetaAppSecret()` helper). `META_APP_SECRET` belongs to the
 * Messaging app and would verify a *different* sender's payloads — reading it
 * here would mean trusting the wrong signer, which is why
 * `meta-organic-webhook.boundary.spec.ts` fails the build if its name appears
 * anywhere in this directory.
 *
 * Three properties this implementation must keep:
 *
 * - **The bytes are the message.** The HMAC is computed over the exact received
 *   buffer, never over `JSON.stringify(parsedBody)`. Re-serializing changes key
 *   order, unicode escaping and whitespace, and the resulting digest would be
 *   of a document Meta never sent.
 * - **Comparison is constant-time and length-checked first.**
 *   `timingSafeEqual` throws on unequal lengths, so the length check is not an
 *   optimization — it is what keeps the call legal. Because the digest length
 *   is fixed and validated during parsing, the compared buffers are always the
 *   same size by the time they reach `timingSafeEqual`.
 * - **Parsing is strict.** A well-formed header is exactly `sha256=` followed
 *   by 64 lowercase hex characters. Anything else is rejected before any
 *   cryptography runs, so a malformed header can never be coerced into a
 *   comparison against a truncated digest.
 */
@Injectable()
export class MetaOrganicWebhookSignatureService {
  /**
   * @throws MetaOrganicWebhookSignatureError with a safe internal code.
   */
  verify(input: { signatureHeader?: string; rawBody?: Buffer }): void {
    const secrets = this.readSecrets();
    if (secrets.length === 0) {
      throw new MetaOrganicWebhookSignatureError(
        'signature_secret_not_configured',
      );
    }

    const rawBody = input.rawBody;
    if (!rawBody || !Buffer.isBuffer(rawBody)) {
      // Not a client error: it means `rawBody: true` is no longer wired up, so
      // no signature could be checked against anything meaningful.
      throw new MetaOrganicWebhookSignatureError('raw_body_unavailable');
    }

    const received = this.parseSignature(input.signatureHeader);
    const matches = secrets.some((secret) => {
      const expected = Buffer.from(
        createHmac('sha256', secret).update(rawBody).digest('hex'),
        'hex',
      );
      return (
        received.length === expected.length && timingSafeEqual(received, expected)
      );
    });
    if (!matches) {
      throw new MetaOrganicWebhookSignatureError('signature_mismatch');
    }
  }

  /** `true` when an accepted app secret is configured; never returns it. */
  isConfigured(): boolean {
    return this.readSecrets().length > 0;
  }

  private parseSignature(header: string | undefined): Buffer {
    const value = header?.trim();
    if (!value) {
      throw new MetaOrganicWebhookSignatureError('signature_missing');
    }
    if (!value.startsWith(SIGNATURE_PREFIX)) {
      throw new MetaOrganicWebhookSignatureError('signature_malformed');
    }

    const digest = value.slice(SIGNATURE_PREFIX.length);
    if (digest.length !== HEX_DIGEST_LENGTH || !/^[0-9a-f]+$/.test(digest)) {
      throw new MetaOrganicWebhookSignatureError('signature_malformed');
    }

    return Buffer.from(digest, 'hex');
  }

  /**
   * `requireSocialMetaAppSecret()` throws when unconfigured; a missing secret
   * is an operational state this service reports as a code rather than letting
   * an OAuth-shaped exception escape from a webhook path.
   */
  private readSecrets(): string[] {
    const secrets = [
      this.readSecret(requireSocialMetaAppSecret),
      this.readSecret(requireSocialMetaInstagramAppSecret),
    ].filter((secret): secret is string => Boolean(secret));
    return [...new Set(secrets)];
  }

  private readSecret(read: () => string): string | null {
    try {
      return read();
    } catch {
      return null;
    }
  }
}
