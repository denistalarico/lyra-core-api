import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';
import { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import type { SocialOrganicOnlineFollowersSyncSummary } from '../social-organic-online-followers.contract';
import { SocialOrganicOnlineFollowersWriterService } from '../social-organic-online-followers-writer.service';
import { SocialOrganicSyncError } from '../social-organic-sync.error';
import { normalizeInstagramOnlineFollowers } from './meta-organic-online-followers.normalizer';

/**
 * Reads the hourly online-followers grid for one asset.
 *
 * The source of both "melhor dia para postar" and "melhor horário para postar",
 * which are one collection read two ways.
 *
 * ## Why it asks for a window when the other snapshot service does not
 *
 * `MetaOrganicAudienceService` measures a stock that only exists "now". This one
 * reads a genuine series: Meta returns one entry per day, each with 24 hourly
 * counts. The window matters twice over — **without `since`/`until` the metric
 * answers with empty maps for every day**, verified against production on
 * 2026-09-24, so the range is not an optimisation but the difference between
 * data and nothing.
 *
 * ## Why the window is always the last 30 days
 *
 * Meta serves roughly 30 days of this metric and nothing behind it, so there is
 * no longer history to ask for and no backfill to run. A pass therefore re-reads
 * the whole window rather than only new days: Meta revises recent days, and the
 * upsert makes a re-read a correction rather than a duplicate. It is one call,
 * so re-reading 30 days costs the same as re-reading one.
 *
 * That retention window is also why this runs on every sync. A day not captured
 * while it was being served is gone — unlike the daily facts, there is nothing
 * to go back for.
 */
@Injectable()
export class MetaOrganicOnlineFollowersService {
  private readonly logger = new Logger(MetaOrganicOnlineFollowersService.name);

  constructor(
    private readonly graph: MetaOrganicGraphService,
    private readonly writer: SocialOrganicOnlineFollowersWriterService,
  ) {}

  /**
   * One pass for one scoped asset.
   *
   * Returns an empty summary rather than throwing for an asset that cannot
   * answer — a Facebook Page — for the reason the audience service documents:
   * this is invoked alongside a sync and must not fail one over a metric that
   * only one provider offers.
   */
  async sync(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    syncRunId: string | null;
    syncedAt?: Date;
  }): Promise<SocialOrganicOnlineFollowersSyncSummary> {
    const { credential, assetTimezone } = input.resolved;
    const syncedAt = input.syncedAt ?? new Date();

    const empty: SocialOrganicOnlineFollowersSyncSummary = {
      rowsWritten: 0,
      daysCovered: 0,
      apiCalls: 0,
    };

    if (credential.provider !== 'meta') {
      throw new SocialOrganicSyncError('unsupported_analytics_asset_type');
    }

    // Instagram only. A Page has no `online_followers`, and asking would spend
    // a call to be refused.
    if (credential.assetType !== 'instagram_professional') return empty;

    const until = Math.floor(syncedAt.getTime() / 1000);
    const since = until - WINDOW_DAYS * DAY_SECONDS;

    const insights = await this.graph.getOrganicInsights({
      objectId: credential.externalAssetId,
      accessToken: credential.accessToken,
      metrics: ['online_followers'],
      // `lifetime` is the only period this metric accepts — `day` is refused
      // with `(#100) The following periods (day) are incompatible with the
      // metric (online_followers)`, and `metric_type=total_value` is refused
      // too. Verified against production on 2026-09-24.
      period: 'lifetime',
      since,
      until,
    });

    const rows = normalizeInstagramOnlineFollowers({
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      assetId: credential.assetId,
      provider: credential.provider,
      assetTimezone,
      observedAt: syncedAt,
      syncedAt,
      syncRunId: input.syncRunId ?? '',
      insights,
    });

    const rowsWritten = await this.writer.upsert(rows);

    // Days Meta actually carried, not days requested. The newest day is
    // routinely empty and a window can be short for a young account, so
    // reporting the request would overstate coverage.
    const daysCovered = new Set(rows.map((row) => row.metricDate)).size;

    if (!daysCovered) {
      this.logger.debug(
        `No online-followers data for asset ${credential.assetId}; Meta withholds this metric below 100 followers.`,
      );
    }

    return { rowsWritten, daysCovered, apiCalls: insights.apiCalls };
  }
}

const DAY_SECONDS = 86_400;

/** Meta serves about 30 days of this metric; asking for more returns nothing. */
const WINDOW_DAYS = 30;
