import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { QueryDeepPartialEntity } from 'typeorm/query-builder/QueryPartialEntity';
import type { SocialAdProvider } from '../entities/social-ad-account-connection.entity';
import {
  SocialAdEntity,
  type SocialAdEntityLevel,
} from '../entities/social-ad-entity.entity';
import type { NormalizedAdEntity } from '../sync/meta-ads-entity.contract';

/**
 * Where a batch of mirrored rows belongs.
 *
 * Taken from the resolved credential rather than from the caller — the same
 * reason `ResolvedAdCredential` carries its own scope. Two arguments that
 * "should" agree are how a batch ends up written under the scope of the
 * previous batch.
 */
export type SocialAdEntityWriteScope = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string | null;
  connectionId: string;
  provider: SocialAdProvider;
};

/**
 * Rows written per statement.
 *
 * Large enough that a ten-thousand-ad account costs fifty statements rather
 * than ten thousand, small enough to stay far below Postgres' parameter
 * ceiling: each row binds around twenty parameters, so a chunk is roughly four
 * thousand of the sixty-five thousand available.
 */
const CHUNK_SIZE = 200;

/**
 * Columns an upsert refreshes when the row already exists.
 *
 * The list is the interesting part of this file, and what is *absent* from it
 * matters more than what is present:
 *
 * - `first_seen_at` is missing on purpose. It answers "since when has Lyra
 *   known this object", and a sync that overwrote it would reset that answer to
 *   "today" on every run, permanently.
 * - the identity columns are missing because they are the conflict target: they
 *   are what matched, so writing them would be writing them to themselves.
 *
 * `archived_at` is here as the reappearance rule: every insert supplies NULL,
 * so an object that comes back from the provider is un-archived by the same
 * statement that refreshes it, with no second query and no window where it is
 * both present and archived.
 */
export const REFRESHED_COLUMNS = [
  'agency_client_id',
  'parent_external_id',
  'campaign_external_id',
  'name',
  'status',
  'effective_status',
  'objective',
  'optimization_goal',
  'billing_event',
  /**
   * Refreshed like any other provider attribute, and deliberately so.
   *
   * The absent-vs-null distinction is already settled before this list is
   * reached: an ad set that Meta answered without a `destination_type` produces
   * `unknown` plus a fresh `destination_observed_at`, not a NULL that would
   * quietly erase a previously known value on the next sync. And a level that
   * cannot carry a destination at all (account, campaign, ad) writes NULL on
   * every run, so refreshing it changes nothing.
   *
   * What this does mean is that an ad set repointed in Ads Manager has its
   * classification rewritten in place — which is correct for "where does this
   * ad set send people now" and is exactly the historical hazard documented on
   * the entity. `destination_observed_at` is refreshed alongside so a reader can
   * always tell how current the classification is.
   */
  'destination_type',
  'destination_raw',
  'destination_observed_at',
  'daily_budget_minor',
  'lifetime_budget_minor',
  'budget_remaining_minor',
  'currency',
  'start_time',
  'stop_time',
  'provider_created_time',
  'provider_updated_time',
  'metadata',
  'last_seen_at',
  'archived_at',
  'updated_at',
];

/** The unique identity of a mirrored object, and the ON CONFLICT target. */
export const IDENTITY_COLUMNS = [
  'tenant_id',
  'workspace_id',
  'connection_id',
  'entity_level',
  'external_id',
];

/**
 * Writes the mirrored hierarchy.
 *
 * The only component that touches `social_ad_entities`, and it does exactly two
 * things: upsert what a sync saw, and archive what it did not. Both are shaped
 * by the same fact — this is a mirror of someone else's data, so a write must
 * never be able to lose local history (`first_seen_at`) and a disappearance
 * must never be able to lose a name that historical spend still refers to.
 */
@Injectable()
export class SocialAdEntityWriterService {
  constructor(
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly entitiesRepository: Repository<SocialAdEntity>,
  ) {}

