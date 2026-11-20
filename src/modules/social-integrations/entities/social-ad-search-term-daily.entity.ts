import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';

/**
 * GA-DET (D-G4): what people searched, per campaign and day.
 *
 * - `search_term`: Search campaigns, `search_term_view`.
 * - `keyword`: Search campaigns, `keyword_view` (the advertiser's keyword).
 * - `pmax_category`: Performance Max, `campaign_search_term_insight`
 *   (`category_label`; Google groups PMax searches into categories).
 */
export type SocialAdSearchTermKind =
  | 'search_term'
  | 'keyword'
  | 'pmax_category';

/**
 * One term of one campaign on one day.
 *
 * The text is up to 512 characters, so the identity uses its sha256
 * (`term_hash`) instead of the text: a long varchar in a unique key is a wide
 * index for nothing. `spend` is NULL where Google reports no cost for the
 * resource (PMax categories): NULL is "not reported", never zero.
 */
@Entity('social_ad_search_terms_daily')
@Index(
  'UQ_social_ad_search_terms_daily_fact',
  [
    'tenantId',
    'workspaceId',
    'connectionId',
    'campaignExternalId',
    'metricDate',
    'termKind',
    'termHash',
  ],
  { unique: true },
)
@Index('IDX_social_ad_search_terms_daily_read', [
  'tenantId',
  'workspaceId',
  'connectionId',
  'campaignExternalId',
  'termKind',
  'metricDate',
])
@Check(
  'CK_social_ad_search_terms_daily_kind',
  `"term_kind" IN ('search_term', 'keyword', 'pmax_category')`,
)
@Check(
  'CK_social_ad_search_terms_daily_non_negative',
  `"impressions" >= 0 AND "clicks" >= 0
   AND ("spend" IS NULL OR "spend" >= 0)
   AND "conversions" >= 0 AND "conversion_value" >= 0`,
)
export class SocialAdSearchTermDailyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ name: 'campaign_external_id', type: 'varchar', length: 180 })
  campaignExternalId!: string;

  /** A calendar day in the ad account's timezone. Never converted. */
  @Column({ name: 'metric_date', type: 'date' })
  metricDate!: string;

  @Column({ name: 'account_timezone', type: 'varchar', length: 64 })
  accountTimezone!: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency!: string | null;

  @Column({ name: 'term_kind', type: 'varchar', length: 20 })
  termKind!: SocialAdSearchTermKind;

  @Column({ name: 'term_text', type: 'varchar', length: 512 })
  termText!: string;

  /** sha256 hex of `term_text`: the identity, not a secret. */
  @Column({ name: 'term_hash', type: 'char', length: 64 })
  termHash!: string;

  @Column({ type: 'bigint', default: 0 })
  impressions!: string;

  @Column({ type: 'bigint', default: 0 })
  clicks!: string;

  @Column({ type: 'numeric', precision: 18, scale: 6, nullable: true })
  spend!: string | null;

  @Column({ type: 'numeric', precision: 18, scale: 6, default: 0 })
  conversions!: string;

  @Column({
    name: 'conversion_value',
    type: 'numeric',
    precision: 18,
    scale: 6,
    default: 0,
  })
  conversionValue!: string;

  /** The day was still open when this row was collected. */
  @Column({ name: 'is_partial', type: 'boolean', default: false })
  isPartial!: boolean;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
