import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type { SocialAdEntityLevel } from '../entities/social-ad-entity.entity';
import {
  normalizeGoogleAdsAccount,
  normalizeGoogleAdsAdGroups,
  normalizeGoogleAdsAds,
  normalizeGoogleAdsAssetGroups,
  normalizeGoogleAdsCampaigns,
} from '../sync/google-ads-entity.normalizer';
import {
  normalizeGoogleAdsConversionActionBreakdown,
  normalizeGoogleAdsNetworkBreakdown,
  normalizeGoogleAdsSearchTerms,
  type GoogleAdsDetailContext,
} from '../sync/google-ads-detail.normalizer';
import { GoogleAdsError } from '../sync/google-ads-error';
import { normalizeGoogleAdsMetrics } from '../sync/google-ads-insights.normalizer';
import type { InsightsWindow } from '../sync/insights-window';
import type { NormalizedAdEntityPage } from '../sync/meta-ads-entity.contract';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import { SocialAdInsightsTruncatedError } from '../sync/social-ad-insights.error';
import {
  GoogleAdsReaderService,
  type GoogleAdsRawPage,
} from './google-ads-reader.service';
import type {
  SocialAdHierarchyLevelSummary,
  SocialAdHierarchySyncSummary,
} from './social-ad-hierarchy-sync.service';
import type { SocialAdInsightsLevelSummary } from './social-ad-insights-sync.service';
import {
  SocialAdEntityWriterService,
  type SocialAdEntityWriteScope,
} from './social-ad-entity-writer.service';
import { SocialAdBreakdownWriterService } from './social-ad-breakdown-writer.service';
import { SocialAdMetricsWriterService } from './social-ad-metrics-writer.service';
import { SocialAdSearchTermWriterService } from './social-ad-search-term-writer.service';

/**
 * GA-DET: PMax search categories cost one operation per campaign. Past this
 * many PMax campaigns with delivery in one pass, the rest wait for the next
 * pass (logged as `pmax_category_capped`).
 */
const MAX_PMAX_CAMPAIGNS_PER_PASS = 20;

type DetailOutcome = { apiCalls: number; written: number };

