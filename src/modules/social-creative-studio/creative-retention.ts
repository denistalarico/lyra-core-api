import { temporaryMediaAssetSource } from '../../common/media-assets';

/**
 * CS3.1 — retention vocabulary of the Creative Studio.
 *
 * Every class is DERIVED from facts the platform already stores; there is no
 * retention column to drift from them:
 *
 *   temporary_generation  media whose `source` is
 *                         `CREATIVE_GENERATION_MEDIA_SOURCE`: an AI output no
 *                         one chose. Never referenced by a version (promotion
 *                         copies the bytes), so cleanup can delete it without
 *                         touching history.
 *   creative_version      media referenced by a `social_creative_asset_versions`
 *                         row (original or thumbnail): the real workflow.
 *   final                 a version whose Approvals state is `approved` (and,
 *                         later, one bound to a publication). Approvals owns
 *                         that state; the Studio only reads it.
 *
 * Durations and quotas are commercial policy and deliberately absent: a
 * future cleanup computes eligibility at sweep time (`created_at` + the
 * policy then in force), so a policy change applies without rewriting rows.
 * Expiring a binary never deletes metadata, thumbnails or approval history.
 */
export const CREATIVE_RETENTION_CLASSES = [
  'temporary_generation',
  'creative_version',
  'final',
] as const;
export type CreativeRetentionClass =
  (typeof CREATIVE_RETENTION_CLASSES)[number];

export const CREATIVE_GENERATION_MEDIA_SOURCE = temporaryMediaAssetSource(
  'creative_generation',
);
