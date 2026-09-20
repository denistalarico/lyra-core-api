import { IsIn, IsUUID } from 'class-validator';
import type { SocialOrganicAudienceKind } from '../entities/social-organic-audience-daily.entity';

/**
 * The dimensions a caller may ask for.
 *
 * A closed list, validated here and then used to index closed lookups in the
 * read service and the label module — nothing the caller sends reaches SQL as
 * text. The `satisfies` makes a value added to one union but not the other a
 * compile error rather than a request that validates and matches no rows.
 */
const AUDIENCE_KINDS = [
  'age_gender',
  'gender',
  'age',
  'city',
  'country',
] as const satisfies readonly SocialOrganicAudienceKind[];

/**
 * The query of an audience read.
 *
 * Two fields, and the absence of a third is the design. There is no `since` or
 * `until`: follower demographics are a lifetime stock, and the read returns the
 * newest snapshot. A period parameter would imply an aggregate this data cannot
 * support — summing it counts the same followers once per day in the window.
 *
 * No tenant, workspace or client field either: the scope comes from the
 * authenticated context, and the global `ValidationPipe` runs with
 * `forbidNonWhitelisted`, so a query naming one is rejected outright.
 */
export class AnalyticsAudienceQueryDto {
  @IsUUID()
  assetId!: string;

  @IsIn(AUDIENCE_KINDS)
  kind!: SocialOrganicAudienceKind;
}
