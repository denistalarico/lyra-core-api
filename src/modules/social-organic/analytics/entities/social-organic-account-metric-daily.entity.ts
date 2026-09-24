import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SocialOrganicMetricSource } from './social-organic-post-metric-daily.entity';

/**
 * Daily account metrics with deliberately explicit stock/flow semantics.
 *
 * `followersCount` is a STOCK: the end-of-day level. NEVER SUM it across days;
 * use the last observation for the requested period. `followersGained` and
 * `followersLost` are flows and may be summed. Reach is de-duplicated audience
 * and likewise must not be summed across days.
 *
 * All counters are `bigint` strings in TypeScript. Ratios are intentionally
 * absent and must be computed at read time from their underlying counters.
 */
@Entity('social_organic_account_metrics_daily')
@Index(
  'UQ_social_organic_account_metrics_daily_fact',
  ['assetId', 'metricDate', 'source'],
  { unique: true },
)
@Index('IDX_social_organic_account_metrics_daily_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'metricDate',
])
@Index(
  'IDX_social_organic_account_metrics_daily_partial',
  ['assetId', 'metricDate'],
  {
    where: '"is_partial"',
  },
)
@Check(
  'CK_social_organic_account_metrics_daily_non_negative',
  `"followers_count" >= 0
   AND "followers_gained" >= 0
   AND "followers_lost" >= 0
   AND "impressions" >= 0
   AND "reach" >= 0
   AND "profile_views" >= 0
   AND "total_interactions" >= 0
   AND "accounts_engaged" >= 0
   AND "likes" >= 0
   AND "comments" >= 0
   AND "shares" >= 0
   AND "saves" >= 0
   AND "replies" >= 0
   AND "views_total" >= 0
   AND "reach_total" >= 0`,
)
export class SocialOrganicAccountMetricDailyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise this is a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ type: 'varchar', length: 24, default: 'organic' })
  source!: SocialOrganicMetricSource;

  /** Calendar day in `assetTimezone`, not an instant. */
  @Column({ name: 'metric_date', type: 'date' })
  metricDate!: string;

  /** Required per row; a missing asset timezone must never become UTC. */
  @Column({ name: 'asset_timezone', type: 'varchar', length: 64 })
  assetTimezone!: string;

  /** STOCK at end of day. NEVER SUM across dates. */
  @Column({ name: 'followers_count', type: 'bigint', nullable: true })
  followersCount!: string | null;

  /** Daily flow; safe to sum across dates. */
  @Column({ name: 'followers_gained', type: 'bigint', nullable: true })
  followersGained!: string | null;

  /** Daily flow; safe to sum across dates. */
  @Column({ name: 'followers_lost', type: 'bigint', nullable: true })
  followersLost!: string | null;

  /**
   * Views of ORGANIC surfaces only — ads excluded.
   *
   * Read from the `media_product_type` breakdown with `AD` dropped
   * (`readNonAdMediaProducts`), which is what makes this the organic figure and
   * not the account's total. `viewsTotal` below is the total.
   */
  @Column({ type: 'bigint', nullable: true })
  impressions!: string | null;

  /** De-duplicated ORGANIC audience for this grain; never sum across days. */
  @Column({ type: 'bigint', nullable: true })
  reach!: string | null;

  /**
   * The account's TOTAL views and reach for the day, ads included.
   *
   * Meta's own `total_value.value`, taken before the breakdown is read. It is a
   * separate measurement rather than a sum of the slices: an account reached
   * both organically and by an ad is counted once here and once in each slice,
   * so `reachTotal` is normally *less* than `reach + paid reach` and that is not
   * an error. For the same reason the paid slice is never derived as
   * `total - organic`, which would state a number Meta did not.
   *
   * Null on a day whose payload predates these columns and carried no
   * `total_value.value` to backfill from — not zero, which would claim the
   * account was seen by nobody.
   */
  @Column({ name: 'views_total', type: 'bigint', nullable: true })
  viewsTotal!: string | null;

  /** Total de-duplicated audience, ads included. Never sum across days. */
  @Column({ name: 'reach_total', type: 'bigint', nullable: true })
  reachTotal!: string | null;

  @Column({ name: 'profile_views', type: 'bigint', nullable: true })
  profileViews!: string | null;

  /**
   * Account-level engagement, all daily flows.
   *
   * Requested in one call with `profile_views` and, before the columns existed,
   * kept only in `provider_metrics`. They are flows rather than `*_lifetime`
   * snapshots because Meta reports them per day for that day.
   *
   * `accountsEngaged` is the exception to read carefully: it counts *distinct
   * accounts within its own day*, so summing it over a period counts a person
   * once per day they engaged. Stored as the provider reports it; the read layer
   * is where that caveat is enforced.
   */
  @Column({ name: 'total_interactions', type: 'bigint', nullable: true })
  totalInteractions!: string | null;

  /** Distinct accounts for THIS DAY. Summing across days double counts people. */
  @Column({ name: 'accounts_engaged', type: 'bigint', nullable: true })
  accountsEngaged!: string | null;

  @Column({ type: 'bigint', nullable: true })
  likes!: string | null;

  @Column({ type: 'bigint', nullable: true })
  comments!: string | null;

  @Column({ type: 'bigint', nullable: true })
  shares!: string | null;

  @Column({ type: 'bigint', nullable: true })
  saves!: string | null;

  @Column({ type: 'bigint', nullable: true })
  replies!: string | null;

  /** True for same-day or provider-incomplete facts. */
  @Column({ name: 'is_partial', type: 'boolean', default: false })
  isPartial!: boolean;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;

  /** Pruning a run log must not delete the facts it produced. */
  @Column({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId!: string | null;

  /** Provider-native metric names that have no normalized column. */
  @Column({
    name: 'provider_metrics',
    type: 'jsonb',
    default: () => "'{}'::jsonb",
  })
  providerMetrics!: Record<string, unknown>;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
