// src/common/media-assets/media-asset-metadata.port.ts
//
// The dependency inversion that lets a shared boundary read media metadata
// without importing a product module (Social Planner E3).
//
// `MediaMetadataService` (M2) lives in `modules/social-organic/media/`. This
// boundary — `common/media-assets` — is imported BY that module, so importing
// it back would create a cycle and, worse, would make the shared Files/Assets
// boundary depend on a Social product module for every future consumer
// (Creative Studio, Brand Kit, LeadFlow). The port below is what the upload
// service depends on; `SocialOrganicModule` binds the concrete M2 service to
// it, so the arrow keeps pointing from the product module into the shared one.

/**
 * The subset of extracted metadata a `MediaAsset` row persists.
 *
 * Deliberately narrower than M2's `ExtractedMediaMetadata`: this boundary
 * stores intrinsic properties, not the derived `aspectRatio`/`kind` fields
 * that capability validation recomputes from them at schedule time.
 */
export type MediaAssetIntrinsicMetadata = {
  readonly width: number;
  readonly height: number;
  readonly durationSeconds: number | null;
  readonly codec: string;
};

export interface MediaAssetMetadataReader {
  extract(input: {
    readonly body: Buffer;
    readonly mimeType: string;
  }): Promise<MediaAssetIntrinsicMetadata>;
}

/** DI token for the reader above. Bound in `SocialOrganicModule`. */
export const MEDIA_ASSET_METADATA_READER = Symbol(
  'MEDIA_ASSET_METADATA_READER',
);
