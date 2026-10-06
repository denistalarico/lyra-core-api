// src/common/media-assets/media-asset-retention.ts
//
// Durable vs temporary media at the shared boundary (Creative Studio CS3.1).
//
// Until CS3 every `MediaAsset` meant the same thing: a reusable private object
// that any Social surface may list, bind or publish. AI generation adds
// binaries that are only CANDIDATES — outputs nobody has chosen yet, which a
// future lifecycle cleanup is allowed to delete.
//
// Storing them outside this boundary would mean a second storage path with its
// own keys and its own bucket knowledge. Storing them here WITHOUT a marker
// would put an unchosen output in the Planner's media picker and let it be
// scheduled for publication — after which cleanup would delete a binary a
// publication depends on. Hence the marker, and the rule that every shared
// read path excludes it.
//
// WHY A `source` PREFIX AND NOT A COLUMN
// --------------------------------------
// `source` is already the immutable provenance label and an open vocabulary
// ("adding a source never requires a migration"). A temporary row never turns
// durable: promotion COPIES the bytes into a new durable asset through the
// normal upload path, so the temporary row keeps its class until it is
// removed. A marker that never changes on a row fits provenance; it does not
// need a mutable lifecycle column, and it needs no migration.
//
// The prefix cannot arrive from HTTP: `UploadMediaAssetDto.source` is a closed
// set that contains no temporary value.

import { Like, Not, type FindOperator } from 'typeorm';

export const TEMPORARY_MEDIA_ASSET_SOURCE_PREFIX = 'temporary:';

/** Builds the `source` of a temporary asset from its provenance (`creative_generation`, …). */
export function temporaryMediaAssetSource(provenance: string): string {
  if (!/^[a-z][a-z0-9_]*$/.test(provenance)) {
    throw new Error(`Invalid temporary media provenance: ${provenance}`);
  }
  return `${TEMPORARY_MEDIA_ASSET_SOURCE_PREFIX}${provenance}`;
}

export function isTemporaryMediaAssetSource(source: string): boolean {
  return source.startsWith(TEMPORARY_MEDIA_ASSET_SOURCE_PREFIX);
}

/**
 * `where.source` for every shared read path: list, generic content, the
 * publication resolver and creative binding. A temporary asset resolves the
 * same as one that does not exist.
 */
export function durableMediaAssetSource(): FindOperator<string> {
  return Not(Like(`${TEMPORARY_MEDIA_ASSET_SOURCE_PREFIX}%`));
}
