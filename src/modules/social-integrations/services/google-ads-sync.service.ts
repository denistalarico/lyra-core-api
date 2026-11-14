import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type { SocialAdEntityLevel } from '../entities/social-ad-entity.entity';
import {
  normalizeGoogleAdsAccount,
  normalizeGoogleAdsAdGroups,
  normalizeGoogleAdsAds,
  normalizeGoogleAdsCampaigns,
} from '../sync/google-ads-entity.normalizer';
import { normalizeGoogleAdsMetrics } from '../sync/google-ads-insights.normalizer';
import type { InsightsWindow } from '../sync/insights-window';
import type { NormalizedAdEntityPage } from '../sync/meta-ads-entity.contract';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import { SocialAdInsightsTruncatedError } from '../sync/social-ad-insights.error';
import { GoogleAdsReaderService } from './google-ads-reader.service';
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
 * Google Ads sync into the shared mirror (D-G6).
 *
 * The orchestration is the same shape as Meta's hierarchy and insights
 * services and returns the same summaries, so the worker counts a Google
 * segment exactly like a Meta one. What differs is only the read and the
 * normalization; the writers are the existing ones, untouched.
 *
 * Read-only against Google (D-G7): there is no mutation path in this class.
 */
@Injectable()
export class GoogleAdsSyncService {
  private readonly logger = new Logger(GoogleAdsSyncService.name);

  constructor(
    private readonly reader: GoogleAdsReaderService,
    private readonly entityWriter: SocialAdEntityWriterService,
    private readonly metricsWriter: SocialAdMetricsWriterService,
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
    const account = normalizeGoogleAdsAccount(raw.account, {
      customerId: credential.externalAccountId,
      currency: credential.currency,
    });
    const context = {
      customerId: credential.externalAccountId,
      currency: account.rows[0]?.currency ?? credential.currency,
    };

    const levels: SocialAdHierarchyLevelSummary[] = [
      await this.persistLevel(scope, seenAt, 'account', account),
      await this.persistLevel(
        scope,
        seenAt,
        'campaign',
        normalizeGoogleAdsCampaigns(raw.campaigns, context),
      ),
      await this.persistLevel(
        scope,
        seenAt,
        'adset',
        normalizeGoogleAdsAdGroups(raw.adGroups, context),
      ),
      await this.persistLevel(
        scope,
        seenAt,
        'ad',
        normalizeGoogleAdsAds(raw.ads, context),
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
      `Google Ads hierarchy synced: ${JSON.stringify({
        connectionId: summary.connectionId,
        entitiesWritten: summary.entitiesWritten,
        entitiesArchived: summary.entitiesArchived,
        partial: summary.partial,
        durationMs: summary.durationMs,
      })}`,
    );

    return summary;
  }

  /** One level of one window: a single wide query, refused if truncated. */
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
    const page = normalizeGoogleAdsMetrics(raw, {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      connectionId: credential.connectionId,
      provider: credential.provider,
      entityLevel: input.level,
      customerId: credential.externalAccountId,
      accountTimezone: credential.timezone,
      currency: credential.currency,
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
   * Writes one level and archives what vanished only if it was seen whole,
   * the same rule as the Meta sweep (a truncated read must never archive).
   */
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
