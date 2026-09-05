import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DESTINATION_UNAVAILABLE,
  type SocialAdDestinationAt,
} from '../analytics/social-ad-destination-at';
import {
  DESTINATION_INTERVALS_SQL,
  summarizeDestinationCoverage,
  type DestinationCoverage,
  type DestinationObservationInterval,
} from '../analytics/social-ad-destination-timeline';
import { SocialAdDestinationObservationEntity } from '../entities/social-ad-destination-observation.entity';
import type { CanonicalPaidMediaDestination } from '../sync/paid-media-destination';

export type DestinationHistoryQuery = {
  tenantId: string;
  workspaceId: string;
  connectionId: string;
  /** The ad account's IANA zone, whose calendar days the intervals are cut in. */
  timezone: string | null;
  /** Every day of the requested window, `YYYY-MM-DD`, in that same zone. */
  days: readonly string[];
};

export type DestinationHistory = {
  intervals: DestinationObservationInterval[];
  coverage: DestinationCoverage;
};

/**
 * Reads destination evidence, and nothing else.
 *
 * Separate from `SocialAnalyticsReadService` on purpose. That service is the
 * one place four rules live — `entity_level = 'account'`, `source = 'paid'`,
 * `attribution_setting = 'account_default'`, reach is never summed — and every
 * method on it is a metrics read governed by them. Destination history is
 * governed by a different and incompatible rule: it is per **ad set**, it has
 * no attribution setting, and it is evidence about configuration rather than a
 * measurement of delivery. Adding it there would put a method on that class
 * that must *not* apply its rules, which is how the rules eventually get
 * applied to the wrong thing.
 *
 * No Graph service, no credential resolver, no token — the same boundary the
 * rest of the analytics read path holds, asserted by a boundary spec. Scope is
 * bound on every query and there is no parameter a caller could use to widen
 * it.
 */
@Injectable()
export class SocialAdDestinationHistoryReadService {
  constructor(
    @InjectRepository(SocialAdDestinationObservationEntity, 'agency')
    private readonly observations: Repository<SocialAdDestinationObservationEntity>,
  ) {}

  /**
   * The observation intervals for one connection, plus what they cover.
   *
   * Every observation for the connection is read, not just those inside the
   * window, and that is required rather than wasteful: the destination in force
   * on the first day of the window was established by an observation made
   * *before* it, and a window-filtered read would lose exactly that row and
   * report the period as unknown until the next sweep.
   *
   * The volume this costs is small by construction — the observer appends only
   * first sightings and observed changes, so an account whose destinations never
   * move holds one row per ad set forever.
   */
  async history(query: DestinationHistoryQuery): Promise<DestinationHistory> {
    const intervals = await this.observations.query<
      DestinationObservationInterval[]
    >(DESTINATION_INTERVALS_SQL, [
      query.tenantId,
      query.workspaceId,
      query.connectionId,
      query.timezone,
    ]);

    const bounds = await this.observationBounds(query);

    return {
      intervals,
      coverage: summarizeDestinationCoverage({
        intervals,
        days: query.days,
        firstObservedAt: bounds.first,
        lastObservedAt: bounds.last,
      }),
    };
  }

  /**
   * The first and last observation instants in scope.
   *
   * Reported as instants rather than days because they are provenance — when
   * the evidence starts and how stale it is — and truncating them to a day
   * would lose the staleness. The uncertainty they should be *read* with is
   * carried separately, as `observationCadenceHours`, so a consumer cannot
   * mistake a precise instant for a precise change time.
   */
  private async observationBounds(
    query: DestinationHistoryQuery,
  ): Promise<{ first: string | null; last: string | null }> {
    const rows = await this.observations.query<
      Array<{ first: Date | null; last: Date | null }>
    >(
      `
        /* social-ad-destination:observation-bounds */
        SELECT MIN(observation.observed_at) AS "first",
               MAX(observation.observed_at) AS "last"
        FROM social_ad_destination_observations observation
        WHERE observation.tenant_id = $1
          AND observation.workspace_id = $2
          AND observation.connection_id = $3
      `,
      [query.tenantId, query.workspaceId, query.connectionId],
    );

    const row = rows[0];

    return {
      first: row?.first ? new Date(row.first).toISOString() : null,
      last: row?.last ? new Date(row.last).toISOString() : null,
    };
  }

