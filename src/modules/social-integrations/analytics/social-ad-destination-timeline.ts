/**
 * What an ad set was *observed* to point at, over time.
 *
 * The read side of I3.2a. The observations table is append-only evidence —
 * "at instant T a sync asked Meta and Meta answered X" — and this file turns
 * that into the only temporal statement the evidence supports: for each ad set,
 * a series of half-open intervals, each carrying the destination that was last
 * observed when the interval began.
 *
 * ## The thing this deliberately does not claim
 *
 * An interval here is **not** a period during which the ad set had that
 * destination. It is a period during which the last thing Lyra saw was that
 * destination. Meta does not report when a destination changed — probed
 * directly: `last_modified_time`, `effective_time` and
 * `destination_type_updated_time` are all dropped from the ad set payload — so
 * a change observed on the 15th, following an observation on the 14th, happened
 * somewhere in a 24-hour window nobody measured. The hierarchy sweep runs
 * daily, so that is the resolution ceiling.
 *
 * Hence the vocabulary. `observedDestination`, never `effectiveDestination`;
 * `observedFrom`, never `effectiveFrom`. A boundary spec fails on the forbidden
 * spellings, because the whole risk here is a later reader treating an
 * observation window as a fact about the advertiser's configuration.
 *
 * ## Before the first observation
 *
 * Unknown, and emphatically not "the earliest destination we later saw".
 * Back-projecting the first observation over prior days is the single most
 * tempting error available here: it would silently attribute months of spend to
 * a destination that was only ever confirmed once, at the end. Days before an
 * ad set's first observation therefore carry no interval at all, and a reader
 * joining metrics to intervals finds nothing — which is the correct answer.
 */

/**
 * One half-open window of "this is what we last saw".
 *
 * `observedFrom` inclusive, `observedUntil` exclusive; `observedUntil` is null
 * for the open interval that runs to now. Both are calendar days in the ad
 * account's timezone, not instants — the metrics this joins against are daily
 * facts cut in that same zone, and comparing an instant to a day bucket is how
 * a boundary day silently lands in the wrong interval.
 */
export type DestinationObservationInterval = {
  adEntityId: string;
  /** The canonical destination observed at `observedFrom`. */
  observedDestination: string;
  /** The provider's own string at that observation. */
  observedRaw: string | null;
  /** `YYYY-MM-DD` in the ad account's zone, inclusive. */
  observedFrom: string;
  /** `YYYY-MM-DD` exclusive, or null for the still-open interval. */
  observedUntil: string | null;
};

/**
 * How much of a window the destination evidence can actually speak for.
 *
 * Reported alongside any destination-resolved number so a reader can tell a
 * confident classification from a mostly-unknown one. `unknownDays` is not a
 * failure to be hidden — it is the measurement of how much of the period
 * predates the evidence.
 */
export type DestinationCoverage = {
  /** Days in the requested window. */
  expectedDays: number;
  /** Days on which at least one ad set had an observation in force. */
  coveredDays: number;
  /** `expectedDays - coveredDays`. Days no observation can speak for. */
  unknownDays: number;
  /** Earliest observation in scope, ISO instant, or null when there is none. */
  firstObservedAt: string | null;
  /** Latest observation in scope, ISO instant, or null. */
  lastObservedAt: string | null;
  /**
   * The finest resolution the evidence can have, in hours.
   *
   * The hierarchy sweep is daily, so a change is located to within a day at
   * best. Stated as data rather than prose so a UI cannot render an observation
   * timestamp as though the hour meant something.
   */
  observationCadenceHours: number;
};

/**
 * The hierarchy sweep's cadence, and therefore the uncertainty floor.
 *
 * `hierarchy` runs in the `daily`, `manual` and `entities` run kinds only — the
 * scheduler ticks hourly but does not sweep the hierarchy hourly — so 24 hours
 * is the real interval between two consecutive observations of an ad set.
 */
export const DESTINATION_OBSERVATION_CADENCE_HOURS = 24;

