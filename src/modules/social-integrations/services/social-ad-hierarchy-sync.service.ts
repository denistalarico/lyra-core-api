import { Injectable, Logger } from '@nestjs/common';
import {
  SocialAdCredentialResolver,
  type SocialAdCredentialScope,
} from '../credentials/social-ad-credential.resolver';
import type { SocialAdEntityLevel } from '../entities/social-ad-entity.entity';
import type {
  NormalizedAdEntity,
  NormalizedAdEntityPage,
} from '../sync/meta-ads-entity.contract';
import { MetaAdsEntityReaderService } from './meta-ads-entity-reader.service';
import {
  SocialAdEntityWriterService,
  type SocialAdEntityWriteScope,
} from './social-ad-entity-writer.service';

export type SyncAdHierarchyInput = SocialAdCredentialScope & {
  connectionId: string;
};

/** What one level of the hierarchy did during a sync. */
export type SocialAdHierarchyLevelSummary = {
  level: SocialAdEntityLevel;
  /** Objects the provider returned and this pipeline could key. */
  read: number;
  written: number;
  archived: number;
  /** Rows dropped for having no usable id. Normally zero. */
  skipped: number;
  /** The read hit the page ceiling, so stale archiving was skipped. */
  truncated: boolean;
};

/**
 * The result of a manual sync — everything a caller may see.
 *
 * Built by hand rather than by spreading anything: no credential, no payload,
 * no provider error text. `ResolvedAdCredential` already hides its token from
 * every serializer, but a summary assembled field by field cannot leak one even
 * if that changes.
 */
export type SocialAdHierarchySyncSummary = {
  connectionId: string;
  provider: string;
  externalAccountId: string;
  levels: SocialAdHierarchyLevelSummary[];
  accountCount: number;
  campaignsCount: number;
  adsetsCount: number;
  adsCount: number;
  entitiesWritten: number;
  entitiesArchived: number;
  /**
   * True when at least one level was truncated. The mirror is usable, but it is
   * not a complete snapshot and nothing was archived at that level.
   */
  partial: boolean;
  startedAt: string;
  finishedAt: string;
  durationMs: number;
};

/**
 * Manual, synchronous sync of the Meta ad hierarchy into `social_ad_entities`.
 *
 * Synchronous on purpose. `social_ad_sync_runs` exists and this service does not
 * touch it: the queue's value is retries, backoff and a worker that survives a
 * restart, none of which exist yet, and enqueueing into a table nothing drains
 * would turn "sync now" into a button that silently does nothing. Until S2.5
 * builds the worker, the honest shape is a request that either returns a
 * summary or returns an error.
 *
 * The pipeline is deliberately ignorant of how the connection was authorized.
 * It asks `SocialAdCredentialResolver` for a credential and reads Meta with it;
 * whether the token came from an encrypted column or from server configuration
 * is settled in that one place and is invisible here.
 */
@Injectable()
export class SocialAdHierarchySyncService {
  private readonly logger = new Logger(SocialAdHierarchySyncService.name);

  constructor(
    private readonly credentialResolver: SocialAdCredentialResolver,
    private readonly reader: MetaAdsEntityReaderService,
    private readonly writer: SocialAdEntityWriterService,
  ) {}

  async syncHierarchy(
    input: SyncAdHierarchyInput,
  ): Promise<SocialAdHierarchySyncSummary> {
    const startedAt = new Date();

    // Scope is part of the lookup, not a check afterwards: a connection from
    // another tenant, workspace or managed client is simply not found here, and
    // the caller never learns whether the id exists.
    const credential = await this.credentialResolver.resolve(input);

    // Written from the resolved row, not from the request. They are equal by
    // construction, and taking the stored truth is what keeps a future queued
    // caller from writing rows under a scope it merely claimed.
    const scope: SocialAdEntityWriteScope = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      connectionId: credential.connectionId,
      provider: credential.provider,
    };

