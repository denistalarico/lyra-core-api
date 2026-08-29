import type { IntelligenceMetricDescriptor } from './intelligence-metric';

/**
 * The domain a fact belongs to.
 *
 * Named after *what is being measured*, never after the module that measures it.
 * `paid_media` rather than `social`, because the equation "Social = Ads" is
 * exactly the assumption this contract has to avoid baking in: the Social module
 * will one day also report organic reach and profile growth, which are a
 * different domain reported by the same module. `organic_social` and
 * `web_analytics` are listed now so that the day they arrive is an added member
 * rather than a rename of everything that switched on the enum.
 */
export type IntelligenceDomain =
  /** Money spent to deliver advertising, and what that delivery produced. */
  | 'paid_media'
  /** Conversations with people: volume, responsiveness, who replied. */
  | 'conversation'
  /** The commercial pipeline: opportunities, their stages, their outcomes. */
  | 'commercial'
  /** Owned-channel presence that was not paid for. No adapter yet. */
  | 'organic_social'
  /** Site and property behaviour. No adapter yet. */
  | 'web_analytics';

/**
 * What a fact is *about*.
 *
 * Structurally separate from `connectionId`, and that separation is the point.
 * The obvious modelling — every fact hangs off a connection this tenant
 * authorised — is true of everything S2 ingests and false of the first thing
 * Competitive Intelligence will want to store, which is a measurement of a
 * profile nobody here owns or connected. Making `connectionId` the subject would
 * mean that feature could not be expressed without changing every consumer.
 *
 * So the subject is a `{ type, id }` pair, and `ad_account` is merely the first
 * type. The id is the local identifier where one exists — a connection's UUID —
 * because that is what a caller can navigate back to.
 */
export type IntelligenceSubjectType =
  /** One ad account, addressed by its local connection id. */
  | 'ad_account'
  /** One workspace's own operation, for facts that belong to no connection. */
  | 'workspace';

export type IntelligenceSubject = {
  type: IntelligenceSubjectType;
  id: string;
};

/**
 * The time resolution the caller asked for.
 *
 * Only two members, and the omissions are deliberate. `campaign`, `account` and
 * `entity` are *not* grains: they are dimensions, and the difference matters
 * because they compose independently of time. Asking for per-campaign daily
 * facts and per-campaign period totals are the same two grains applied to the
 * same dimension; folding them into one enum would produce `day`,
 * `day_by_campaign`, `period`, `period_by_campaign` and then multiply again with
 * the next dimension.
 */
export type IntelligenceGrain =
  /** One fact per metric per calendar day. */
  | 'day'
  /** One fact per metric for the whole window. */
  | 'period';

/**
 * The named slices a fact can carry beyond its scope and subject.
 *
 * A closed union rather than open strings: dimensions are whitelisted by the
 * adapter, never accepted from the caller. Letting a caller name a dimension
 * would put its string somewhere near a query, and letting a caller name a
 * *value* is how a filter becomes an injection or a scope escape.
 *
 * `tenant`, `workspace` and `client` are absent on purpose — they are the scope,
 * and duplicating them into dimensions would create a second place a consumer
 * could read the client from, which is one place too many for something that
 * must never disagree.
 */
export type IntelligenceDimensionKey =
  /** Which provider produced the measurement (`meta`). */
  | 'provider'
  /** Paid or otherwise (`paid`). */
  | 'source'
  /** The calendar day, present on `day` grain only. */
  | 'date'
  /** The attribution configuration the measurement was reported under. */
  | 'attribution'
  /** The channel a conversation arrived on (`whatsapp`). */
  | 'channel_type';

export type IntelligenceDimensions = Partial<
  Record<IntelligenceDimensionKey, string>
>;

/**
 * One measurement.
 *
 * Long and narrow — `{ metricKey, value, dimensions }` — rather than a wide row
 * with a column per metric. The wide shape is more convenient for exactly one
 * consumer (the current dashboard) and wrong for every other: it makes the type
 * an inventory of whatever Ads happens to report, so adding a LeadFlow metric
 * widens a structure Social has to know about, and a domain with no `spend` has
 * to carry a `spend: null`. Narrow rows cost a `find` at read time and mean a new
 * metric is a new descriptor, touching nobody.
 *
 * `value` is a **string, or null**, and never a JS number. Money here is
 * `numeric(18,6)` in Postgres and counts run to `bigint`; both exceed what a
 * double represents exactly, and the drift shows up in the cents a client is
 * invoiced against. The decimal text is what the database returned and what the
 * consumer should format — arithmetic on it belongs in the owning domain's
 * exact-decimal helpers, not in the consumer.
 *
 * `null` means *not measurable*, which is a stronger and different claim than
 * zero. Reach over a multi-day window is null; a day with no delivery is `"0"`.
 */