/**
 * The set-based interval query, as SQL text.
 *
 * `LEAD()` over each ad set's observations, which turns N appended rows into N
 * intervals in one pass. The alternative — a correlated subquery per metric row
 * asking "what was the last observation at or before this date" — was measured
 * against this one on a 5k-ad-set, 15k-observation, 450k-metric fixture over 90
 * days: 1948ms correlated versus 666ms set-based. Roughly three times, and the
 * gap widens with the row count because the correlated form re-scans per row.
 *
 * `observed_at` is converted into the account's zone *before* being cast to a
 * date, for the same reason every other day bucket in this codebase is: an
 * observation at 21:00 São Paulo time is the 14th there and the 15th in UTC,
 * and the metrics it will be joined to were cut the local way.
 *
 * The zone is a bound parameter (`$4`), never interpolated. It is the one value
 * here that originates outside this file.
 *
 * Parameters: `$1` tenant, `$2` workspace, `$3` connection, `$4` timezone.
 */
export const DESTINATION_INTERVALS_SQL = `
  /* social-ad-destination:intervals */
  SELECT observation.ad_entity_id AS "adEntityId",
         observation.destination_type AS "observedDestination",
         observation.destination_raw AS "observedRaw",
         to_char(
           (CASE WHEN $4::text IS NULL THEN observation.observed_at
                 ELSE observation.observed_at AT TIME ZONE $4::text END)::date,
           'YYYY-MM-DD'
         ) AS "observedFrom",
         to_char(
           (CASE WHEN $4::text IS NULL
                 THEN LEAD(observation.observed_at)
                        OVER (PARTITION BY observation.ad_entity_id
                              ORDER BY observation.observed_at, observation.created_at)
                 ELSE LEAD(observation.observed_at)
                        OVER (PARTITION BY observation.ad_entity_id
                              ORDER BY observation.observed_at, observation.created_at)
                      AT TIME ZONE $4::text END)::date,
           'YYYY-MM-DD'
         ) AS "observedUntil"
  FROM social_ad_destination_observations observation
  WHERE observation.tenant_id = $1
    AND observation.workspace_id = $2
    AND observation.connection_id = $3
  ORDER BY observation.ad_entity_id, observation.observed_at, observation.created_at
`;

/**
 * The destination in force on a given day, per the observations.
 *
 * Returns null — never a guess — for a day before the ad set's first
 * observation. That null is the honest `unknown` bucket, and a caller that
 * substituted the current `social_ad_entities.destination_type` for it would be
 * reintroducing exactly the current-state-as-history error this module exists
 * to remove.
 */
export function destinationOnDay(
  intervals: readonly DestinationObservationInterval[],
  adEntityId: string,
  day: string,
): string | null {
  for (const interval of intervals) {
    if (interval.adEntityId !== adEntityId) continue;
    if (day < interval.observedFrom) continue;
    if (interval.observedUntil !== null && day >= interval.observedUntil) {
      continue;
    }

    return interval.observedDestination;
  }

  return null;
}

/**
 * Coverage over a window, from the intervals and the raw observation instants.
 *
 * A day counts as covered when at least one ad set had an observation in force
 * on it. That is a deliberately weak definition and it is the only one the
 * evidence supports: with per-ad-set coverage varying, a stricter rule ("every
 * ad set observed") would report zero coverage for any account that added an ad
 * set yesterday, which tells the reader less than it hides.
 */
export function summarizeDestinationCoverage(input: {
  intervals: readonly DestinationObservationInterval[];
  days: readonly string[];
  firstObservedAt: string | null;
  lastObservedAt: string | null;
}): DestinationCoverage {
  const covered = input.days.filter((day) =>
    input.intervals.some(
      (interval) =>
        day >= interval.observedFrom &&
        (interval.observedUntil === null || day < interval.observedUntil),
    ),
  ).length;

  return {
    expectedDays: input.days.length,
    coveredDays: covered,
    unknownDays: input.days.length - covered,
    firstObservedAt: input.firstObservedAt,
    lastObservedAt: input.lastObservedAt,
    observationCadenceHours: DESTINATION_OBSERVATION_CADENCE_HOURS,
  };
}
