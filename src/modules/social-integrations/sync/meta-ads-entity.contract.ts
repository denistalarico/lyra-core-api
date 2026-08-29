import type { SocialAdEntityLevel } from '../entities/social-ad-entity.entity';

/**
 * One row of the ad hierarchy, already normalized, ready to be written.
 *
 * The whole reason this type exists is that a Meta payload must never reach
 * TypeORM. Graph answers are loosely typed by design — `daily_budget` arrives
 * as a string of minor units, `stop_time` as an ISO stamp with a `-0700`
 * offset, `campaign_id` is present on some edges and absent on others — and a
 * writer that consumed them directly would be re-deriving those quirks at the
 * moment it builds SQL, where a mistake becomes a stored value.
 *
 * So the shape below is Lyra's, not Meta's: every field is already the type and
 * the unit the column expects, and anything the provider did not send is `null`
 * rather than a substitute. It is also the seam a second provider lands on —
 * Google Ads has the same four floors under different names, and it is this
 * contract it will produce, not `social_ad_entities` rows directly.
 */
export type NormalizedAdEntity = {
  entityLevel: SocialAdEntityLevel;
  /** Canonical provider id: `act_<digits>` for accounts, bare digits below. */
  externalId: string;
  /** The level immediately above. NULL for an account, or when Meta omitted it. */
  parentExternalId: string | null;
  /** Denormalized campaign, carried by every level below the account. */
  campaignExternalId: string | null;
  name: string | null;
  status: string | null;
  effectiveStatus: string | null;
  objective: string | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  /**
   * Where the click or conversation lands, canonical and provider-verbatim.
   *
   * `null` at every level except ad set, because the ad set is the only level
   * where Meta states it. Not inherited downward to ads: the ad's destination
   * *is* its ad set's, so a reader joins rather than reads a copy that can
   * drift. `observedAt` is the sync instant, and it is what lets a reader tell
   * a classification observed in August from one that was true in July.
   */
  destinationType: string | null;
  destinationRaw: string | null;
  destinationObservedAt: Date | null;
  /**
   * Whether the provider actually answered about the destination.
   *
   * Separate from the value because "Meta said `UNDEFINED`" and "Meta sent no
   * field" both resolve to `unknown`, and only the first is evidence. The
   * historical log appends on evidence alone: treating provider silence as an
   * observed move to `unknown` would let one degraded response close a known
   * period and make an ad set look like it stopped pointing anywhere.
   *
   * `false` at every level that cannot carry a destination at all.
   */
  destinationObserved: boolean;
  /**
   * Budgets in the currency's minor unit, as decimal strings.
   *
   * Strings rather than numbers on purpose: the column is `bigint`, TypeORM
   * hands `bigint` back as a string, and routing the value through a JS number
   * would put a lifetime budget above 2^53 minor units at risk of silent
   * rounding. `null` means Meta did not send the field — never `0`, which is a
   * budget of zero and a different fact.
   */
  dailyBudgetMinor: string | null;
  lifetimeBudgetMinor: string | null;
  budgetRemainingMinor: string | null;
  /**
   * Currency of the budgets above.
   *
   * Copied down from the account, because Meta returns it only on the account
   * node while the budgets it denominates live on campaigns and ad sets. A
   * minor-unit amount without its currency cannot be rendered at all.
   */
  currency: string | null;
  startTime: Date | null;
  stopTime: Date | null;
  providerCreatedTime: Date | null;
  providerUpdatedTime: Date | null;
  /**
   * Auxiliary facts with no column of their own, and nothing else.
   *
   * Not a landing place for the payload: `raw` is the column for that and this
   * slice deliberately leaves it NULL. Only what a reader would otherwise have
   * to call Meta again for goes here.
   */
  metadata: Record<string, unknown>;
};

/** Rows of one level, plus whether the read actually saw all of them. */
export type NormalizedAdEntityPage = {
  rows: NormalizedAdEntity[];
  /**
   * The provider had more pages than the ceiling allowed.
   *
   * Carried all the way to the sync service because it decides whether stale
   * archiving may run: absence is only meaningful against a complete snapshot.
   */
  truncated: boolean;
  /** Rows dropped for having no usable id. */
  skipped: number;
  /** Graph requests this level actually cost. */
  apiCalls: number;
};
