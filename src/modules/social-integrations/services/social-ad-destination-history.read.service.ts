import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  DESTINATION_INTERVALS_SQL,
  summarizeDestinationCoverage,
  type DestinationCoverage,
  type DestinationObservationInterval,
} from '../analytics/social-ad-destination-timeline';
import { SocialAdDestinationObservationEntity } from '../entities/social-ad-destination-observation.entity';

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
}
