import { IsIn, IsOptional } from 'class-validator';

/**
 * The non-file part of an upload.
 *
 * Scope is deliberately absent: `tenantId`, `workspaceId` and `agencyClientId`
 * come from the request context. A client id accepted here would let a caller
 * write media into another client's scope, which is the failure this
 * repository's scope rule exists to prevent.
 *
 * `source` is a closed set even though the entity's column is an open
 * vocabulary. The column stays open so adding a provenance never needs a
 * migration; the DTO stays closed so an arbitrary caller-supplied string never
 * reaches storage and later gets rendered or grouped by as if the platform had
 * written it.
 */
export const MEDIA_ASSET_SOURCES = [
  'planner_upload',
  'creative_studio',
  'brand_kit',
] as const;

export class UploadMediaAssetDto {
  @IsOptional()
  @IsIn(MEDIA_ASSET_SOURCES)
  source?: (typeof MEDIA_ASSET_SOURCES)[number];
}
