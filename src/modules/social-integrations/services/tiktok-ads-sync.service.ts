import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import {
  SocialAdEntity,
  type SocialAdEntityLevel,
} from '../entities/social-ad-entity.entity';
import {
  normalizeTikTokAdGroups,
  normalizeTikTokAds,
  normalizeTikTokAdvertiser,
  normalizeTikTokCampaigns,
} from '../sync/tiktok-ads-entity.normalizer';
import { normalizeTikTokMetrics } from '../sync/tiktok-ads-insights.normalizer';
import type { InsightsWindow } from '../sync/insights-window';
import type { NormalizedAdEntityPage } from '../sync/meta-ads-entity.contract';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import { SocialAdInsightsTruncatedError } from '../sync/social-ad-insights.error';
import { TikTokAdsReaderService } from './tiktok-ads-reader.service';
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
 * TikTok Ads sync into the shared mirror (D-I7/D-I8).
 *
 * Same orchestration shape as `GoogleAdsSyncService`, returning the same
 * summaries so the worker counts a TikTok segment like any other. Only the
 * read and the normalization differ; the writers are the existing ones.
 *
 * Read-only against TikTok: there is no mutation path in this class.
 */
@Injectable()
export class TikTokAdsSyncService {
  private readonly logger = new Logger(TikTokAdsSyncService.name);

  constructor(
    private readonly reader: TikTokAdsReaderService,
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
    const account = normalizeTikTokAdvertiser(raw.advertiser, {
      advertiserId: credential.externalAccountId,
      currency: credential.currency,
    });
    const context = {
      advertiserId: credential.externalAccountId,
      currency: account.rows[0]?.currency ?? credential.currency,
    };

    const levels: SocialAdHierarchyLevelSummary[] = [
      await this.persistLevel(scope, seenAt, 'account', account),
      await this.persistLevel(
        scope,
        seenAt,
        'campaign',
        normalizeTikTokCampaigns(raw.campaigns, context),
      ),
      await this.persistLevel(
        scope,
        seenAt,
        'adset',
        normalizeTikTokAdGroups(raw.adGroups, context),
      ),
      await this.persistLevel(
        scope,
        seenAt,
        'ad',
        normalizeTikTokAds(raw.ads, context),
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
      `TikTok Ads hierarchy synced: ${JSON.stringify({
        connectionId: summary.connectionId,
        entitiesWritten: summary.entitiesWritten,
        entitiesArchived: summary.entitiesArchived,
        partial: summary.partial,
        durationMs: summary.durationMs,
      })}`,
    );

    return summary;
  }

  /** One level of one window: one report (≤ 30-day requests), refused if truncated. */
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
    const page = normalizeTikTokMetrics(raw, {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      connectionId: credential.connectionId,
      provider: credential.provider,
      entityLevel: input.level,
      advertiserId: credential.externalAccountId,
      accountTimezone: credential.timezone,
      currency: credential.currency,
      campaignByEntity: await this.campaignByEntity(credential, input.level),
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
   * entity id → campaign id, from the mirror the hierarchy sweep wrote. Report
   * rows of an ad group or an ad name only that entity.
   */
  private async campaignByEntity(
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