  /**
   * Upserts one level's rows on the unique identity.
   *
   * `seenAt` is supplied by the caller and is the same instant for every row of
   * the whole run. That is what makes the archive step below exact: a row this
   * run touched has `last_seen_at = seenAt`, a row it did not has something
   * strictly earlier, and the two sets never overlap regardless of how long the
   * run took or how many objects it walked.
   */
  async upsert(input: {
    scope: SocialAdEntityWriteScope;
    rows: readonly NormalizedAdEntity[];
    seenAt: Date;
  }): Promise<number> {
    if (!input.rows.length) return 0;

    let written = 0;

    for (let index = 0; index < input.rows.length; index += CHUNK_SIZE) {
      const chunk = input.rows.slice(index, index + CHUNK_SIZE);

      await this.entitiesRepository
        .createQueryBuilder()
        .insert()
        .into(SocialAdEntity)
        .values(
          chunk.map((row) => ({
            tenantId: input.scope.tenantId,
            workspaceId: input.scope.workspaceId,
            agencyClientId: input.scope.agencyClientId,
            connectionId: input.scope.connectionId,
            provider: input.scope.provider,
            entityLevel: row.entityLevel,
            externalId: row.externalId,
            parentExternalId: row.parentExternalId,
            campaignExternalId: row.campaignExternalId,
            name: row.name,
            status: row.status,
            effectiveStatus: row.effectiveStatus,
            objective: row.objective,
            optimizationGoal: row.optimizationGoal,
            billingEvent: row.billingEvent,
            destinationType: row.destinationType,
            destinationRaw: row.destinationRaw,
            destinationObservedAt: row.destinationObservedAt,
            dailyBudgetMinor: row.dailyBudgetMinor,
            lifetimeBudgetMinor: row.lifetimeBudgetMinor,
            budgetRemainingMinor: row.budgetRemainingMinor,
            currency: row.currency,
            startTime: row.startTime,
            stopTime: row.stopTime,
            providerCreatedTime: row.providerCreatedTime,
            providerUpdatedTime: row.providerUpdatedTime,
            metadata: row.metadata,
            firstSeenAt: input.seenAt,
            lastSeenAt: input.seenAt,
            // Supplied so the conflict branch can copy it: this is what makes a
            // returning object stop being archived.
            archivedAt: null,
            // `raw` is deliberately left unwritten. Storing the payload of
            // every object on every sync grows without bound, and this slice
            // implements no retention — whoever needs it owns the sweep.
          })) as QueryDeepPartialEntity<SocialAdEntity>[],
        )
        .orUpdate(REFRESHED_COLUMNS, IDENTITY_COLUMNS)
        // Without this TypeORM tries to reconcile the returned rows back onto
        // the value objects, which on a bulk upsert costs more than the write.
        .updateEntity(false)
        .execute();

      written += chunk.length;
    }

    return written;
  }

  /**
   * Internal ids for the ad sets this run just wrote, by provider id.
   *
   * A separate read rather than a `RETURNING` clause on the upsert: that path
   * is a bulk write with `updateEntity(false)` precisely so TypeORM does not
   * reconcile rows back onto objects, and turning it into a returning query
   * would slow every sync to serve a caller that only sometimes needs the ids.
   * This is one indexed lookup on the identity index instead.
   *
   * Scoped by connection because the same external id under a different
   * connection is a different object — potentially a different Business
   * entirely.
   */
  async adSetIdsByExternalId(input: {
    scope: SocialAdEntityWriteScope;
    externalIds: readonly string[];
  }): Promise<ReadonlyMap<string, string>> {
    if (!input.externalIds.length) return new Map();

    const rows = await this.entitiesRepository
      .createQueryBuilder('entity')
      .select('entity.id', 'id')
      .addSelect('entity.external_id', 'externalId')
      .where('entity.tenant_id = :tenantId', { tenantId: input.scope.tenantId })
      .andWhere('entity.workspace_id = :workspaceId', {
        workspaceId: input.scope.workspaceId,
      })
      .andWhere('entity.connection_id = :connectionId', {
        connectionId: input.scope.connectionId,
      })
      .andWhere("entity.entity_level = 'adset'")
      .andWhere('entity.external_id IN (:...externalIds)', {
        externalIds: [...input.externalIds],
      })
      .getRawMany<{ id: string; externalId: string }>();

    return new Map(rows.map((row) => [row.externalId, row.id]));
  }

  /**
   * Archives the rows of one level that this sync did not see.
   *
   * **Only ever called after a complete snapshot of that level.** Absence is
   * evidence of deletion only when the read is known to have seen everything:
   * after a failed page, a rate limit or a truncated walk, the same query would
   * archive every object the reader simply never reached — which for a mirror
   * means the ad hierarchy quietly emptying itself because Meta was busy.
   *
   * Archiving, never deleting. Historical metrics reference these rows for
   * their names, and a delete would turn last quarter's report into a list of
   * numeric ids.
   */
  async archiveMissing(input: {
    scope: SocialAdEntityWriteScope;
    entityLevel: SocialAdEntityLevel;
    seenAt: Date;
  }): Promise<number> {
    const result = await this.entitiesRepository
      .createQueryBuilder()
      .update(SocialAdEntity)
      .set({ archivedAt: () => 'now()' })
      .where('"tenant_id" = :tenantId', { tenantId: input.scope.tenantId })
      .andWhere('"workspace_id" = :workspaceId', {
        workspaceId: input.scope.workspaceId,
      })
      .andWhere('"connection_id" = :connectionId', {
        connectionId: input.scope.connectionId,
      })
      .andWhere('"entity_level" = :entityLevel', {
        entityLevel: input.entityLevel,
      })
      // Already archived rows are left alone, so `archived_at` keeps saying
      // when the object actually disappeared rather than when the most recent
      // sync noticed it was still gone.
      .andWhere('"archived_at" IS NULL')
      .andWhere('"last_seen_at" < :seenAt', { seenAt: input.seenAt })
      .execute();

    return result.affected ?? 0;
  }
}
