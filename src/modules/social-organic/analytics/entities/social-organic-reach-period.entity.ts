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
 * A de-duplicated organic reach measurement for one asset and one range.
 *
 * Not a fact table: each row is one *measurement of a period*, taken by asking
 * Meta for the whole range at once. It cannot be derived from
 * `social_organic_account_metrics_daily` by any arithmetic — the information
 * about who appeared on more than one day never leaves Meta — which is exactly
 * why the measurement has to be stored rather than computed.
 *
 * **`reach` here includes ads.** The period request only collapses to a single
 * de-duplicated number when nothing breaks it down, and the breakdown is what
 * the daily ingest uses to isolate organic-only surfaces. So this matches
 * Meta's own "Contas alcançadas" figure and is a different measurement from the
 * daily `reach` column, not a period version of it.
 *
 * Mirrors `SocialAdReachPeriodEntity` on the paid side.
 */
@Entity('social_organic_reach_periods')
@Index(
  'UQ_social_organic_reach_periods_window',
  ['assetId', 'periodSince', 'periodUntil'],
  { unique: true },
)
@Index('IDX_social_organic_reach_periods_scope', [
  'tenantId',
  'workspaceId',
  'assetId',
  'periodUntil',
])
@Check(
  'CK_social_organic_reach_periods_range',
  `"period_until" >= "period_since"`,
)
@Check(
  'CK_social_organic_reach_periods_non_negative',
  `"reach" IS NULL OR "reach" >= 0`,
)
export class SocialOrganicReachPeriodEntity {
  @PrimaryGeneratedColumn('uuid')
  id!: string;

  @Column({ name: 'tenant_id', type: 'uuid' })
  tenantId!: string;

  @Column({ name: 'workspace_id', type: 'uuid' })
  workspaceId!: string;

  /** NULL means the agency's own context; otherwise a managed client. */
  @Column({ name: 'agency_client_id', type: 'uuid', nullable: true })
  agencyClientId!: string | null;

  @Column({ name: 'asset_id', type: 'uuid' })
  assetId!: string;

  @Column({ type: 'varchar', length: 40 })
  provider!: string;

  /** Calendar days in the asset's timezone, inclusive at both ends. */
  @Column({ name: 'period_since', type: 'date' })
  periodSince!: string;

  @Column({ name: 'period_until', type: 'date' })
  periodUntil!: string;

  @Column({ name: 'asset_timezone', type: 'varchar', length: 64 })
  assetTimezone!: string;

  /**
   * The de-duplicated reach of the window, **ads included**. NULL when Meta
   * reported none — never conflated with a measured zero.
   */
  @Column({ type: 'bigint', nullable: true })
  reach!: string | null;

  /**
   * The same window's reach split into Meta's own slices.
   *
   * **They do not add up to `reach`, and that is not a bug.** Verified against
   * production on 2026-09-24: 156 organic + 6 645 paid = 6 801 against a total
   * of 6 783. Meta counts an account reached both organically and by an ad once
   * in the total and once in each slice, so the difference is the overlap.
   *
   * The consequence for any caller: never derive one of these from the others.
   * `total - organic` is not the paid slice, it is the paid slice minus the
   * overlap, and it will read as a plausible number that is quietly wrong.
   *
   * NULL means Meta returned no breakdown for the window — not zero. "Nothing
   * was paid" and "we did not learn what was paid" must not render alike.
   */
  @Column({ name: 'reach_organic', type: 'bigint', nullable: true })
  reachOrganic!: string | null;

  @Column({ name: 'reach_paid', type: 'bigint', nullable: true })
  reachPaid!: string | null;

  /**
   * Feed posts only — Meta's "Alcance das postagens".
   *
   * A **subset of `reachOrganic`**, not a third slice beside it: reels and
   * stories are organic as well. So `reachFeed <= reachOrganic` holds, and the
   * two must never be added.
   */
  @Column({ name: 'reach_feed', type: 'bigint', nullable: true })
  reachFeed!: string | null;

  /**
   * Views for the same window, on the same terms as `reach` above: the total
   * includes ads, the slices are Meta's and do not sum to it.
   *
   * Views are impressions, not people, so unlike reach they *are* additive
   * across days in principle — but the period figure is still stored rather
   * than summed, because Meta's own window answer is what the card must match
   * and the daily rows only ever covered days the sync happened to catch.
   */
  @Column({ type: 'bigint', nullable: true })
  views!: string | null;

