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
 * The grains a reach measurement may be taken at.
 *
 * The four paid levels, plus `organic_asset` for the IG/Page side that §2.1 of
 * the plan says will reuse this cache. Only `account` is measured today; the
 * rest are in the union and in the CHECK because the unique key includes the
 * level, and a level arriving later must not need a migration to be storable.
 *
 * A separate union from `SocialAdEntityLevel` rather than that one plus a
 * string: the facts table's levels are *the levels Meta reports insights at*,
 * and adding an organic asset to it would make that type mean something else
 * everywhere it is used.
 */
export type SocialAdReachEntityLevel =
  | 'account'
  | 'campaign'
  | 'adset'
  | 'ad'
  | 'organic_asset';

/**
 * One reach measurement of one entity over one exact calendar range.
 *
 * ## Why this is a cache of measurements and not a fact table
 *
 * Every other table in this module stores a *fact*: something that happened on a
 * day, from which any period's total is a sum. This one cannot work that way,
 * because reach is de-duplicated people. A thousand people reached on Monday and
 * the same thousand on Tuesday is a two-day reach of one thousand, and no
 * arithmetic over the daily rows recovers that — the overlap is known only to
 * Meta, over identities this system never sees.
 *
 * So a row here answers exactly one question: *what was the reach of this
 * range?* Ranges do not decompose into each other and are never combined. The
 * read is by **equality on both endpoints**, never `BETWEEN`, never `SUM`, never
 * `MAX`. A 7-day row and a 30-day row that share six days are two independent
 * measurements, and neither constrains the other beyond the obvious inequality.
 *
 * That is also why there is no `metric_date` and no daily grain: a row is not
 * about a day. `period_since` and `period_until` are a composite key component,
 * not a range to be scanned.
 *
 * ## Why a closed range is measured once, ever
 *
 * `is_partial` marks a row whose `period_until` was the account's own today when
 * it was measured — a subtotal over a day still accumulating. Those are
 * re-measured on the next pass. A range entirely in the past is immutable: Meta
 * restates spend and conversions for up to 28 days, but a late-arriving
 * conversion is attributed to a day whose audience was already counted. Who was
 * reached on a closed day does not change.
 */
@Entity('social_ad_reach_periods')
/**
 * The identity of a measurement, and the ON CONFLICT target of the upsert.
 *
 * Both endpoints are in the key, which is the whole design in one line: a range
 * is identified by what it covers, so re-measuring the same range updates in
 * place while a different range — even one day longer — is a different row.
 *
 * The scope columns lead, as they do on the facts table, so the index serves the
 * scoped lookup the read performs.
 */
@Index(
  'UQ_social_ad_reach_periods_measurement',
  [
    'tenantId',
    'workspaceId',
    'connectionId',
    'entityLevel',
    'entityExternalId',
    'periodSince',
    'periodUntil',
  ],
  { unique: true },
)
/**
 * The rows a prewarm pass must re-measure.
 *
 * Partial in both senses, like the facts table's own: it indexes only the
 * measurements that are still moving, so "what is stale?" stays a small scan
 * however many closed ranges have accumulated.
 */
@Index('IDX_social_ad_reach_periods_partial', ['connectionId', 'periodUntil'], {
  where: '"is_partial"',
})
@Check(
  'CK_social_ad_reach_periods_level',
  `"entity_level" IN ('account', 'campaign', 'adset', 'ad', 'organic_asset')`,
)
/**
 * A range must not run backwards.
 *
 * Cheap, and it guards the one mistake that would corrupt the cache silently: a
 * swapped pair stores a real measurement under a range nobody will ever ask
 * for, while the range they do ask for stays unmeasured forever.
 */
@Check('CK_social_ad_reach_periods_range', `"period_since" <= "period_until"`)
@Check(
  'CK_social_ad_reach_periods_non_negative',
  `"reach" IS NULL OR "reach" >= 0`,
)
export class SocialAdReachPeriodEntity {
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
  entityLevel!: SocialAdReachEntityLevel;

  @Column({ name: 'entity_external_id', type: 'varchar', length: 180 })
  entityExternalId!: string;

  /** Inclusive first day, a calendar day in the account's zone. */
  @Column({ name: 'period_since', type: 'date' })
  periodSince!: string;

  /** Inclusive last day. Together with the above, the question this row answers. */
  @Column({ name: 'period_until', type: 'date' })
  periodUntil!: string;

  /** The zone that defined both day boundaries above, stored with the row. */
  @Column({ name: 'account_timezone', type: 'varchar', length: 64 })
  accountTimezone!: string;

  /**
   * People reached over this exact range, as Meta de-duplicated them.
   *
   * Nullable because Meta omits the field for some requests, and a `0` for "not
   * reported" is indistinguishable from a genuine zero-reach range. A null row
   * still records that the measurement was attempted and when — which is what
   * keeps a prewarm pass from retrying it every hour.
   *
   * Never summed with another row. There is no expression over this column that
   * yields a different range's reach.
   */
  @Column({ type: 'bigint', nullable: true })
  reach!: string | null;

  /**
   * The range reached into a day the account had not finished.
   *
   * The re-measure flag. A true row is a subtotal; a false row is final and is
   * never measured again.
   */
  @Column({ name: 'is_partial', type: 'boolean', default: false })
  isPartial!: boolean;

  /**
   * When Meta was asked.
   *
   * Travels all the way to the UI, which shows it in the tooltip: a reach figure
   * with no measurement time is a number a reader cannot reconcile against the
   * Ads Manager tab they have open beside it.
   */
  @Column({ name: 'measured_at', type: 'timestamptz', default: () => 'now()' })
  measuredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
