import { IsString, IsUUID, Matches } from 'class-validator';

/**
 * The query of the A4 consolidated paid+organic overview read.
 *
 * Two identifiers rather than one: paid and organic have no shared identity
 * — a `SocialAdAccountConnectionEntity` and a `SocialOrganicAssetEntity` are
 * different rows in different tables, connected only by the human choosing
 * both. No tenant/workspace/client field, matching every other analytics
 * query DTO in this codebase: scope comes from the authenticated context.
 */
export class ConsolidatedOverviewQueryDto {
  @IsUUID()
  paidConnectionId!: string;

  @IsUUID()
  organicAssetId!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'since must be a date as YYYY-MM-DD.',
  })
  since!: string;

  @IsString()
  @Matches(/^\d{4}-\d{2}-\d{2}$/, {
    message: 'until must be a date as YYYY-MM-DD.',
  })
  until!: string;
}
