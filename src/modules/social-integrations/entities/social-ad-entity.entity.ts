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
 * Where an object sits in the Meta delivery hierarchy.
 *
 * Account → campaign → ad set → ad, and every provider Lyra Social is likely
 * to add uses the same four floors under different names (Google: customer →
 * campaign → ad group → ad). Naming the levels after the shape rather than
 * after Meta's vocabulary is what lets the second provider land in this table
 * instead of next to it.
 */
export type SocialAdEntityLevel = 'account' | 'campaign' | 'adset' | 'ad';

/**
 * The local mirror of the ad hierarchy — one row per account, campaign, ad set
 * and ad the product has seen.
 *
 * One table for four levels, not four tables. The levels differ by three or
 * four columns and share every scope, identity and freshness concern; splitting
 * them would mean four upserts, four unique keys and a four-way union on every
 * read that renders a tree. The `entity_level` check constraint is what keeps
 * that from degenerating into an untyped bag.
 *
 * This is a *read model*: nothing here is authored in Lyra. Every row is the
 * provider's answer, and the provider is free to change it. That is why the
 * table carries `first_seen_at` / `last_seen_at` / `archived_at` rather than a
 * plain delete — an object that stops coming back from the API has not
 * necessarily ceased to exist, and last month's spend still needs a name to
 * hang on.
 */
@Entity('social_ad_entities')
// The identity of a mirrored object: the same external id under a different
// connection is a different object, because it can be a different Business.
@Index(
  'UQ_social_ad_entities_identity',
  ['tenantId', 'workspaceId', 'connectionId', 'entityLevel', 'externalId'],
  { unique: true },
)
@Index('IDX_social_ad_entities_scope', [
  'tenantId',
  'workspaceId',
  'agencyClientId',
  'entityLevel',
])
@Index('IDX_social_ad_entities_parent', ['connectionId', 'parentExternalId'])
// "What did this sync not see?" — the query that marks disappeared objects.
@Index('IDX_social_ad_entities_stale', ['connectionId', 'lastSeenAt'])
@Check(
  'CK_social_ad_entities_level',
  `"entity_level" IN ('account', 'campaign', 'adset', 'ad')`,
)
// An account is the root: a parent id on one would mean the sync mistook a
// campaign for its account, which is exactly the bug that silently produces a
// second, orphaned tree. The converse is deliberately not enforced — a
// campaign whose account id failed to come back should degrade to a rootless
// row, not abort the whole ingest.
@Check(
  'CK_social_ad_entities_account_has_no_parent',
  `"entity_level" <> 'account' OR "parent_external_id" IS NULL`,
)
@Check(
  'CK_social_ad_entities_budgets_non_negative',
  `("daily_budget_minor" IS NULL OR "daily_budget_minor" >= 0)
   AND ("lifetime_budget_minor" IS NULL OR "lifetime_budget_minor" >= 0)
   AND ("budget_remaining_minor" IS NULL OR "budget_remaining_minor" >= 0)`,
)
export class SocialAdEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** Managed client this row belongs to. NULL means the agency's own account. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  /**
   * The connection that produced this row. Cascades on delete: a mirror
   * without the credential that produced it cannot be refreshed, corrected or
   * even explained.
   */
  @Column({ name: 'connection_id', type: 'uuid' })
  connectionId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  @Column({ name: 'entity_level', type: 'varchar', length: 20 })
  entityLevel!: SocialAdEntityLevel;

  /** Provider-side id, unprefixed for campaigns/ad sets/ads, `act_…` for accounts. */
  @Column({ name: 'external_id', type: 'varchar', length: 180 })
  externalId!: string;

  /** The level immediately above: account for a campaign, campaign for an ad set. */
  @Column({
    name: 'parent_external_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  parentExternalId!: string | null;

  /**
   * Denormalised campaign id, carried by every level below the account so that
   * "spend by campaign" does not need to walk the tree upward at read time.
   */
  @Column({
    name: 'campaign_external_id',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  campaignExternalId!: string | null;

  /**
   * `text`, not a bounded varchar: this is provider-authored copy, and a name
   * one character over a limit would abort an entire sync run with a length
   * error. There is nothing to protect here — the column is never an
   * identifier.
   */
  @Column({ type: 'text', nullable: true })
  name!: string | null;

  /** Configured state: ACTIVE, PAUSED, ARCHIVED… */
  @Column({ type: 'varchar', length: 40, nullable: true })
  status!: string | null;

  /**
   * Delivery state, which is the one people actually ask about: a campaign can
   * be ACTIVE and still not be spending because its ad set is in review or the
   * account is disabled.
   */
  @Column({
    name: 'effective_status',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  effectiveStatus!: string | null;

  @Column({ type: 'varchar', length: 60, nullable: true })
  objective!: string | null;

  @Column({
    name: 'optimization_goal',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  optimizationGoal!: string | null;

  @Column({
    name: 'billing_event',
    type: 'varchar',
    length: 60,
    nullable: true,
  })
  billingEvent!: string | null;

  /**
   * Budgets in the currency's minor unit (cents), which is how Meta reports
   * them. Stored as given rather than converted: a float division here would
   * be a rounding error that then propagates into every derived KPI.
   */
  @Column({ name: 'daily_budget_minor', type: 'bigint', nullable: true })
  dailyBudgetMinor!: string | null;

  @Column({ name: 'lifetime_budget_minor', type: 'bigint', nullable: true })
  lifetimeBudgetMinor!: string | null;

  @Column({ name: 'budget_remaining_minor', type: 'bigint', nullable: true })
  budgetRemainingMinor!: string | null;

  @Column({ type: 'varchar', length: 8, nullable: true })
  currency!: string | null;

  @Column({ name: 'start_time', type: 'timestamptz', nullable: true })
  startTime!: Date | null;

  @Column({ name: 'stop_time', type: 'timestamptz', nullable: true })
  stopTime!: Date | null;

  @Column({
    name: 'provider_created_time',
    type: 'timestamptz',
    nullable: true,
  })
  providerCreatedTime!: Date | null;

  @Column({
    name: 'provider_updated_time',
    type: 'timestamptz',
    nullable: true,
  })
  providerUpdatedTime!: Date | null;

  @Column({
    name: 'first_seen_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  firstSeenAt!: Date;

  /** Touched by every sync that still finds the object. Drives staleness. */
  @Column({ name: 'last_seen_at', type: 'timestamptz', default: () => 'now()' })
  lastSeenAt!: Date;

  /**
   * Set when a sync stops finding the object. Not a delete: historical metrics
   * reference these rows for their names, and deletion would turn last
   * quarter's report into a list of numeric ids.
   */
  @Column({ name: 'archived_at', type: 'timestamptz', nullable: true })
  archivedAt!: Date | null;

  /** Derived, non-credential context only. Never a token. */
  @Column({ type: 'jsonb', default: () => "'{}'::jsonb" })
  metadata!: Record<string, unknown>;

  /**
   * The provider payload the row was built from, kept for debugging a bad
   * mapping without re-querying Meta.
   *
   * Nullable and unwritten for now: no reader exists yet, and retention is
   * deliberately *not* implemented in this slice. Whoever starts writing it
   * owns adding the sweep, because an unbounded raw column on the ad hierarchy
   * grows with every sync.
   */
  @Column({ type: 'jsonb', nullable: true })
  raw!: Record<string, unknown> | null;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