    /**
     * One instant for the entire run.
     *
     * Every row written gets `last_seen_at = seenAt`, so "not seen by this run"
     * is exactly `last_seen_at < seenAt` — no clock skew between levels, no
     * dependence on how long the walk took, and no second query to enumerate
     * what was seen.
     */
    const seenAt = new Date();
    const levels: SocialAdHierarchyLevelSummary[] = [];

    const account = await this.reader.readAccount(credential);
    const accountRows = account ? [account] : [];

    levels.push(
      await this.persistLevel({
        scope,
        seenAt,
        level: 'account',
        page: { rows: accountRows, truncated: false, skipped: 0 },
      }),
    );

    // The account's own currency denominates every budget below it, and Meta
    // only reports it on the account node.
    const currency = account?.currency ?? credential.currency;

    const campaigns = await this.reader.readCampaigns(credential, { currency });
    levels.push(
      await this.persistLevel({
        scope,
        seenAt,
        level: 'campaign',
        page: campaigns,
      }),
    );

    const adSets = await this.reader.readAdSets(credential, { currency });
    levels.push(
      await this.persistLevel({ scope, seenAt, level: 'adset', page: adSets }),
    );

    const ads = await this.reader.readAds(credential, {
      currency,
      campaignByAdSetId: MetaAdsEntityReaderService.campaignByAdSetId(
        adSets.rows,
      ),
    });
    levels.push(
      await this.persistLevel({ scope, seenAt, level: 'ad', page: ads }),
    );

    const finishedAt = new Date();
    const summary: SocialAdHierarchySyncSummary = {
      connectionId: credential.connectionId,
      provider: credential.provider,
      externalAccountId: credential.externalAccountId,
      levels,
      accountCount: this.countOf(levels, 'account'),
      campaignsCount: this.countOf(levels, 'campaign'),
      adsetsCount: this.countOf(levels, 'adset'),
      adsCount: this.countOf(levels, 'ad'),
      entitiesWritten: levels.reduce((total, row) => total + row.written, 0),
      entitiesArchived: levels.reduce((total, row) => total + row.archived, 0),
      partial: levels.some((level) => level.truncated),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };

    // The summary is the log line: it is the object that was built to be safe
    // to show, so there is nothing here that a response would not also carry.
    this.logger.log(
      `Meta Ads hierarchy synced: ${JSON.stringify({
        connectionId: summary.connectionId,
        entitiesWritten: summary.entitiesWritten,
        entitiesArchived: summary.entitiesArchived,
        partial: summary.partial,
        durationMs: summary.durationMs,
      })}`,
    );

    return summary;
  }

  /**
   * Writes one level and, only if it was seen whole, archives what vanished.
   *
   * A read that threw never reaches this method at all — the exception
   * propagates out of `syncHierarchy` and no level after it runs. That is the
   * "partial failure must not archive" rule in its strongest form: the archive
   * query cannot execute for a level whose read did not complete, because the
   * code that would call it is not reached.
   *
   * Truncation is the subtler half. A walk that hit the page ceiling returns
   * rows and no error, so it *would* reach here — and archiving then would
   * declare every object past the ceiling deleted. Hence the explicit check.
   */
  private async persistLevel(input: {
    scope: SocialAdEntityWriteScope;
    seenAt: Date;
    level: SocialAdEntityLevel;
    page: NormalizedAdEntityPage;
  }): Promise<SocialAdHierarchyLevelSummary> {
    const rows: readonly NormalizedAdEntity[] = input.page.rows;

    const written = await this.writer.upsert({
      scope: input.scope,
      rows,
      seenAt: input.seenAt,
    });

    const archived = input.page.truncated
      ? 0
      : await this.writer.archiveMissing({
          scope: input.scope,
          entityLevel: input.level,
          seenAt: input.seenAt,
        });

    return {
      level: input.level,
      read: rows.length,
      written,
      archived,
      skipped: input.page.skipped,
      truncated: input.page.truncated,
    };
  }

  private countOf(
    levels: readonly SocialAdHierarchyLevelSummary[],
    level: SocialAdEntityLevel,
  ): number {
    return levels.find((row) => row.level === level)?.read ?? 0;
  }
}
