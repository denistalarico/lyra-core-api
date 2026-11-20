import { IsIn, IsOptional, IsString, IsUUID, Matches } from 'class-validator';

/** GA-DET: which term list the "Detalhamento" panel shows (D-G4). */
export const GOOGLE_CAMPAIGN_TERM_KINDS = [
  'search_term',
  'keyword',
  'pmax_category',
] as const;

export class GoogleCampaignDetailsQueryDto {
  @IsUUID()
  connectionId!: string;

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

  /** Default: `pmax_category` for PMax, `search_term` otherwise. */
  @IsOptional()
  @IsIn(GOOGLE_CAMPAIGN_TERM_KINDS)
  termKind?: (typeof GOOGLE_CAMPAIGN_TERM_KINDS)[number];
}
