import type { SocialAdChange, SocialAdKpis } from '../analytics/social-ad-kpi';

/**
 * Which grain the returned `reach` was measured at.
 *
 * Reach is de-duplicated people, so it is the one metric that cannot be summed:
 * anybody who saw an ad on Monday and again on Tuesday is one person and two
 * daily rows. Adding them double-counts, and there is no local arithmetic that
 * undoes it — the de-duplication happened inside Meta, over identities this
 * system never sees.
 *
 * So the overview does not sum it, and this field says so out loud rather than
 * letting a caller assume. `daily` means "the stored per-day figures, which you
 * may not add". Returning a number with no grain attached is how a dashboard
 * ends up displaying the sum.
 *
 * Still only `daily`, even though Etapa 2B added a genuine period-level figure.
 * That measurement travels as `periodReach`, its own field, rather than as a
 * second value of this one — `reach` and `periodReach` are two different numbers
 * with two different provenances, and a granularity that switched between them
 * would make the meaning of `reach` depend on whether a cache happened to be
 * warm.
 */
export type SocialAdReachGranularity = 'daily';

/**
 * The additive totals of one period, plus the KPIs derived from them.
 *
 * Every numeric field is a decimal *string*, not a number. The columns behind
 * them are `numeric(18,6)` and `bigint`, both of which exceed what an IEEE-754
 * double represents exactly — a quarter of ad spend serialized through a JS
 * number comes back having drifted, and the count columns lose precision above
 * 2^53 outright. The string is what Postgres stores and what the client should
 * parse with its own decimal type.
 */
/**
 * How much of each thing exists, as opposed to how it performed.
 *
 * Counts of objects, not measurements of delivery, which is why they sit apart
 * from the totals rather than inside them. Two consequences follow from that
 * and both are load-bearing:
 *
 * `campaigns` and `ads` count what DELIVERED in the period — objects with at
 * least one fact row — not what exists in the account. An account with 72
 * mirrored campaigns of which 1 ran last week must report 1, because the
 * question the number answers is "what was running", and 72 next to a week's
 * spend invites the reader to divide one by the other.
 *
 * `boosts` is scoped the same way but sourced from `social_boost_requests`,
 * which is this platform's own record rather than Meta's, so it counts what
 * this product did rather than what the account contains.
 */
export type SocialAdInventoryCounts = {
  /** Campaigns with at least one fact row inside the period. */
  campaigns: string;
  /** Ads with at least one fact row inside the period. */
  ads: string;
  /** Boost requests created in the period by this platform. */
  boosts: string;
};