export type IntelligenceFact = {
  metricKey: string;
  /** Exact decimal as text, or null when the honest answer is "unknown". */
  value: string | null;
  dimensions: IntelligenceDimensions;
};

/**
 * What a fact set says about how it knows what it knows.
 *
 * Modelled on the *form* of `LeadFlowAutomationContextSnapshot` — a verdict
 * travels with the record of what produced it — rather than on its values, whose
 * origins (`from_event`, `simulated_default`) describe a trigger evaluation and
 * mean nothing to an analytics read.
 */
export type IntelligenceProvenance = {
  /**
   * The canonical store this was read from, named as a table or projection.
   * Never a provider API: an adapter that answered from a live provider call
   * would be reporting something this system cannot reproduce.
   */
  canonicalSource: string;
  /**
   * The attribution configuration the numbers were measured under, where the
   * domain has one.
   *
   * Kept because dropping it is how two incompatible measurements get added
   * together: the same delivery reported under `account_default` and under a
   * 7-day window are two rows about one thing, and a fact set that did not say
   * which it held could be summed with the other.
   */
  attributionBasis: string | null;
  /**
   * How the underlying data got here — a sync, or a live read of a table the
   * platform writes transactionally.
   */
  ingestionMode: 'synced' | 'live';
  /**
   * Free-form, small, and diagnostic only.
   *
   * `syncRunIds` deliberately does *not* appear. A ninety-day window spans
   * dozens of runs plus every intraday convergence, and listing them would make
   * the provenance larger than the facts — for an identifier a consumer cannot
   * act on. The evidence a consumer can act on is `syncedAt` and `isPartial` in
   * freshness; run-level detail already has a purpose-built home in
   * `GET /social/analytics/freshness`, and this field carries a pointer to it
   * rather than a copy.
   */
  notes?: Record<string, string>;
};

/**
 * How current the fact set is, and how much of the window it actually covers.
 *
 * The two adapters answer this differently on purpose, and forcing them into one
 * story would require one of them to lie. Social reads a synced mirror that is
 * hours behind and may hold a partial day; LeadFlow reads tables the platform
 * itself wrote inside the transaction that made them true, so its `asOf` is the
 * query instant and `isPartial` is genuinely false. A shared `isStale` flag
 * would have to be invented for LeadFlow, and an invented staleness is worse
 * than none.
 */
export type IntelligenceFreshness = {
  /** ISO instant the underlying data was last known current. */
  asOf: string | null;
  /** True when at least one covered day is still being written to. */
  isPartial: boolean;
  /** `synced` mirrors a provider; `canonical` is the platform's own write path. */
  mode: 'synced' | 'canonical';
  coverage: IntelligenceCoverage;
};

/**
 * How much of the requested window the fact set can speak for.
 *
 * `coveredDays` counts days the domain can *account for*, not days that happen
 * to have rows. For paid media those differ in a way that matters: an ad account
 * that delivered nothing on a Sunday has no Meta row for Sunday, and counting
 * rows would report that day as missing — indistinguishable from a sync that
 * never ran. The Social adapter therefore derives coverage from how far its sync
 * has progressed (`latestMetricDate`), which is the same evidence
 * `GET /social/analytics/freshness` already reports, rather than from row counts.
 */
export type IntelligenceCoverage = {
  expectedDays: number;
  coveredDays: number;
  /**
   * How `coveredDays` was established, so a consumer knows what it means.
   *
   * `sync_progress` — days up to the latest synced day, delivery or not.
   * `canonical` — every requested day, because the source is written live and a
   * day with no rows is a day where nothing happened.
   */
  basis: 'sync_progress' | 'canonical';
};

/**
 * Everything one adapter answers with.
 *
 * Descriptors travel *with* the facts rather than being fetched separately,
 * because a fact whose additivity the consumer had to look up elsewhere is a
 * fact the consumer will eventually sum without looking.
 */
export type IntelligenceFactSet = {
  domain: IntelligenceDomain;
  subject: IntelligenceSubject;
  grain: IntelligenceGrain;
  window: { since: string; until: string };
  /** ISO 4217, where the domain reports money. Null where it does not. */
  currency: string | null;
  /**
   * The business mode this fact set was produced under, when the owning domain
   * can resolve one.
   *
   * Null is a first-class answer, not a gap: Social standalone has no LeadFlow
   * configuration to read a mode from, and a tenant using only Social must not
   * be blocked from reading its own ad spend because a field belonging to
   * another product is unset. It is a cohort label on the facts, never a fact.
   */
  businessMode: string | null;
  descriptors: IntelligenceMetricDescriptor[];
  facts: IntelligenceFact[];
  provenance: IntelligenceProvenance;
  freshness: IntelligenceFreshness;
};