/** One level read by two queries; truncated if either half was (D-G1). */
function mergePages(
  first: NormalizedAdEntityPage,
  second: NormalizedAdEntityPage,
): NormalizedAdEntityPage {
  return {
    rows: [...first.rows, ...second.rows],
    truncated: first.truncated || second.truncated,
    skipped: first.skipped + second.skipped,
    apiCalls: first.apiCalls + second.apiCalls,
  };
}

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
    private readonly breakdownWriter: SocialAdBreakdownWriterService,
    private readonly searchTermWriter: SocialAdSearchTermWriterService,
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
      // Ad groups and asset groups in one page: `archiveMissing` of the level
      // must see both in the same pass, or each would archive the other.
      await this.persistLevel(
        scope,
        seenAt,
        'adset',
        mergePages(
          normalizeGoogleAdsAdGroups(raw.adGroups, context),
          normalizeGoogleAdsAssetGroups(raw.assetGroups, context),
        ),
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
    // GA-DET: the campaign pass also reads where it served, which conversion
    // it was and what people searched. Never fails the level (below).
    const detailCalls =
      input.level === 'campaign' ? await this.ingestCampaignDetails(input) : 0;

    return {
      level: input.level,
      status: 'completed',
      read: page.rows.length,
      written,
      skipped: page.skipped,
      apiCalls: page.apiCalls + detailCalls,
    };
  }

  /**
   * GA-DET (D-G3, D-G4): the campaign details of one window, best effort.
   *
   * The campaign facts are already stored when this runs, and a detail must
   * never take them down: a new GAQL that Google refuses (one invalid field
   * fails the whole query) is logged with its code and the pass goes on. Only
   * the local quota budget stops the remaining reads. The log line is the live
   * validation of each query: codes and counts only, never a term.
   */
  private async ingestCampaignDetails(input: {
    credential: ResolvedAdCredential;
    window: InsightsWindow;
    isPartial: boolean;
    syncedAt: Date;
  }): Promise<number> {
    const { credential, window } = input;
    const context: GoogleAdsDetailContext = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      connectionId: credential.connectionId,
      provider: credential.provider,
      accountTimezone: credential.timezone,
      currency: credential.currency,
      isPartial: input.isPartial,
      syncedAt: input.syncedAt,
    };
    const results: Record<string, string> = {};
    let apiCalls = 0;
    let stopped = false;

    const attempt = async (
      name: string,
      work: () => Promise<DetailOutcome>,
    ): Promise<void> => {
      if (stopped) {
        results[name] = 'skipped_quota';
        return;
      }
      try {
        const outcome = await work();
        apiCalls += outcome.apiCalls;
        results[name] = `ok:${outcome.written}`;
      } catch (error) {
        const google = error instanceof GoogleAdsError ? error : null;
        apiCalls += google?.apiCalls ?? 0;
        results[name] = google?.code ?? 'detail_write_failed';
        if (google?.code === 'quota_budget_exhausted') stopped = true;
      }
    };
    const complete = (page: GoogleAdsRawPage): GoogleAdsRawPage => {
      // A truncated distribution looks complete and is not: store nothing.
      if (page.truncated) {
        throw new GoogleAdsError(
          'permanent',
          'google_ads_detail_truncated',
          null,
          page.apiCalls,
        );
      }
      return page;
    };

    const searchCampaigns = new Set<string>();
    const pmaxCampaigns: string[] = [];

    await attempt('ad_network', async () => {
      const page = complete(
        await this.reader.readCampaignDetail(credential, 'ad_network', window),
      );
      const normalized = normalizeGoogleAdsNetworkBreakdown(page, context);
      for (const channel of normalized.channels) {
        if (channel.channelType === 'SEARCH') {
          searchCampaigns.add(channel.campaignId);
        } else if (channel.channelType === 'PERFORMANCE_MAX') {
          pmaxCampaigns.push(channel.campaignId);
        }
      }
      return {
        apiCalls: page.apiCalls,
        written: await this.breakdownWriter.upsert(normalized.rows),
      };
    });

    await attempt('conversion_action', async () => {
      const page = complete(
        await this.reader.readCampaignDetail(
          credential,
          'conversion_action',
          window,
        ),
      );
      const normalized = normalizeGoogleAdsConversionActionBreakdown(
        page,
        context,
      );
      return {
        apiCalls: page.apiCalls,
        written: await this.breakdownWriter.upsert(normalized.rows),
      };
    });

    // Search terms and keywords exist only for Search campaigns: skip the two
    // operations when the window has none (the owner's account is PMax only).
    if (searchCampaigns.size > 0) {
      for (const kind of ['search_term', 'keyword'] as const) {
        await attempt(kind, async () => {
          const page = complete(
            await this.reader.readCampaignDetail(credential, kind, window),
          );
          const normalized = normalizeGoogleAdsSearchTerms(page, kind, context);
          return {
            apiCalls: page.apiCalls,
            written: await this.searchTermWriter.upsert(normalized.rows),
          };
        });
      }
    }

    for (const [index, campaignId] of pmaxCampaigns.entries()) {
      if (index >= MAX_PMAX_CAMPAIGNS_PER_PASS) {
        results.pmax_category_capped = String(
          pmaxCampaigns.length - MAX_PMAX_CAMPAIGNS_PER_PASS,
        );
        break;
      }
      await attempt(`pmax_category:${campaignId}`, async () => {
        const page = complete(
          await this.reader.readPmaxSearchCategories(
            credential,
            campaignId,
            window,
          ),
        );
        const normalized = normalizeGoogleAdsSearchTerms(
          page,
          'pmax_category',
          context,
          campaignId,
        );
        return {
          apiCalls: page.apiCalls,
          written: await this.searchTermWriter.upsert(normalized.rows),
        };
      });
    }

    this.logger.log(
      `Google Ads campaign details: ${JSON.stringify({
        connectionId: credential.connectionId,
        since: window.since,
        until: window.until,
        results,
        apiCalls,
      })}`,
    );

    return apiCalls;
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
