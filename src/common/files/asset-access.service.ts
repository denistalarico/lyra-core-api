import { createHmac, timingSafeEqual } from 'node:crypto';

import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';

/**
 * Authorization for `GET /api/assets/*path` (CCOM0.5 §23–§28).
 *
 * ## Why this shape
 *
 * `/api/assets/*` had no guard at all: the storage path WAS the capability, so
 * every Team Chat attachment was readable by anyone who had or guessed the URL,
 * with no session (CCOM0 §8, §15).
 *
 * The route is genuinely mixed (§24, classification B):
 *
 * - **public by design** — agency logos, workspace/user/team avatars, webchat
 *   widget avatars, knowledge covers, document-layout logos. These are rendered
 *   in `<img>` tags, some by unauthenticated surfaces (the webchat widget, PDF
 *   renderers, e-mail logos), and several are stored with
 *   `public, max-age=31536000, immutable`.
 * - **private** — Team Chat attachments, project/task attachments, inbox media.
 *   These are conversation content.
 *
 * So a blanket guard is not available: it would break legitimate public assets,
 * which §23 forbids. Instead the private prefixes are enumerated and only they
 * require a grant. The default for an unrecognized path is "public", matching
 * today's behaviour — the alternative would break unknown legacy consumers —
 * but every private prefix is closed, and a new private prefix only has to be
 * added to `PRIVATE_PREFIXES` to be protected.
 *
 * ## Why a signed grant rather than a bearer stream
 *
 * The AP3 pattern (opaque ref + authenticated stream) is the better model and is
 * what CCOM1 must use for client conversations. It cannot be retrofitted onto
 * Team Chat in this sprint without rewriting the web UI: attachments render in
 * bare `<img src>`, `<video src>` and `<a href>` tags against a different origin
 * than the frontend, so no `Authorization` header and no cookie can ride along.
 *
 * The grant keeps the tag-based delivery working while removing the property
 * that made the path a capability:
 *
 * - it is an HMAC over the exact storage path, so it cannot be moved to another
 *   path — a forged or traversed path fails the signature;
 * - it is bound to the viewer's user id, so a leaked URL does not become a
 *   shareable public link to someone else's attachment;
 * - it expires, so a URL pasted into a ticket stops working;
 * - it is minted only by an endpoint that has already authorized the viewer
 *   against the channel.
 *
 * Nothing persisted changes: `agency_chat_attachments.public_url` keeps the same
 * storage path, and the grant is appended at read time (§28).
 */

/** Path prefixes whose contents require a grant, matched after normalization. */
const PRIVATE_PATH_MATCHERS: {
  readonly kind: string;
  readonly test: (path: string) => boolean;
}[] = [
  {
    kind: 'team-chat',
    test: (path) =>
      /^tenants\/[^/]+\/workspaces\/[^/]+\/team-chat\//.test(path),
  },
  {
    kind: 'projects',
    test: (path) =>
      /^tenants\/[^/]+\/workspaces\/[^/]+\/(tasks|projects)\/[^/]+\/attachments\//.test(
        path,
      ),
  },
  {
    kind: 'inbox',
    test: (path) => /^tenants\/[^/]+\/workspaces\/[^/]+\/inbox\//.test(path),
  },
];

const DEFAULT_TTL_SECONDS = 15 * 60;

export type AssetGrant = {
  /** Query string to append to the asset URL, without a leading `?`. */
  query: string;
  expiresAt: Date;
};

@Injectable()
export class AssetAccessService {
  private readonly logger = new Logger(AssetAccessService.name);

  constructor(private readonly configService: ConfigService) {}

  /**
   * True when `path` holds private content and may only be served with a valid
   * grant. Unrecognized paths are public, as they were before CCOM0.5.
   */
  isPrivatePath(path: string): boolean {
    return this.classifyPrivatePath(path) !== null;
  }

  classifyPrivatePath(path: string): string | null {
    const normalized = this.normalizeForMatching(path);

    for (const matcher of PRIVATE_PATH_MATCHERS) {
      if (matcher.test(normalized)) {
        return matcher.kind;
      }
    }

    return null;
  }