  /**
   * One ad set's destination as of each of several instants.
   *
   * The individual-attribution counterpart to `history()`, and deliberately a
   * different method rather than a parameter on it: that one cuts the
   * connection's whole timeline into the ad account's calendar days for a
   * period report, and this one must not truncate to a day at all. A message
   * that arrived at 09:00 and an ad set observed at 21:00 are the same calendar
   * day, and a day-grained answer would attribute the evening's destination to
   * the morning's conversation.
   *
   * Batched over the instants because a conversation can carry several
   * observations — a contact who clicks the same ad twice, weeks apart — and
   * asking per instant would issue one round trip each to answer a question
   * about one ad set.
   *
   * Scope is bound to the ad set's internal id, which already encodes tenant,
   * workspace, client and connection: `ad_entity_id` references the very row
   * the hierarchy lookup resolved under all four filters, so an observation
   * from another connection cannot be reached even if it shares an external id.
   * The explicit tenant and workspace predicates stay anyway — defence in depth
   * on a table whose rows decide what an ad is credited with.
   */
  async destinationAt(query: {
    tenantId: string;
    workspaceId: string;
    /** `social_ad_entities.id` of the ad set, from the hierarchy lookup. */
    adEntityId: string;
    /** ISO instants to resolve, in any order. */
    instants: readonly string[];
  }): Promise<Map<string, SocialAdDestinationAt>> {
    const resolved = new Map<string, SocialAdDestinationAt>();
    if (!query.instants.length) return resolved;

    // De-duplicated: two observations of the same ad at the same instant is one
    // question, and asking it twice would return the same row twice.
    const instants = [...new Set(query.instants)];

    const rows = await this.observations.query<DestinationAtRow[]>(
      DESTINATION_AT_SQL,
      [query.tenantId, query.workspaceId, query.adEntityId, instants],
    );

    for (const row of rows) {
      // Keyed by the caller's own string via the ordinal, never by the
      // timestamp Postgres echoes back: `2026-09-01T10:00:00.000Z` returns as
      // `2026-09-01 10:00:00+00`, so matching on the text would miss every row.
      const asked = instants[Number(row.ordinal) - 1];
      if (asked === undefined) continue;

      resolved.set(asked, {
        value: row.destination_type as CanonicalPaidMediaDestination,
        resolution: 'observed_destination',
        observedAt: new Date(row.observed_at).toISOString(),
        raw: row.destination_raw,
      });
    }

    // Every instant with no preceding observation gets the explicit
    // unavailable answer rather than being absent from the map, so a caller
    // cannot mistake "not asked" for "nothing found".
    for (const instant of instants) {
      if (!resolved.has(instant)) {
        resolved.set(instant, DESTINATION_UNAVAILABLE);
      }
    }

    return resolved;
  }

  /**
   * The same point-in-time question, asked for many ad sets at once.
   *
   * ## Why this exists rather than a loop over `destinationAt`
   *
   * I4.3 resolves destinations for a whole cohort, and the individual method is
   * keyed to one ad set. Calling it per ad set is one round trip each — with a
   * couple of hundred ad sets in a quarter's cohort that is a couple of hundred
   * sequential queries, and the shape gets worse exactly as an account grows.
   * §30 rules it out by name.
   *
   * The pairs are unnested as two parallel arrays rather than a composite type
   * so the planner sees ordinary `uuid[]` and `timestamptz[]` parameters, and
   * the lateral probe below is the identical shape `destinationAt` uses —
   * `IDX_social_ad_destination_obs_entity` serves both, driving from the small
   * side (the asked pairs) into the ad set's history.
   *
   * ## Why the answer is keyed by pair and not by ad set
   *
   * Two conversations on the same ad set with different instants can legitimately
   * resolve to different destinations — that is the whole temporal point. A map
   * keyed by ad set would have to pick one of them, which is the collapse I4.1
   * exists to prevent.
   */
  async destinationAtMany(query: {
    tenantId: string;
    workspaceId: string;
    /** `(social_ad_entities.id, ISO instant)` pairs, in any order. */
    pairs: readonly { adEntityId: string; instant: string }[];
  }): Promise<Map<string, SocialAdDestinationAt>> {
    const resolved = new Map<string, SocialAdDestinationAt>();
    if (!query.pairs.length) return resolved;

    // De-duplicated across the whole cohort, not per ad set: a hundred
    // conversations that clicked the same ad at the same second is one question.
    const seen = new Map<string, { adEntityId: string; instant: string }>();
    for (const pair of query.pairs) {
      seen.set(destinationPairKey(pair.adEntityId, pair.instant), pair);
    }

    const pairs = [...seen.values()];

    const rows = await this.observations.query<DestinationPairRow[]>(
      DESTINATION_AT_MANY_SQL,
      [
        query.tenantId,
        query.workspaceId,
        pairs.map((pair) => pair.adEntityId),
        pairs.map((pair) => pair.instant),
      ],
    );

    for (const row of rows) {
      // Keyed back through the ordinal for the reason `destinationAt` uses one:
      // Postgres echoes `2026-09-01T10:00:00.000Z` as `2026-09-01 10:00:00+00`,
      // so matching the returned timestamp as text would miss every row.
      const asked = pairs[Number(row.ordinal) - 1];
      if (asked === undefined) continue;

      resolved.set(destinationPairKey(asked.adEntityId, asked.instant), {
        value: row.destination_type as CanonicalPaidMediaDestination,
        resolution: 'observed_destination',
        observedAt: new Date(row.observed_at).toISOString(),
        raw: row.destination_raw,
      });
    }

    // Explicit unavailable rather than absence, identically to `destinationAt`:
    // a caller must never have to tell "nothing found" from "never asked".
    for (const pair of pairs) {
      const key = destinationPairKey(pair.adEntityId, pair.instant);
      if (!resolved.has(key)) resolved.set(key, DESTINATION_UNAVAILABLE);
    }

    return resolved;
  }
}

