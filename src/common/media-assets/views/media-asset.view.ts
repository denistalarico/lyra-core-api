// src/common/media-assets/views/media-asset.view.ts
//
// The authorized projection of a `MediaAsset` (Social Planner E3).
//
// The entity's own docblock is explicit: `storagePath` is an object key and a
// caller that exposes media must produce an authorized view or a short-lived
// capability instead of returning the row. This is that view. Three classes of
// field never cross it:
//
//   - `storagePath`, because it is the bucket location. Nothing downstream
//     needs it, and a UI that receives it invites someone to build a URL from
//     it (T23).
//   - `tenantId` / `workspaceId` / `agencyClientId`, because scope ids are how
//     this platform's cross-context leaks have historically started. The
//     caller already knows its own scope; echoing it back only confirms
//     internal identifiers.
//   - `metadata`, because it is an open jsonb bag. Even though the entity
//     forbids secrets there, "sanitized by convention" is not a boundary; the
//     view exposes named fields only.

import type { MediaAssetEntity } from '../media-asset.entity';

export type MediaAssetView = {
  id: string;
  mimeType: string;
  /** bigint as string, exactly as persisted — a byte count must stay exact. */
  byteSize: string;
  originalFilename: string | null;
  width: number | null;
  height: number | null;
  durationMs: string | null;
  codec: string | null;
  source: string;
  createdAt: string;
  /**
   * Videos: a small still captured by the browser at upload, so previews never
   * download the video itself. Read from `metadata` by name, never the bag.
   */
  posterMediaAssetId: string | null;
};

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function mediaAssetPosterId(asset: MediaAssetEntity): string | null {
  const value = asset.metadata?.posterMediaAssetId;
  return typeof value === 'string' && UUID.test(value) ? value : null;
}

export function toMediaAssetView(asset: MediaAssetEntity): MediaAssetView {
  return {
    posterMediaAssetId: mediaAssetPosterId(asset),
    id: asset.id,
    mimeType: asset.mimeType,
    byteSize: asset.byteSize,
    originalFilename: asset.originalFilename,
    width: asset.width,
    height: asset.height,
    durationMs: asset.durationMs,
    codec: asset.codec,
    source: asset.source,
    createdAt: asset.createdAt.toISOString(),
  };
}
