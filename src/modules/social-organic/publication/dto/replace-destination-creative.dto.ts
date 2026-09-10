import {
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Matches,
  MaxLength,
  Min,
} from 'class-validator';

const CANONICAL_KEY = /^[a-z0-9][a-z0-9_-]*$/;

/**
 * Chooses the creative for one editorial destination (Planner E5).
 *
 * Scope is absent by design: `tenantId`, `workspaceId` and `agencyClientId`
 * come from the request context and are never accepted from a body. The
 * destination id travels in the route, so this payload names only the two
 * things the caller is actually choosing plus their provenance.
 *
 * `organicAssetId` is required rather than derived from the destination's
 * `channel`. A channel is editorial intent ("instagram"); capability lives on
 * a concrete connected account, and a workspace may have several for the same
 * channel. Deriving it would mean guessing which account a creative was
 * validated for — the same reasoning that already made `assetId` explicit on
 * `CreateSocialPublicationDto`.
 */
export class ReplaceDestinationCreativeDto {
  @IsUUID()
  mediaAssetId!: string;

  @IsUUID()
  organicAssetId!: string;

  /**
   * Open vocabulary constrained to a canonical key shape. Only `primary` is
   * accepted by the service in this campaign — carousel roles are reserved by
   * the schema, not yet by the contract.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(CANONICAL_KEY)
  role?: string;

  @IsOptional()
  @IsInt()
  @Min(0)
  sortOrder?: number;

  /**
   * Where the file came from: `manual`, `creative_studio`, `pletor` or a
   * source that does not exist yet. Validated for shape only, never against a
   * closed list, so a new producer never needs a migration or a DTO change.
   */
  @IsOptional()
  @IsString()
  @MaxLength(40)
  @Matches(CANONICAL_KEY)
  source?: string;
}
