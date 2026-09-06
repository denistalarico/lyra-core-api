import { IsISO8601, IsOptional, IsUUID } from 'class-validator';

/**
 * Schedules a publication for a Planner destination.
 *
 * `assetId` is explicit rather than derived from the destination's `channel`:
 * a channel (e.g. "instagram") is editorial intent, not a concrete connected
 * account, and a workspace may have more than one connected asset for the
 * same channel.
 */
export class CreateSocialPublicationDto {
  @IsUUID()
  contentItemId!: string;

  @IsUUID()
  destinationId!: string;

  @IsUUID()
  assetId!: string;

  /**
   * Lyra's authoritative desired publish time (ADR-015 — no provider-side
   * schedule). Omit to publish as soon as the scheduler next runs.
   */
  @IsOptional()
  @IsISO8601()
  scheduledAt?: string;
}
