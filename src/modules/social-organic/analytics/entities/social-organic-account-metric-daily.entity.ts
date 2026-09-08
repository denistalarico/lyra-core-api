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
   AND "profile_views" >= 0`,
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

  @Column({ type: 'bigint', nullable: true })
  impressions!: string | null;

  /** De-duplicated audience for this grain; never sum across days. */
  @Column({ type: 'bigint', nullable: true })
  reach!: string | null;

  @Column({ name: 'profile_views', type: 'bigint', nullable: true })
  profileViews!: string | null;

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
