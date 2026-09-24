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
 * How many followers were online in one hour of one day.
 *
 * The grid behind both "melhor dia para postar" and "melhor horário para
 * postar". One collection answers both: Meta returns, per day, a map of 24
 * hourly counts, so the best weekday is that grid read one way and the best
 * hour is it read the other.
 *
 * ## `followersOnline` is a stock, and this is the contract of the table
 *
 * A row says "at this hour, this many followers were online" — not "this many
 * came online". The same person online at 14:00 and at 15:00 is counted in both
 * rows, so **summing across hours or days does not produce a number of people**
 * and any total built that way is meaningless.
 *
 * What is legitimate is comparing and averaging: the mean count for Tuesdays
 * against the mean for Fridays, or for 20:00 against 08:00. Both charts do
 * exactly that, which is why the table stores the grid rather than either
 * aggregate — and why a third question asked later needs no re-collection of a
 * window Meta will by then have dropped.
 *
 * ## The hour is Meta's, not the asset's
 *
 * Meta reports this metric against `end_time` values at `07:00:00+0000`, which
 * is midnight Pacific: the hours are stated in PST whatever the account's own
 * timezone. `metricDate` and `hourOfDay` are stored exactly as Meta indexed
 * them and `sourceTimezone` records which zone that is, leaving the conversion
 * to the read layer.
 *
 * Converting on the way in would bake the assumption into rows that cannot be
 * re-derived — Meta serves roughly 30 days of this metric and nothing older, so
 * a wrong assumption discovered later could not be corrected by re-reading.
 */
@Entity({ name: 'social_organic_online_followers' })
@Index('IDX_social_organic_online_followers_read', [
  'tenantId',
  'workspaceId',
  'assetId',
  'metricDate',
])
@Index(
  'UQ_social_organic_online_followers_fact',
  ['assetId', 'metricDate', 'hourOfDay'],
  { unique: true },
)
@Check(
  'CK_social_organic_online_followers_hour',
  '"hour_of_day" >= 0 AND "hour_of_day" <= 23',
)
@Check(
  'CK_social_organic_online_followers_non_negative',
  '"followers_online" >= 0',
)
export class SocialOrganicOnlineFollowersEntity {
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

  /** The calendar day as Meta indexed it, in `sourceTimezone`. */
  @Column({ name: 'metric_date', type: 'date' })
  metricDate!: string;

  /** 0–23, likewise in `sourceTimezone` rather than the asset's. */
  @Column({ name: 'hour_of_day', type: 'smallint' })
  hourOfDay!: number;

  /** The asset's own zone, kept so the read can convert into it. */
  @Column({ name: 'asset_timezone', type: 'varchar', length: 64 })
  assetTimezone!: string;

  /**
   * The zone `metricDate` and `hourOfDay` are expressed in.
   *
   * Recorded rather than assumed. It is what makes a stored hour interpretable
   * at all, and what lets a correction be a change to one function instead of a
   * re-collection that Meta's retention window makes impossible.
   */
  @Column({
    name: 'source_timezone',
    type: 'varchar',
    length: 64,
    default: 'America/Los_Angeles',
  })
  sourceTimezone!: string;

  /** A STOCK. Never sum across hours or days — see the class note. */
  @Column({ name: 'followers_online', type: 'bigint' })
  followersOnline!: string;

  /**
   * The instant the reading was taken, beside the day it describes. The day
   * answers "which hour"; this answers "how fresh", which matters when Meta's
   * newest available day is several days behind.
   */
  @Column({ name: 'observed_at', type: 'timestamptz', default: () => 'now()' })
  observedAt!: Date;

  @Column({ name: 'synced_at', type: 'timestamptz', default: () => 'now()' })
  syncedAt!: Date;

  /**
   * The run that wrote the row, carrying no foreign key on purpose: pruning old
   * run logs must never delete the facts they produced. Same rule as the
   * audience and daily fact tables.
   */
  @Column({ name: 'sync_run_id', type: 'uuid', nullable: true })
  syncRunId!: string | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
