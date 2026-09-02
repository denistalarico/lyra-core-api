// src/modules/brand-kit/dto/brand-kit.view.ts
//
// Allowlisted projections (S1.4.9 §28). Built by explicit field, never by
// spreading an entity: a spread would ship `storage_path` — the private
// bucket key — to the browser the first time someone adds a column.

import type {
  BrandKitAssetEntity,
  BrandKitEntity,
  BrandKitPaletteEntry,
  BrandKitTypographyEntry,
} from '../entities';

export type BrandKitAssetResponse = {
  id: string;
  kind: string;
  variant: string | null;
  theme: string | null;
  originalFilename: string;
  mimeType: string;
  sizeBytes: number;
  width: number | null;
  height: number | null;
  createdAt: string;
  /**
   * The authenticated endpoint that streams the bytes. A path, not a URL and
   * not a signed URL: the frontend fetches it with the session's own headers
   * (S1.4.10 will turn the response into a Blob + object URL). Nothing here
   * is a capability that works on its own.
   */
  contentPath: string;
};

export type BrandKitResponse = {
  /**
   * `null` while the scope has no Brand Kit row yet — GET never creates one
   * (§14). The palette/typography/guidelines below are then the empty
   * defaults, so the client renders an empty editor rather than a 404.
   */
  id: string | null;
  scope: { agencyClientId: string | null };
  palette: BrandKitPaletteEntry[];
  typography: BrandKitTypographyEntry[];
  guidelines: string | null;
  assets: BrandKitAssetResponse[];
  updatedAt: string | null;
};

export function buildBrandKitAssetContentPath(assetId: string): string {
  return `/brand-kit/assets/${assetId}/content`;
}

export function mapBrandKitAssetResponse(
  asset: BrandKitAssetEntity,
): BrandKitAssetResponse {
  return {
    id: asset.id,
    kind: asset.kind,
    variant: asset.variant,
    theme: asset.theme,
    originalFilename: asset.originalFilename,
    mimeType: asset.mimeType,
    // bigint arrives as a string from the driver; the client wants a number.
    sizeBytes: Number(asset.byteSize),
    width: asset.width,
    height: asset.height,
    createdAt: asset.createdAt.toISOString(),
    contentPath: buildBrandKitAssetContentPath(asset.id),
  };
}

export function mapBrandKitResponse(
  kit: BrandKitEntity | null,
  assets: BrandKitAssetEntity[],
  agencyClientId: string | null,
): BrandKitResponse {
  return {
    id: kit?.id ?? null,
    scope: { agencyClientId },
    palette: kit?.palette ?? [],
    typography: kit?.typography ?? [],
    guidelines: kit?.guidelines ?? null,
    assets: assets.map(mapBrandKitAssetResponse),
    updatedAt: kit?.updatedAt?.toISOString() ?? null,
  };
}
