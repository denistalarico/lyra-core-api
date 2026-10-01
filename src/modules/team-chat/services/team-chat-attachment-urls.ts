/**
 * Re-signs Team Chat attachment URLs at read time (CCOM0.5 §25–§28).
 *
 * Attachment URLs live in two places: the `agency_chat_attachments.public_url`
 * column, and — because the composer writes them there — inside
 * `agency_chat_messages.metadata.attachments[].url`. Both hold the plain
 * `/api/assets/{storagePath}` form.
 *
 * A grant expires, so it cannot be persisted. Instead every response that
 * carries an attachment URL has a fresh, viewer-bound grant appended as it is
 * read. Consequences, both intended:
 *
 * - **existing links keep working** (§28). Nothing stored is rewritten and no
 *   migration is needed; the same row serves a new grant on each read.
 * - **a copied URL stops working** once the grant expires, which is the point:
 *   the storage path is no longer the capability (§27).
 */

import type { AssetAccessService } from '../../../common/files/asset-access.service';

const ASSET_URL_PREFIX = '/api/assets/';

/**
 * Recovers the storage path from a stored `/api/assets/...` URL so the grant is
 * signed over the object, not over whatever the URL happens to look like. Any
 * pre-existing grant parameters are stripped first so re-reads do not stack.
 */
function extractStoragePath(url: string): string | null {
  const withoutQuery = url.split('?')[0];
  const index = withoutQuery.indexOf(ASSET_URL_PREFIX);

  if (index === -1) {
    return null;
  }

  const path = withoutQuery.slice(index + ASSET_URL_PREFIX.length);

  return path || null;
}

/** Appends a fresh grant to one URL, or returns it untouched if not private. */
export function authorizeAttachmentUrl(
  assetAccess: AssetAccessService,
  url: string | null | undefined,
  viewerUserId: string | null | undefined,
): string | null {
  if (!url || !viewerUserId) {
    return url ?? null;
  }

  const path = extractStoragePath(url);

  if (!path || !assetAccess.isPrivatePath(path)) {
    return url;
  }

  const base = url.split('?')[0];

  return `${base}?${assetAccess.issueGrant(path, viewerUserId).query}`;
}

/**
 * Rewrites `metadata.attachments[].url` in place on a copy of the metadata.
 *
 * Only the `url` field of entries in the `attachments` array is touched; the rest
 * of `metadata` (cards, reactions, mentions, reply refs) is passed through
 * untouched so no other contract shifts.
 */
export function authorizeMessageMetadata(
  assetAccess: AssetAccessService,
  metadata: Record<string, unknown> | null,
  viewerUserId: string | null | undefined,
): Record<string, unknown> | null {
  if (!metadata || !viewerUserId) {
    return metadata;
  }

  // `Array.isArray` on an `unknown` narrows to `any[]`, so the element type is
  // restated as `unknown` to keep the map body type-safe.
  const attachments: unknown[] = Array.isArray(metadata.attachments)
    ? (metadata.attachments as unknown[])
    : [];

  if (attachments.length === 0) {
    return metadata;
  }

  let changed = false;

  const rewritten = attachments.map((entry): unknown => {
    if (!entry || typeof entry !== 'object') {
      return entry;
    }

    const candidate = entry as Record<string, unknown>;

    if (typeof candidate.url !== 'string') {
      return entry;
    }

    const authorized = authorizeAttachmentUrl(
      assetAccess,
      candidate.url,
      viewerUserId,
    );

    if (authorized === candidate.url) {
      return entry;
    }

    changed = true;
    return { ...candidate, url: authorized };
  });

  if (!changed) {
    return metadata;
  }

  return { ...metadata, attachments: rewritten };
}