  /**
   * Mints a grant for one storage path and one viewer.
   *
   * Callers MUST have authorized the viewer for that object first — this method
   * signs, it does not authorize.
   */
  issueGrant(path: string, userId: string, ttlSeconds?: number): AssetGrant {
    const expiresAtSeconds =
      Math.floor(Date.now() / 1000) + (ttlSeconds ?? DEFAULT_TTL_SECONDS);
    const signature = this.sign(
      this.normalizeForMatching(path),
      userId,
      expiresAtSeconds,
    );

    const query = new URLSearchParams({
      au: userId,
      ae: String(expiresAtSeconds),
      as: signature,
    }).toString();

    return {
      query,
      expiresAt: new Date(expiresAtSeconds * 1000),
    };
  }

  /** Appends a freshly minted grant to a stored `/api/assets/...` URL. */
  authorizeUrl(
    url: string | null | undefined,
    path: string | null | undefined,
    userId: string | null | undefined,
  ): string | null {
    if (!url) {
      return url ?? null;
    }

    if (!path || !userId || !this.isPrivatePath(path)) {
      return url;
    }

    const separator = url.includes('?') ? '&' : '?';
    return `${url}${separator}${this.issueGrant(path, userId).query}`;
  }

  /**
   * Verifies a grant presented on an asset request.
   *
   * Fails closed on every branch: no signing key, missing parameters, expiry,
   * or signature mismatch all deny.
   */
  verifyGrant(
    path: string,
    params: Record<string, unknown>,
  ): { ok: true; userId: string } | { ok: false; reason: string } {
    const userId = this.readParam(params, 'au');
    const expiresAtRaw = this.readParam(params, 'ae');
    const signature = this.readParam(params, 'as');

    if (!userId || !expiresAtRaw || !signature) {
      return { ok: false, reason: 'missing_grant' };
    }

    const expiresAtSeconds = Number(expiresAtRaw);

    if (!Number.isFinite(expiresAtSeconds)) {
      return { ok: false, reason: 'malformed_grant' };
    }

    if (expiresAtSeconds * 1000 <= Date.now()) {
      return { ok: false, reason: 'expired_grant' };
    }

    const expected = this.sign(
      this.normalizeForMatching(path),
      userId,
      expiresAtSeconds,
    );

    if (!this.safeEquals(expected, signature)) {
      return { ok: false, reason: 'invalid_signature' };
    }

    return { ok: true, userId };
  }

  /**
   * The grant is signed with a dedicated secret when configured, falling back to
   * the Agency access-token secret so no new mandatory env var is introduced on
   * a security fix. Without either, every private asset is denied rather than
   * served unsigned.
   */
  private resolveSigningKey(): string | null {
    const dedicated = this.configService.get<string>('ASSET_GRANT_SECRET');

    if (dedicated && dedicated.trim()) {
      return dedicated.trim();
    }

    const fallback = this.configService.get<string>('JWT_ACCESS_SECRET');

    if (fallback && fallback.trim()) {
      return fallback.trim();
    }

    this.logger.error(
      'No ASSET_GRANT_SECRET or JWT_ACCESS_SECRET configured: private assets are denied.',
    );
    return null;
  }

  private sign(
    normalizedPath: string,
    userId: string,
    expiresAtSeconds: number,
  ): string {
    const key = this.resolveSigningKey();

    if (!key) {
      // An unguessable value: with no key, nothing can ever verify.
      return '';
    }

    return createHmac('sha256', key)
      .update(`${normalizedPath}\n${userId}\n${expiresAtSeconds}`)
      .digest('base64url');
  }

  /**
   * The signed subject is the decoded path, so a request that re-encodes or
   * double-encodes the same object still verifies against the same signature,
   * and `..` cannot be smuggled past the matcher by encoding it.
   * `FilesService.normalizeAssetPath` independently rejects traversal before any
   * object is fetched.
   */
  private normalizeForMatching(path: string): string {
    let decoded = path.trim();

    for (let i = 0; i < 3; i += 1) {
      let next: string;
      try {
        next = decodeURIComponent(decoded);
      } catch {
        break;
      }
      if (next === decoded) break;
      decoded = next;
    }

    return decoded.replace(/\\/g, '/').replace(/^\/+/, '');
  }

  private readParam(
    params: Record<string, unknown>,
    key: string,
  ): string | null {
    const value = params[key];

    if (typeof value === 'string' && value.trim()) {
      return value.trim();
    }

    return null;
  }

  private safeEquals(expected: string, provided: string): boolean {
    if (!expected || !provided) {
      return false;
    }

    const expectedBuffer = Buffer.from(expected);
    const providedBuffer = Buffer.from(provided);

    if (expectedBuffer.length !== providedBuffer.length) {
      return false;
    }

    return timingSafeEqual(expectedBuffer, providedBuffer);
  }
}
