import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsISO8601,
  IsOptional,
  IsUUID,
} from 'class-validator';

/**
 * Schedules a publication for a Planner destination.
 *
 * `assetId` is explicit rather than derived from the destination's `channel`:
 * a channel (e.g. "instagram") is editorial intent, not a concrete connected
 * account, and a workspace may have more than one connected asset for the
 * same channel.
 *
 * `mediaAssetId` is a different identity than `assetId`: it points at the
 * private-bucket media (M3.1A `MediaAsset`) to publish, not at the
 * destination account. It is resolved server-side against the caller's
 * scope — the request never carries storage details (path, bucket, mime
 * type) directly.
 */
export class CreateSocialPublicationDto {
  @IsUUID()
  contentItemId!: string;

  @IsUUID()
  destinationId!: string;

  @IsUUID()
  assetId!: string;

  @IsOptional()
  @IsUUID()
  mediaAssetId?: string | null;

  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(10)
  @IsUUID('4', { each: true })
  mediaAssetIds?: string[];

  /**
   * Lyra's authoritative desired publish time (ADR-015 — no provider-side
   * schedule). Omit to publish as soon as the scheduler next runs.
   */
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}
