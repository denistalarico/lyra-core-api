import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import {
  SocialAdEntity,
  type SocialAdEntityLevel,
} from '../entities/social-ad-entity.entity';
import {
  campaignGroupIndex,
  normalizeLinkedInAccount,
  normalizeLinkedInCampaignGroups,
  normalizeLinkedInCampaigns,
  normalizeLinkedInCreatives,
} from '../sync/linkedin-ads-entity.normalizer';
import { normalizeLinkedInMetrics } from '../sync/linkedin-ads-insights.normalizer';
import type { InsightsWindow } from '../sync/insights-window';
import type { NormalizedAdEntityPage } from '../sync/meta-ads-entity.contract';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import { SocialAdInsightsTruncatedError } from '../sync/social-ad-insights.error';
import { LinkedInAdsReaderService } from './linkedin-ads-reader.service';
import type {
  SocialAdHierarchyLevelSummary,
  SocialAdHierarchySyncSummary,
} from './social-ad-hierarchy-sync.service';
import type { SocialAdInsightsLevelSummary } from './social-ad-insights-sync.service';
import {
  SocialAdEntityWriterService,
  type SocialAdEntityWriteScope,
} from './social-ad-entity-writer.service';
import { SocialAdMetricsWriterService } from './social-ad-metrics-writer.service';

/**
 * LinkedIn Ads sync into the shared mirror (D-I7/D-I8).
 *
 * Same orchestration shape as `GoogleAdsSyncService`, returning the same
 * summaries so the worker counts a LinkedIn segment like any other. Only the
 * read and the normalization differ; the writers are the existing ones.
 *
 * Read-only against LinkedIn: there is no mutation path in this class.
 */
@Injectable()
export class LinkedInAdsSyncService {
  private readonly logger = new Logger(LinkedInAdsSyncService.name);

  constructor(
    private readonly reader: LinkedInAdsReaderService,
    private readonly entityWriter: SocialAdEntityWriterService,
    private readonly metricsWriter: SocialAdMetricsWriterService,
    @InjectRepository(SocialAdEntity, 'agency')
    private readonly entities: Repository<SocialAdEntity>,
  ) {}

  async syncHierarchyWith(
    credential: ResolvedAdCredential,
  ): Promise<SocialAdHierarchySyncSummary> {
    const startedAt = new Date();
    const scope: SocialAdEntityWriteScope = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      connectionId: credential.connectionId,
      provider: credential.provider,
    };
    // One instant for the whole sweep: "not seen by this run" is exactly
    // `last_seen_at < seenAt`, as in the Meta sweep.
    const seenAt = new Date();

    const raw = await this.reader.readHierarchy(credential);
    const account = normalizeLinkedInAccount(raw.account, {
      accountId: credential.externalAccountId,
      currency: credential.currency,
    });
    const context = {
      accountId: credential.externalAccountId,
      currency: account.rows[0]?.currency ?? credential.currency,
    };

    const levels: SocialAdHierarchyLevelSummary[] = [
      await this.persistLevel(scope, seenAt, 'account', account),
      await this.persistLevel(
        scope,
        seenAt,
        'campaign',
        normalizeLinkedInCampaignGroups(raw.campaignGroups, context),
      ),
      await this.persistLevel(
        scope,
        seenAt,
        'adset',
        normalizeLinkedInCampaigns(raw.campaigns, context),
      ),
      await this.persistLevel(
        scope,
        seenAt,
        'ad',
        normalizeLinkedInCreatives(raw.creatives, {
          ...context,
          groupByCampaign: campaignGroupIndex(raw.campaigns),
        }),
      ),
    ];

    const finishedAt = new Date();
    const countOf = (level: SocialAdEntityLevel) =>
      levels.find((row) => row.level === level)?.read ?? 0;
    const summary: SocialAdHierarchySyncSummary = {
      connectionId: credential.connectionId,
      provider: credential.provider,
      externalAccountId: credential.externalAccountId,
      levels,
      accountCount: countOf('account'),
      campaignsCount: countOf('campaign'),
      adsetsCount: countOf('adset'),
      adsCount: countOf('ad'),
      entitiesWritten: levels.reduce((total, row) => total + row.written, 0),
      entitiesArchived: levels.reduce((total, row) => total + row.archived, 0),
      apiCalls: levels.reduce((total, row) => total + row.apiCalls, 0),
      destinationsObserved: 0,
      partial: levels.some((level) => level.truncated),
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      durationMs: finishedAt.getTime() - startedAt.getTime(),
    };

    this.logger.log(
      `LinkedIn Ads hierarchy synced: ${JSON.stringify({
        connectionId: summary.connectionId,
        entitiesWritten: summary.entitiesWritten,
        entitiesArchived: summary.entitiesArchived,
        partial: summary.partial,
        durationMs: summary.durationMs,
      })}`,
    );

    return summary;
  }

  /** One level of one window: a single analytics call, refused if truncated. */
  async ingestLevel(input: {
    credential: ResolvedAdCredential;
    level: SocialAdInsightsLevel;
    window: InsightsWindow;
    isPartial: boolean;
    syncedAt: Date;
  }): Promise<SocialAdInsightsLevelSummary> {
    const { credential } = input;
    const raw = await this.reader.readDailyMetrics(
      credential,
      input.level,
      input.window,
    );
    const page = normalizeLinkedInMetrics(raw, {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      connectionId: credential.connectionId,
      provider: credential.provider,
      entityLevel: input.level,
      accountId: credential.externalAccountId,
      accountTimezone: credential.timezone,
      currency: credential.currency,
      groupByEntity: await this.groupByEntity(credential, input.level),
      isPartial: input.isPartial,
      syncedAt: input.syncedAt,
    });

    // A truncated window would leave gaps that look like days without spend.
    if (page.truncated) throw new SocialAdInsightsTruncatedError(input.level);

    const written = await this.metricsWriter.upsert(page.rows);

    return {
      level: input.level,
      status: 'completed',
      read: page.rows.length,
      written,
      skipped: page.skipped,
      apiCalls: page.apiCalls,
    };
  }

  /**
   * entity id → campaign group id, from the mirror the hierarchy sweep wrote.
   * Analytics rows of a campaign or a creative name only that entity, but the
   * mirror's `campaign_external_id` is the top level (the group).
   */
  private async groupByEntity(
    credential: ResolvedAdCredential,
    level: SocialAdInsightsLevel,
  ): Promise<Map<string, string>> {
    const map = new Map<string, string>();

    if (level === 'account' || level === 'campaign') return map;

    const rows = await this.entities.find({
      where: {
        tenantId: credential.tenantId,
        workspaceId: credential.workspaceId,
        connectionId: credential.connectionId,
        entityLevel: level,
      },
      select: ['externalId', 'campaignExternalId'],
    });

    for (const row of rows) {
      if (row.campaignExternalId)
        map.set(row.externalId, row.campaignExternalId);
    }

    return map;
  }

  private async persistLevel(
    scope: SocialAdEntityWriteScope,
    seenAt: Date,
    level: SocialAdEntityLevel,
    page: NormalizedAdEntityPage,
  ): Promise<SocialAdHierarchyLevelSummary> {
    const written = await this.entityWriter.upsert({
      scope,
      rows: page.rows,
      seenAt,
    });
    const archived = page.truncated
      ? 0
      : await this.entityWriter.archiveMissing({
          scope,
          entityLevel: level,
          seenAt,
        });

    return {
      level,
      read: page.rows.length,
      written,
      archived,
      skipped: page.skipped,
      truncated: page.truncated,
      apiCalls: page.apiCalls,
    };
  }
}
