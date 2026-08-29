import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { SocialAdDestinationObservationEntity } from '../entities/social-ad-destination-observation.entity';
import type { SocialAdEntityWriteScope } from './social-ad-entity-writer.service';

/**
 * One ad set as this sync saw it, already resolved by the shared resolver.
 *
 * `destinationType` is never absent: the resolver always produces a canonical
 * value, `unknown` included. What decides whether an observation is *recorded*
 * is `hasEvidence` below, not the value.
 */
export type ObservedAdSetDestination = {
  /** `social_ad_entities.id`, resolved after the upsert. */
  adEntityId: string;
  destinationType: string;
  destinationRaw: string | null;
  /**
   * Whether the provider actually answered about this ad set.
   *
   * The distinction section 9 of the brief turns on. Meta explicitly returning
   * `UNDEFINED` is evidence — the advertiser configured no destination, and
   * that is a real, observable state worth recording. Meta simply *not sending*
   * the field is the absence of evidence, and recording it would manufacture a
   * transition to `unknown` out of provider silence: a temporarily degraded
   * response would close a known period and make an ad set look like it stopped
   * pointing anywhere.
   *
   * So `false` means "do not append", not "append unknown".
   */
  hasEvidence: boolean;
};

export type RecordDestinationObservationsInput = {
  scope: SocialAdEntityWriteScope;
  observations: readonly ObservedAdSetDestination[];
  observedAt: Date;
  /** The run that made these observations, when the sweep came from the queue. */
  syncRunId: string | null;
};

/**
 * Appends destination evidence, and only when there is something new to say.
 *
 * The rule is "first observation, and every observed change" — not one row per
 * sync. The hierarchy sweep runs daily per connection, so recording
 * unconditionally would add 126 rows a day for an account whose destinations
 * almost never move: within a year the table would hold tens of thousands of
 * rows that all say the same thing, and the temporal query would pay for it on
 * every read. Recording only differences keeps a full year of an ad set's
 * history at a handful of rows.
 *
 * What is deliberately *not* here is any notion of when the provider changed
 * the value. This service can only ever prove that two consecutive observations
 * differed; locating the change inside that window is not something the
 * Marketing API supports.
 */
@Injectable()
export class SocialAdDestinationObserverService {
  constructor(
    @InjectRepository(SocialAdDestinationObservationEntity, 'agency')
    private readonly observations: Repository<SocialAdDestinationObservationEntity>,
  ) {}

  /**
   * Records the observations that differ from what was last seen.
   *
   * Returns how many rows were appended, which the sync summary reports.
   */
  async record(input: RecordDestinationObservationsInput): Promise<number> {
    const candidates = input.observations.filter(
      (observation) => observation.hasEvidence,
    );

    if (!candidates.length) return 0;

    const latest = await this.latestByEntity(
      candidates.map((observation) => observation.adEntityId),
    );

    const rows = candidates.filter((observation) => {
      const previous = latest.get(observation.adEntityId);

      // No history yet: this is the first destination Lyra ever observed for
      // the ad set. It is emphatically not a claim that the ad set always had
      // it — everything before this instant stays unknown.
      if (!previous) return true;

      /**
       * A change is a change in either half.
       *
       * `destination_raw` is compared as well as the canonical value because a
       * new Meta enum that this build maps to `unknown` is still a real
       * provider change: comparing canonical alone would silently swallow the
       * move from one unmapped value to another, which is exactly the evidence
       * a future corrected mapping would need.
       */
      return (
        previous.destinationType !== observation.destinationType ||
        previous.destinationRaw !== observation.destinationRaw
      );
    });

    if (!rows.length) return 0;

    const result = await this.observations
      .createQueryBuilder()
      .insert()
      .into(SocialAdDestinationObservationEntity)
      .values(
        rows.map((observation) => ({
          tenantId: input.scope.tenantId,
          workspaceId: input.scope.workspaceId,
          agencyClientId: input.scope.agencyClientId,
          connectionId: input.scope.connectionId,
          adEntityId: observation.adEntityId,
          provider: input.scope.provider,
          destinationType: observation.destinationType,
          destinationRaw: observation.destinationRaw,
          observedAt: input.observedAt,
          syncRunId: input.syncRunId,
        })),
      )
      /**
       * The idempotency guard, in the database rather than in the read above.
       *
       * The read-then-write between `latestByEntity` and this insert is not
       * atomic, and two workers retrying the same run would both decide to
       * append. `DO NOTHING` on the run-scoped unique index makes the second
       * one a no-op instead of a duplicate — which is why the constraint is
       * keyed on the run and not on the destination: keying it on
       * `(entity, destination)` would also reject a legitimate return to a
       * previous destination.
       */
      .orIgnore()
      .execute();

    // `identifiers` reflects what the database actually accepted, so a row the
    // conflict clause dropped is not counted as written.
    return result.identifiers.filter(Boolean).length;
  }

  /**
   * The most recent observation for each of these ad sets.
   *
   * `DISTINCT ON` rather than a window function or one query per entity: it is
   * a single index scan over `(ad_entity_id, observed_at)` and returns exactly
   * one row per ad set.
   */
  private async latestByEntity(
    adEntityIds: readonly string[],
  ): Promise<
    Map<string, { destinationType: string; destinationRaw: string | null }>
  > {
    if (!adEntityIds.length) return new Map();

    const rows = await this.observations
      .createQueryBuilder('observation')
      .select(
        'DISTINCT ON (observation.ad_entity_id) observation.ad_entity_id',
        'adEntityId',
      )
      .addSelect('observation.destination_type', 'destinationType')
      .addSelect('observation.destination_raw', 'destinationRaw')
      .where('observation.ad_entity_id IN (:...adEntityIds)', { adEntityIds })
      .orderBy('observation.ad_entity_id')
      .addOrderBy('observation.observed_at', 'DESC')
      .addOrderBy('observation.created_at', 'DESC')
      .getRawMany<{
        adEntityId: string;
        destinationType: string;
        destinationRaw: string | null;
      }>();

    return new Map(
      rows.map((row) => [
        row.adEntityId,
        {
          destinationType: row.destinationType,
          destinationRaw: row.destinationRaw,
        },
      ]),
    );
  }
}
