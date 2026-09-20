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
 * The Meta breakdown dimensions this pipeline ingests.
 *
 * Three, and each is a separate provider request: the Marketing API refuses to
 * combine `age,gender` with `device_platform` or `publisher_platform` in one
 * call, so there is no version of this that costs fewer requests. The union is
 * mirrored by a CHECK constraint, unlike `source` on the facts table — that one
 * is open because widening it is a type change, while a new breakdown dimension
 * always arrives with a reader that has to know how to label its keys, so the
 * constraint is a useful place for the mistake to surface.
 *
 * Deliberately absent: `country`, `region`, `hourly_stats_*`, `placement`.
 * Nothing in the dashboard asks for them, and every extra dimension is another
 * full copy of the window's rows against a CPU-metered quota.
 */
export type SocialAdBreakdownKind =
  | 'age_gender'
  | 'device_platform'
  | 'publisher_platform';

/**
 * Paid delivery for one object on one day, split by one breakdown dimension.
 *
 * ## Why this is not a column on `social_ad_metrics_daily`
 *
 * A breakdown row is a *partition* of a fact that table already holds, not a
 * new fact. One account-day with eight age/gender buckets is eight rows here and
 * one row there, and both are true. Putting them in one table would mean either
 * a nullable `breakdown_key` on every unsplit row — where any query that forgot
 * to filter it would sum the total and its own partition, reporting double — or
 * a sentinel value pretending the unsplit row is a bucket. The separate table
 * makes the mistake impossible to write by accident: there is no way to query
 * this table and get an account total back.
 *
 * ## What is not stored here, and why
 *
 * No `leads`, `conversions`, `conversion_value` or `video_views` columns. On the
 * facts table those are promoted from `actions` by a versioned mapping, and a
 * second promotion site is a second definition of what a lead is — the exact
 * drift `mappingVersion` exists to prevent. `actions` is stored whole and the
 * read derives from it, so a mapping revision reaches breakdown rows and unsplit
 * rows at the same moment.
 *
 * No `campaign_external_id`. The parent index it supports on the facts table
 * answers "this campaign's ad sets", and nothing asks that of a breakdown: a
 * dashboard splits an account, occasionally a campaign, never a hierarchy walk.
 */
@Entity('social_ad_breakdown_daily')
/**
 * The identity of a breakdown fact, and the ON CONFLICT target of the ingest.
 *
 * `breakdown_kind` is in the key alongside `breakdown_key` because Meta's
 * dimension vocabularies overlap — `mobile_app` is a device platform, and a
 * publisher platform could name something identical tomorrow. Keyed on the value
 * alone, one dimension's bucket would silently overwrite another's.
 */
@Index(
  'UQ_social_ad_breakdown_daily_fact',
  [
    'tenantId',
    'workspaceId',
    'connectionId',
    'entityLevel',
    'entityExternalId',
    'metricDate',
    'breakdownKind',
    'breakdownKey',
  ],
  { unique: true },
)
// The shape of every breakdown read: one connection, one dimension, a range.
@Index('IDX_social_ad_breakdown_daily_read', [
  'tenantId',
  'workspaceId',
  'connectionId',
  'breakdownKind',
  'metricDate',
])
@Index(
  'IDX_social_ad_breakdown_daily_partial',
  ['connectionId', 'metricDate'],
  {
    where: '"is_partial"',
  },
)
@Check(
  'CK_social_ad_breakdown_daily_level',
  `"entity_level" IN ('account', 'campaign', 'adset', 'ad')`,
)
@Check(
  'CK_social_ad_breakdown_daily_kind',
  `"breakdown_kind" IN ('age_gender', 'device_platform', 'publisher_platform')`,
)
@Check(
  'CK_social_ad_breakdown_daily_non_negative',
  `"spend" >= 0
   AND "impressions" >= 0
   AND "clicks" >= 0
   AND "link_clicks" >= 0
   AND ("reach" IS NULL OR "reach" >= 0)`,
)
export class SocialAdBreakdownDailyEntity {
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

  @Column({ name: 'entity_level', type: 'varchar', length: 20 })
  entityLevel!: SocialAdEntityLevel;

  @Column({ name: 'entity_external_id', type: 'varchar', length: 180 })
  entityExternalId!: string;

  /** A calendar day in the ad account's timezone. Never converted. */
  @Column({ name: 'metric_date', type: 'date' })
  metricDate!: string;

  /** The zone that defined the day boundary above, stored with the fact. */
  @Column({ name: 'account_timezone', type: 'varchar', length: 64 })
  accountTimezone!: string;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency!: string | null;

  @Column({ name: 'breakdown_kind', type: 'varchar', length: 32 })
  breakdownKind!: SocialAdBreakdownKind;

  /**
   * The provider's own value for this dimension, normalized only in shape.
   *
   * `25-34|female` for age/gender, `mobile_app` for device, `instagram` for
   * publisher. Stored as Meta said it, lowercased and bounded, because it is the
   * join key between a stored row and a label the read layer supplies — a
   * "friendlier" value written here would make old rows unmatchable the first
   * time that friendliness was revised.
   */
  @Column({ name: 'breakdown_key', type: 'varchar', length: 64 })
  breakdownKey!: string;

  /** `numeric`, never a float. Same reasoning as the facts table. */
  @Column({ type: 'numeric', precision: 18, scale: 6, default: 0 })
  spend!: string;

  @Column({ type: 'bigint', default: 0 })
  impressions!: string;

  @Column({ type: 'bigint', default: 0 })
  clicks!: string;

  @Column({ name: 'link_clicks', type: 'bigint', default: 0 })
  linkClicks!: string;

  /**
   * Non-additive twice over, which is worth stating because this table makes the
   * second way easy to get wrong.
   *
   * Reach is de-duplicated people, so it cannot be summed across *days* — the
   * rule the whole module already follows. It also cannot be summed across
   * *buckets of the same day*: a person reached on both mobile and desktop is
   * counted in each, so the device buckets of one day add up to more than that
   * day's reach. Neither direction is implemented anywhere; the column stores
   * what Meta said for the grain it was asked about.
   */
  @Column({ type: 'bigint', nullable: true })
  reach!: string | null;

  /**
   * The full action breakdown as reported, plus the mapping version that read
   * it: `{ mappingVersion, counts, values }`, exactly as on the facts table.
   *
   * Kept whole rather than promoted into columns so that `leads`, `conversions`
   * and `conversion_value` have one definition across both tables. A revision to
   * the action mapping then changes what a breakdown reports without a
   * re-ingest, and `mappingVersion` says which definition a stored row follows.
   */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  actions!: Record<string, unknown>;

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
