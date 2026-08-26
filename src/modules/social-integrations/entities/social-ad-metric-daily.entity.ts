import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import type { SocialAdEntityLevel } from './social-ad-entity.entity';

/**
 * Which kind of delivery produced the fact.
 *
 * Only `paid` exists today and S2 is Meta Ads only, but the dimension is in
 * the schema — and in the unique key — from the start. Organic and earned
 * numbers for the same object on the same day are different facts, not a
 * correction of the paid one, and a unique key without this column would make
 * the first organic ingest overwrite the ad spend it sits next to.
 *
 * Widening this union is a type change, not a migration: the column has no
 * check constraint precisely so that adding a source does not require a schema
 * change in a table that will be large.
 */
export type SocialAdMetricSource = 'paid';

/**
 * The attribution configuration a fact was measured under.
 *
 * `account_default` is the canonical value for rows collected with
 * `use_account_attribution_setting=true`, which is what the read-only pipeline
 * asks Meta for. It is a *name for the account's setting*, not a copy of it:
 * the account owner can change the window, and when they do, Meta's own
 * numbers change under the same name.
 *
 * Storing it — rather than leaving it NULL — is what makes a future 7-day or
 * 1-day-click pull land as an additional fact instead of silently overwriting
 * the one already reported to a client.
 */
export type SocialAdAttributionSetting = 'account_default';

/**
 * Daily facts, one row per object per day per source per attribution setting.
 *
 * The grain is the contract. Everything above it (weekly, per campaign, per
 * client) is an aggregation at read time; nothing below it is stored, because
 * hourly data multiplies the row count by 24 for a question nobody has asked.
 *
 * No ratio columns. CTR, CPC, CPM, CPL, CPA, ROAS and frequency are all
 * quotients of columns that are already here, and a stored quotient is a lie
 * the moment anyone sums two rows: averaging CTRs across days weights a
 * thousand-impression day the same as a million-impression one. They are
 * derived on read, from summed numerators and denominators.
 */
@Entity('social_ad_metrics_daily')
/**
 * The idempotency of the whole ingest.
 *
 * This is the conflict target of the future `INSERT … ON CONFLICT DO UPDATE`,
 * which means it decides what "the same fact" means. Meta restates recent days
 * for up to 28 days, so re-reading a window must update in place; two rows for
 * the same day would double the spend on every report that sums them.
 *
 * `source` and `attribution_setting` are part of the key on purpose — see the
 * types above. Removing either would turn "another way of measuring" into
 * "overwrite what we already told the client".
 */
@Index(
  'UQ_social_ad_metrics_daily_fact',
  [
    'tenantId',
    'workspaceId',
    'connectionId',
    'source',
    'entityLevel',
    'entityExternalId',
    'metricDate',
    'attributionSetting',
  ],
  { unique: true },
)
// The shape of every dashboard read: one client, one level, a date range.
@Index('IDX_social_ad_metrics_daily_read', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'entityLevel',
  'metricDate',
])
@Index('IDX_social_ad_metrics_daily_campaign', [
  'connectionId',
  'campaignExternalId',
  'metricDate',
])
// Partial in both senses: it indexes only the rows still waiting to be
// restated, so "what must be re-read?" stays a small scan no matter how large
// the settled history gets.
@Index('IDX_social_ad_metrics_daily_partial', ['connectionId', 'metricDate'], {
  where: '"is_partial"',
})
@Check(
  'CK_social_ad_metrics_daily_level',
  `"entity_level" IN ('account', 'campaign', 'adset', 'ad')`,
)
/**
 * Negative spend or a negative impression count is not a number Meta can
 * legitimately return; it is a parsing bug (a currency string read as a
 * signed integer, a subtraction against a missing baseline). Catching it at
 * write time keeps it out of a client-facing total.
 *
 * Deliberately absent: any bound on `metric_date` against `CURRENT_DATE`.
 * The date belongs to the *ad account's* timezone and `CURRENT_DATE` belongs
 * to the database server's, so an account east of the server has legitimate
 * facts that look like tomorrow for part of every day — and Postgres rejects
 * the non-immutable expression in a CHECK anyway. Sanity bounds on the date
 * belong to the ingest, which knows the account timezone.
 */