  @Column({ name: 'views_organic', type: 'bigint', nullable: true })
  viewsOrganic!: string | null;

  @Column({ name: 'views_paid', type: 'bigint', nullable: true })
  viewsPaid!: string | null;

  /**
   * The remaining per-surface slices, on the same terms as `reachFeed`.
   *
   * Each is a **subset of the organic slice**, and the three surfaces do not
   * partition it: Meta de-duplicates within each, so an account that saw a
   * story and a reel is one account in `reachOrganic` and one in each of the
   * two columns. Adding them, or subtracting them from the organic total,
   * states a number Meta did not report.
   *
   * Views are the exception to the de-duplication concern — they are
   * impressions, not people — but they are still stored per surface rather than
   * derived, because the total's own de-duplication is Meta's and nothing local
   * could reproduce it.
   */
  @Column({ name: 'reach_reel', type: 'bigint', nullable: true })
  reachReel!: string | null;

  @Column({ name: 'reach_story', type: 'bigint', nullable: true })
  reachStory!: string | null;

  @Column({ name: 'views_feed', type: 'bigint', nullable: true })
  viewsFeed!: string | null;

  @Column({ name: 'views_reel', type: 'bigint', nullable: true })
  viewsReel!: string | null;

  @Column({ name: 'views_story', type: 'bigint', nullable: true })
  viewsStory!: string | null;

  /**
   * The engagement family for the same window, sliced by surface.
   *
   * These *are* additive in the ordinary sense — a like is a like — so unlike
   * reach they could in principle be summed from per-post rows. They are stored
   * because per-post rows only exist for content the sync caught, and because
   * `interactionsStory` has no per-post source at all on an account whose
   * stories expired before they were observed.
   */
  @Column({ name: 'interactions_reel', type: 'bigint', nullable: true })
  interactionsReel!: string | null;

  @Column({ name: 'interactions_story', type: 'bigint', nullable: true })
  interactionsStory!: string | null;

  @Column({ name: 'likes_reel', type: 'bigint', nullable: true })
  likesReel!: string | null;

  @Column({ name: 'comments_reel', type: 'bigint', nullable: true })
  commentsReel!: string | null;

  @Column({ name: 'saves_reel', type: 'bigint', nullable: true })
  savesReel!: string | null;

  @Column({ name: 'shares_reel', type: 'bigint', nullable: true })
  sharesReel!: string | null;

  @Column({ name: 'shares_story', type: 'bigint', nullable: true })
  sharesStory!: string | null;

  /**
   * How many reels and stories the account published in the window.
   *
   * Counted from the publication listing, not from insights: "quantos reels no
   * período" is a question about content, and Meta offers no metric for it.
   * `storyCount` is what the story collector saw while the stories were live,
   * so it is a floor rather than a certainty — see the stories entity.
   */
  @Column({ name: 'reel_count', type: 'int', nullable: true })
  reelCount!: number | null;

  @Column({ name: 'story_count', type: 'int', nullable: true })
  storyCount!: number | null;

  /**
   * The range Meta actually measured, which may be narrower than the stored
   * window: Meta refuses a span wider than 30 days, so a longer request is
   * clamped to its last 30. Kept so a card can label the figure with the range
   * behind it instead of the one that was asked for.
   */
  @Column({ name: 'measured_since', type: 'date', nullable: true })
  measuredSince!: string | null;

  @Column({ name: 'measured_until', type: 'date', nullable: true })
  measuredUntil!: string | null;

  /** True when the clamp above narrowed the caller's window. */
  @Column({ type: 'boolean', default: false })
  truncated!: boolean;

  /**
   * Whether the range's last day was still accumulating when this was taken.
   *
   * A window ending today is worth re-measuring; one that has closed is final,
   * and re-reading it would spend quota to learn the same number.
   */
  @Column({ name: 'is_partial', type: 'boolean', default: false })
  isPartial!: boolean;

  @Column({
    name: 'measured_at',
    type: 'timestamptz',
    default: () => 'now()',
  })
  measuredAt!: Date;

  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt!: Date;

  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt!: Date;
}