/**
 * The key both the batch method and its callers use.
 *
 * Exported so a consumer cannot invent a second encoding: a projector that
 * built `${id}${instant}` while this built `${id}|${instant}` would silently
 * miss every lookup and report a fully-observed cohort as unavailable.
 */
export function destinationPairKey(
  adEntityId: string,
  instant: string,
): string {
  return `${adEntityId}|${instant}`;
}

/** One resolved instant as Postgres returns it. */
type DestinationAtRow = {
  /** 1-based position in the instants array, used to key back to the input. */
  ordinal: string;
  destination_type: string;
  destination_raw: string | null;
  observed_at: Date | string;
};

/** One resolved `(ad set, instant)` pair. */
type DestinationPairRow = DestinationAtRow;

/**
 * The last observation at or before each requested instant.
 *
 * `LEFT JOIN LATERAL` over the unnested instants rather than a window function:
 * the set of instants is tiny (one conversation's observations) while the ad
 * set's observation history can be long, so this drives from the small side and
 * uses `IDX_social_ad_destination_obs_entity` for each probe. The same shape
 * measured ~3× faster than a correlated subquery in I3.2a.
 *
 * `<=` and not `<`: an observation made at the very instant the message arrived
 * describes that message's ad set. The boundary is inclusive and a test pins
 * it, because flipping it is a silent one-character change that only shows up
 * on exact-equality data.
 *
 * The tie-break on `created_at DESC` matters when a sync writes two rows with
 * the same `observed_at` — the later-written row is the later answer.
 */
const DESTINATION_AT_SQL = `
  /* social-ad-destination:at-instant */
  SELECT asked.ordinal::text AS "ordinal",
         resolved.destination_type AS "destination_type",
         resolved.destination_raw AS "destination_raw",
         resolved.observed_at AS "observed_at"
  FROM unnest($4::timestamptz[]) WITH ORDINALITY AS asked(instant, ordinal)
  JOIN LATERAL (
    SELECT observation.destination_type,
           observation.destination_raw,
           observation.observed_at
    FROM social_ad_destination_observations observation
    WHERE observation.tenant_id = $1
      AND observation.workspace_id = $2
      AND observation.ad_entity_id = $3
      AND observation.observed_at <= asked.instant
    ORDER BY observation.observed_at DESC, observation.created_at DESC
    LIMIT 1
  ) resolved ON TRUE
`;

/**
 * The last observation at or before each `(ad set, instant)` pair.
 *
 * Structurally identical to `DESTINATION_AT_SQL` — the same `<=` boundary, the
 * same `observed_at DESC, created_at DESC` tie-break, the same lateral probe —
 * and that identity is the point: the batch and the single lookup must not be
 * able to answer the same question differently. The only difference is that the
 * ad set comes from the unnested pair instead of a scalar parameter, so the
 * scope predicate binds tenant and workspace and the pair supplies the entity.
 *
 * `unnest(a, b)` walks two arrays in lockstep, which is what makes the ordinal
 * a valid key back into the caller's own pair list.
 *
 * The tenant and workspace filters stay even though `ad_entity_id` already
 * encodes them through the row the hierarchy walk resolved: this table decides
 * what an ad is credited with, and defence in depth on it is cheap.
 */
const DESTINATION_AT_MANY_SQL = `
  /* social-ad-destination:at-instant-many */
  SELECT asked.ordinal::text AS "ordinal",
         resolved.destination_type AS "destination_type",
         resolved.destination_raw AS "destination_raw",
         resolved.observed_at AS "observed_at"
  FROM unnest($3::uuid[], $4::timestamptz[])
       WITH ORDINALITY AS asked(ad_entity_id, instant, ordinal)
  JOIN LATERAL (
    SELECT observation.destination_type,
           observation.destination_raw,
           observation.observed_at
    FROM social_ad_destination_observations observation
    WHERE observation.tenant_id = $1
      AND observation.workspace_id = $2
      AND observation.ad_entity_id = asked.ad_entity_id
      AND observation.observed_at <= asked.instant
    ORDER BY observation.observed_at DESC, observation.created_at DESC
    LIMIT 1
  ) resolved ON TRUE
`;