@Check(
  'CK_social_ad_metrics_daily_non_negative',
  `"spend" >= 0
   AND "impressions" >= 0
   AND "clicks" >= 0
   AND "link_clicks" >= 0
   AND "leads" >= 0
   AND "conversions" >= 0
   AND "conversion_value" >= 0
   AND "video_views" >= 0
   AND ("reach" IS NULL OR "reach" >= 0)`,
)
export class SocialAdMetricDailyEntity {
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

  @Column({ type: 'varchar', length: 24, default: 'paid' })
  source!: SocialAdMetricSource;

  @Column({ name: 'entity_level', type: 'varchar', length: 20 })
  entityLevel!: SocialAdEntityLevel;

  /**
   * Not a foreign key to `social_ad_entities`. Insights and the hierarchy are
   * separate reads that can disagree for minutes at a time, and a fact that
   * cannot be written because its ad set has not been mirrored yet is a fact
   * that gets dropped. The join happens at read time, tolerantly.
   */
  @Column({ name: 'entity_external_id', type: 'varchar', length: 180 })
  entityExternalId!: string;

  @Column({
    name: 'campaign_external_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  campaignExternalId!: string | null;

  /**
   * `date`, not `timestamptz`: this is a calendar day in the ad account's
   * timezone, and giving it an instant would invite a second, wrong
   * conversion on every read.
   */
  @Column({ name: 'metric_date', type: 'date' })
  metricDate!: string;

  /**
   * The timezone that defined the day boundary, required rather than assumed.
   * Reading a `America/Sao_Paulo` day as UTC moves an evening's spend to the
   * next day, which is precisely the failure the credential resolver already
   * refuses to allow by never defaulting a missing timezone to UTC.
   */
  @Column({ name: 'account_timezone', type: 'varchar', length: 64 })
  accountTimezone!: string;

  /**
   * Nullable because the `source` dimension outlives paid delivery: an organic
   * row has reach and no money, and inventing a currency for it would be
   * worse than admitting there is none.
   */
  @Column({ type: 'varchar', length: 8, nullable: true })
  currency!: string | null;

  @Column({
    name: 'attribution_setting',
    type: 'varchar',
    length: 60,
    default: 'account_default',
  })
  attributionSetting!: SocialAdAttributionSetting;

  /**
   * `numeric`, never a float. Money summed over a quarter in binary floating
   * point drifts, and this column is what a client is invoiced against.
   * Six decimals of headroom: Meta reports two, but per-unit costs derived
   * upstream can carry more.
   */
  @Column({ type: 'numeric', precision: 18, scale: 6, default: 0 })
  spend!: string;

  @Column({ type: 'bigint', default: 0 })
  impressions!: string;

  /**
   * Nullable and non-additive: reach is de-duplicated people, so summing two
   * days double-counts anyone present on both. No aggregation logic is
   * implemented here — the column stores what the provider said for the grain
   * it was asked about, and any roll-up has to re-query, not add.
   */
  @Column({ type: 'bigint', nullable: true })
  reach!: string | null;

  @Column({ type: 'bigint', default: 0 })
  clicks!: string;

  /** Clicks that actually left for the destination, which is the honest one. */
  @Column({ name: 'link_clicks', type: 'bigint', default: 0 })
  linkClicks!: string;

  @Column({ type: 'bigint', default: 0 })
  leads!: string;

  /**
   * `numeric` rather than an integer count: Meta's action values are fractional
   * under attribution splitting — one conversion credited across two ads is
   * two halves.
   */
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

  @Column({ name: 'video_views', type: 'bigint', default: 0 })
  videoViews!: string;

  /**
   * The full action breakdown as reported, keyed by action type. The promoted
   * columns above are the handful the product asks about by name; this keeps
   * the rest addressable without a migration per objective.
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  actions!: Record<string, unknown>;

  /**
   * The day was still open, or Meta was still restating it, when this row was
   * written. It is the flag that lets a report say "today, so far" instead of
   * quietly showing a partial number as final.
   */
  @Column({ name: 'is_partial', type: 'boolean', default: false })
  isPartial!: boolean;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;

  /**
   * The run that wrote the row. `ON DELETE SET NULL`, not cascade: pruning old
   * run logs must never delete the facts they produced.
   */
  @Column({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId!: string | null;

  /** Provider payload for debugging. Unwritten and unretained in this slice. */
  @Column({ type: 'jsonb', nullable: true })
  raw!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