export type SocialAdAnalyticsTotals = SocialAdKpis & {
  spend: string;
  impressions: string;
  clicks: string;
  linkClicks: string;
  leads: string;
  conversions: string;
  conversionValue: string;
  videoViews: string;

  /**
   * Conversations started by ads in the period.
   *
   * **Never add this to `leads` or `conversions` above.** They overlap: on the
   * measured account eleven conversations sit against four leads, largely on
   * the same days, because for a messaging campaign a conversation and a lead
   * describe one person twice. Shown side by side and labelled, never totalled.
   *
   * Null when no day in the period carried a value, which after the backfill
   * means no data at all rather than a period of silence.
   */
  messagingConversations: string | null;

  /**
   * ThruPlays — watched to the end, or at least 15 seconds.
   *
   * Null when no day in the period reported it, which includes every period
   * before the field was requested. Distinct from `videoViews` (the 3-second
   * action) by roughly 5x on real campaigns, so the two are never substituted
   * for one another.
   */
  thruplays: string | null;

  /**
   * Average seconds watched per view, weighted by views across the period.
   *
   * Already the period's figure — a consumer must not average it again against
   * anything, and there is no total watch time to sum because Meta does not
   * report one here.
   */
  videoAvgWatchSeconds: string | null;

  /**
   * Null unless every contributing day reported it, and never a sum.
   *
   * Meta omits reach for some breakdowns entirely, and a `0` for "not reported"
   * is indistinguishable from a genuine zero-reach period.
   */
  reach: string | null;
  reachGranularity: SocialAdReachGranularity;

  /**
   * The reach of the whole period, de-duplicated by Meta — not a sum.
   *
   * The one number in this type that was not aggregated from
   * `social_ad_metrics_daily`. It comes from `social_ad_reach_periods`, a cache
   * of measurements taken by asking Meta for the range with no `time_increment`,
   * so the de-duplication happened where the identities are. A local sum of the
   * daily figures would be larger — up to the number of days larger — because
   * anybody reached on more than one day is counted once here and once per day
   * there.
   *
   * Null is the **expected** value on most deployments, and a consumer must
   * handle it as a first-class case rather than an error: measurement is gated
   * off by default (`SOCIAL_ADS_PERIOD_REACH_ENABLED`), and even when enabled a
   * custom range nobody has measured yet has no row. The UI shows "alcance do
   * período ainda não medido"; it never falls back to a sum.
   *
   * The comparison period carries this too, and it is null far more often: only
   * the presets are pre-measured, and the window immediately preceding a preset
   * is not one of them.
   */
  periodReach: string | null;

  /**
   * When `periodReach` was measured, as an ISO instant. Null whenever it is.
   *
   * Travels to the UI, which shows it in the tooltip. A reach figure with no
   * measurement time is a number nobody can reconcile against the Ads Manager
   * tab open beside it — and for a range that includes today it is the only
   * thing that says how much of today the number covers.
   */
  periodReachMeasuredAt: string | null;

  /**
   * Impressions per person reached, over the measured period.
   *
   * Null exactly when `periodReach` is: it is the denominator, and there is no
   * substitute for it here. Summed daily reach would count a person once per day
   * they were reached and deflate the ratio toward 1 — which is the reading a
   * frequency figure exists to contradict.
   *
   * A bare multiplier: `2.500000` means each reached person saw the ads two and
   * a half times. Above roughly 3 on a short window it is the usual sign of a
   * saturated audience.
   */
  frequency: string | null;

  /**
   * Cost per person reached, in the account's currency.
   *
   * Distinct from CPM, which divides by a thousand *impressions* and therefore
   * charges the same person again on every view. Null under the same rule as
   * `frequency`.
   */
  cpp: string | null;
};

/**
 * One conversion event of the catalog, over the period.
 *
 * Absent from `SocialAdAnalyticsTotals` on purpose, and travelling as its own
 * list rather than as more fields: these are read out of the stored `actions`
 * payload instead of from promoted columns, they are hidden by default, and the
 * set of them changes as the catalog grows. Folding them into the totals would
 * make a type that grows by a field every time a pixel event is catalogued, and
 * would put figures a client is *not* invoiced against beside the four that
 * they are.
 */
export type SocialAdConversionTotal = {
  /** The catalog id, not Meta's action type name. */
  id: string;
  label: string;
  group: string;
  /**
   * How many the period recorded, or null when no alias ever appeared.
   *
   * Null is the ordinary answer on an account with no pixel, and it is not the
   * same as `'0'`: an account that has never fired an event and one that fired
   * none in this period are different facts. Only the second is a measurement,
   * and a dashboard that renders the first as zero reports a missing
   * integration as a performance result.
   */
  count: string | null;
  /** Money, when the event carries any. Null for non-monetary events. */
  value: string | null;
  /** Spend over count. Null when count is null or zero, as every KPI is. */
  costPer: string | null;
  /**
   * Value over spend, for monetary events only.
   *
   * This is the per-event ROAS, and for `purchase` it is the "ROAS de compras
   * no site" the operator asked for. It is deliberately **not** the `roas` on
   * the totals: that one divides the whole `conversion_value` — every counted
   * family, leads and registrations included — by spend. On an account running
   * a shop and a lead form at once the two differ, and only this one answers
   * "what did the shop return".
   */
  roas: string | null;
  /**
   * Whether this codebase has ever observed the event on a real account.
   *
   * Travels to the UI so a number derived from Meta's documented alias names
   * rather than from measurement can be labelled as such. A missing alias
   * undercounts silently, and this is the flag that lets the interface say so
   * instead of presenting an unverified figure with the same confidence as
   * spend.
   */
  verified: boolean;
};

/**
 * One action type the account reported, over the period.
 *
 * A separate list from `conversions` above, and the distinction is the question
 * each answers. `conversions` is a fixed catalog of commerce events, each looked
 * up by name whether or not the account has them — the shape of a shop. This is
 * whatever the account *actually* reported, ranked, including types no catalog
 * knows. On the measured account `conversions` is empty and this holds 25 rows.
 *
 * Current period only, for the same reason `conversions` is: a type that starts
 * appearing mid-period is an integration change, not growth.
 */
