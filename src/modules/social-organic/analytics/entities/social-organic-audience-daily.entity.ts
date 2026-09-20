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
 * The audience dimensions this pipeline ingests.
 *
 * `age_gender` is the cross Instagram reports directly; `gender` and `age` are
 * the marginals Facebook Pages report separately. Both spellings exist because
 * the two providers genuinely answer different questions, and deriving the
 * marginals from a stored cross would be arithmetic on a snapshot that does not
 * always cover the same followers — Meta suppresses small buckets, so the cross
 * can sum to less than the marginal it is supposed to decompose.
 */
export type SocialOrganicAudienceKind =
  | 'age_gender'
  | 'gender'
  | 'age'
  | 'city'
  | 'country';

/**
 * Follower demographics, as observed on one day.
 *
 * ## `value` is a stock, and this is the whole contract of the table
 *
 * Meta reports follower demographics as **lifetime totals**: a row says "on this
 * day, this many of the followers were in this bucket", not "this many joined
 * that bucket that day". Two consecutive days are two measurements of largely
 * the same people, so summing them counts almost everybody twice — and unlike
 * reach, nothing about the number looks wrong afterwards. A "followers by
 * gender" chart built from a 30-day sum would simply report thirty times the
 * audience, plausibly.
 *
 * So the read takes the **newest day in the window** and never a range
 * aggregate, and there is no additive column here at all. The same distinction
 * the post metrics table already draws with its `*_lifetime` columns, made
 * structural: this table has no daily-flow column that a lifetime value could be
 * mistaken for.
 *
 * ## Why it is not columns on `social_organic_account_metrics_daily`
 *
 * That table is daily flow — followers gained, followers lost, impressions,
 * reach. A demographic split has an unbounded number of buckets (a city
 * dimension has as many rows as the audience has cities), so it cannot be
 * columns, and a jsonb blob there would be a value no index can reach and no
 * constraint can check.
 */
@Entity('social_organic_audience_daily')
/**
 * One snapshot per asset per dimension per bucket per day.
 *
 * A resync on the same calendar day collapses onto the row already there, which
 * is intended: a lifetime total re-read four hours later is a better measurement
 * of the same day, not a second one.
 *
 * The asset scopes the key on its own — an asset belongs to exactly one tenant —
 * so tenant and workspace are stored for the read's predicates rather than for
 * identity, exactly as the account metrics table keys on `(asset_id,
 * metric_date, source)`.
 */
@Index(
  'UQ_social_organic_audience_daily_fact',
  ['assetId', 'metricDate', 'breakdownKind', 'breakdownKey'],
  { unique: true },
)
// The read is always "the newest snapshot of one dimension", so the date
// descends in the index rather than being sorted after the fact.
@Index('IDX_social_organic_audience_daily_read', [
  'tenantId',
  'workspaceId',
  'assetId',
  'breakdownKind',
  'metricDate',
])
@Check(
  'CK_social_organic_audience_daily_kind',
  `"breakdown_kind" IN ('age_gender', 'gender', 'age', 'city', 'country')`,
)
@Check('CK_social_organic_audience_daily_non_negative', `"value" >= 0`)
export class SocialOrganicAudienceDailyEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  /**
   * The day the snapshot was taken, in the asset's own timezone.
   *
   * The day of *observation*, never a day the value describes — a lifetime total
   * has no period of its own. It is what makes "the newest snapshot" a question
   * with an answer.
   */
  @Column({ name: 'metric_date', type: 'date' })
  metricDate!: string;

  @Column({ name: 'asset_timezone', type: 'varchar', length: 64 })
  assetTimezone!: string;

  @Column({ name: 'breakdown_kind', type: 'varchar', length: 32 })
  breakdownKind!: SocialOrganicAudienceKind;

  /**
   * The provider's own value for this dimension, normalized only in shape.
   *
   * `25-34|f` as Instagram spells the cross, `male`, `br` for a country, and a
   * place name for a city. Wider than the paid table's key (96 vs 64) because a
   * city key carries a place name and a country (`são paulo, brazil`), not a
   * provider enum.
   */
  @Column({ name: 'breakdown_key', type: 'varchar', length: 96 })
  breakdownKey!: string;

  /**
   * How many followers were in this bucket on `metric_date`.
   *
   * `numeric` rather than `bigint` because Meta's `total_value` breakdowns are
   * not always whole — some are reported as shares — and a fractional value
   * arriving into an integer column would be a write that fails a whole sync
   * rather than a number that stores.
   *
   * **Never summed across days.** See the class note.
   */
  @Column({ type: 'numeric', precision: 18, scale: 6, default: 0 })
  value!: string;

  /**
   * The instant the snapshot was read, beside the calendar day it was filed
   * under. The day answers "which snapshot"; this answers "how fresh", which a
   * reader needs when the newest snapshot is several days old.
   */
  @Column({ name: 'observed_at', type: 'timestamptz', default: () => 'now()' })
  observedAt!: Date;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;

  /**
   * The run that wrote the row. `ON DELETE SET NULL` in spirit, like the paid
   * facts table: pruning old run logs must never delete the facts they produced,
   * which is why this carries no foreign key.
   */
  @Column({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