export type SocialAdActionTypeTotal = {
  /** The canonical Meta type name, which is also the row's stable id. */
  type: string;
  /**
   * The pt-BR label, or the raw type name when this is a type no catalog knows.
   *
   * Never null: a table cell needs something to draw, and an unknown type shows
   * its own name so it can be looked up against Meta's documentation rather
   * than appearing as a blank row.
   */
  label: string;
  count: string;
  /**
   * Alias names folded into this row, so the collapse is visible.
   *
   * Meta reports one event under several names — `page_engagement` and
   * `post_engagement` both carried 1 036 on the measured account. The table
   * shows the canonical name once; without this field the other names would
   * simply be missing, and anyone querying the stored payload directly would
   * find types the dashboard denies. Empty when nothing was absorbed.
   */
  absorbed: readonly string[];
  /**
   * Whether a KPI card elsewhere already shows this same event.
   *
   * Leads and conversations appear here *and* as their own cards. That is not a
   * duplicate to be removed — an operator reading "all actions" expects them —
   * but the flag lets the interface mark them, so the row is not read as
   * additional to the card above it.
   */
  promoted: boolean;
  /** False when the type is not catalogued and is shown by its raw name. */
  known: boolean;
};

/** Period-over-period movement, one entry per additive metric. */
export type SocialAdAnalyticsChange = {
  spend: SocialAdChange;
  impressions: SocialAdChange;
  clicks: SocialAdChange;
  linkClicks: SocialAdChange;
  leads: SocialAdChange;
  conversions: SocialAdChange;
  conversionValue: SocialAdChange;
  videoViews: SocialAdChange;
};

export type SocialAdAnalyticsPeriodView = {
  since: string;
  until: string;
};

/**
 * The overview response.
 *
 * Built field by field from aggregates, never by spreading a row. Nothing here
 * carries a scope column, a connection credential, a provider payload or a
 * `sync_run_id`: the caller supplied the scope and must not be handed it back as
 * if it were data, and the rest is internal.
 */
export type SocialAdAnalyticsOverviewView = {
  connectionId: string;
  /** The zone whose calendar days the period was measured in. */
  timezone: string;
  /** Null when no contributing row carried one — an account with no spend. */
  currency: string | null;

  period: SocialAdAnalyticsPeriodView;
  comparisonPeriod: SocialAdAnalyticsPeriodView;

  current: SocialAdAnalyticsTotals;
  previous: SocialAdAnalyticsTotals;
  change: SocialAdAnalyticsChange;

  /** How many campaigns, ads and boosts the period contained. */
  counts: SocialAdInventoryCounts;

  /**
   * Catalogued conversion events the period recorded, current period only.
   *
   * Only events with at least one alias present appear — an account with no
   * pixel gets an empty array, which is the honest shape for "this business
   * does not have these". Listing all twenty with null counts would fill a
   * dashboard with rows that can never have a number.
   *
   * Current period only, with no comparison. A period-over-period change needs
   * both sides to mean the same thing, and an event that started firing
   * mid-period because a pixel was installed would report infinite growth in
   * what is actually an integration change.
   */
  conversions: SocialAdConversionTotal[];

  /**
   * Every action type the period recorded, ranked by count, aliases collapsed.
   *
   * Unranked by the caller and unlimited here on purpose: the response carries
   * all of them and the UI takes its top N. A limit applied in SQL would make
   * the list depend on a presentation choice, and the payload is one small row
   * per type — twenty-five on the measured account.
   */
  actionTypes: SocialAdActionTypeTotal[];

  /**
   * Whether any day inside the *current* period is still provisional.
   *
   * True when at least one contributing fact carries `is_partial`, which today
   * means the intraday pass wrote it for a day the account has not finished. It
   * is the flag that lets a report say "today, so far" instead of presenting an
   * accumulating total as final — and the reason a dashboard should not cache
   * this response past the account's midnight.
   *
   * Scoped to the current period on purpose: the comparison window is historical
   * and its partiality, if any, is a sync problem rather than a property of the
   * number being shown.
   */
  hasPartialData: boolean;

  /**
   * The most recent day the read model actually holds for this connection,
   * anywhere — not just inside the period.
   *
   * The answer to "why does this look low?", which is nearly always "the sync is
   * behind", not "spend fell". Null when the connection has no facts at all.
   */
  lastFactDate: string | null;
};
