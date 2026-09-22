import { Injectable, Logger } from '@nestjs/common';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';
import { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';
import { calendarDayIn } from '../social-organic-analytics-time';
import { SocialOrganicAudienceConfigService } from '../social-organic-audience-config.service';
import type {
  NormalizedOrganicAudienceDaily,
  SocialOrganicAudienceSyncSummary,
} from '../social-organic-audience.contract';
import { SocialOrganicAudienceWriterService } from '../social-organic-audience-writer.service';
import { SocialOrganicSyncError } from '../social-organic-sync.error';
import { normalizeInstagramFollowerDemographics } from './meta-organic-audience.normalizer';
import {
  INSTAGRAM_AUDIENCE_BREAKDOWNS,
  INSTAGRAM_AUDIENCE_METRIC,
  META_ORGANIC_INSIGHTS_GRAPH_VERSION,
} from './meta-organic-insights.types';

/**
 * Reads follower demographics for one asset and stores them as a snapshot.
 *
 * ## Why this takes no window
 *
 * Every metric it reads is a **lifetime stock**: "how many followers are in this
 * bucket *now*". There is no historical series to request and none to backfill —
 * asking Meta for last month's follower demographics is not a supported
 * question, and answering it from stored rows would mean one snapshot per day
 * from the day ingestion was switched on, which is what this table accumulates.
 *
 * So a pass measures today, in the asset's own timezone, and files it under that
 * calendar day. A second pass the same day replaces it, because a total re-read
 * four hours later is a better measurement of the same day rather than a second
 * one.
 *
 * ## Why it is separate from `MetaOrganicInsightsService`
 *
 * That service syncs a *window* of daily flow, iterating calendar days. This one
 * measures a stock once. Folding them together would put a loop over days around
 * a read that must not be iterated per day — the precise mistake the post
 * lifetime snapshot path already had to be written carefully to avoid — and the
 * result would be N identical provider calls filed under N different dates.
 */
@Injectable()
export class MetaOrganicAudienceService {
  private readonly logger = new Logger(MetaOrganicAudienceService.name);

  constructor(
    private readonly graph: MetaOrganicGraphService,
    private readonly config: SocialOrganicAudienceConfigService,
    private readonly writer: SocialOrganicAudienceWriterService,
  ) {}

  /**
   * One audience snapshot for one scoped asset.
   *
   * Returns a summary with zero dimensions when the gate is closed, rather than
   * throwing: unlike the paid entry point this has no HTTP caller of its own —
   * it is invoked alongside a sync — and a throw would fail a metrics sync that
   * is otherwise fine over a capability nobody enabled.
   */
  async sync(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    syncRunId: string | null;
    syncedAt?: Date;
  }): Promise<SocialOrganicAudienceSyncSummary> {
    const { credential, assetTimezone } = input.resolved;
    const syncedAt = input.syncedAt ?? new Date();
    // The asset's own calendar day, never the server's: a snapshot taken at
    // 22:00 in São Paulo belongs to that day there and to the next one in UTC.
    const metricDate = calendarDayIn(assetTimezone, syncedAt);

    const empty: SocialOrganicAudienceSyncSummary = {
      assetId: credential.assetId,
      metricDate,
      dimensions: 0,
      rowsWritten: 0,
      apiCalls: 0,
    };

    if (!this.config.enabled) return empty;

    if (credential.provider !== 'meta') {
      throw new SocialOrganicSyncError('unsupported_analytics_asset_type');
    }

    const context = {
      tenantId: credential.tenantId,
      workspaceId: credential.workspaceId,
      agencyClientId: credential.agencyClientId,
      assetId: credential.assetId,
      provider: credential.provider,
      metricDate,
      assetTimezone,
      observedAt: syncedAt,
      syncedAt,
      syncRunId: input.syncRunId,
    };

    const rows: NormalizedOrganicAudienceDaily[] = [];
    let apiCalls = 0;
    let dimensions = 0;

    if (credential.assetType === 'instagram_professional') {
      for (const breakdown of INSTAGRAM_AUDIENCE_BREAKDOWNS) {
        const insights = await this.graph.getOrganicInsights({
          objectId: credential.externalAssetId,
          accessToken: credential.accessToken,
          metrics: [INSTAGRAM_AUDIENCE_METRIC],
          // `lifetime`, and it is the only correct value: `follower_demographics`
          // has no daily form, and asking for `period=day` returns nothing rather
          // than a flow.
          period: 'lifetime',
          metricType: 'total_value',
          breakdown,
        });

        apiCalls += insights.apiCalls;

        const produced = normalizeInstagramFollowerDemographics({
          ...context,
          kind: breakdown,
          insights,
        });

        // Counted only when the dimension actually answered. Meta withholds this
        // metric entirely below 100 followers, and reporting a dimension as
        // covered when it returned nothing would make an empty chart look like a
        // measured absence.
        if (produced.length) dimensions += 1;

        rows.push(...produced);
      }
    } else if (credential.assetType === 'facebook_page') {
      // Nothing to collect: Meta retired Page fan demographics.
      //
      // `page_fans_gender_age`, `page_fans_city` and `page_fans_country` answer
      // `(#100) The value must be a valid insights metric` — verified against
      // production on 2026-09-22, and verified to be about the metric rather
      // than the account or the token: a metric name invented for the test
      // returns that same error, while `page_follows` succeeds in the identical
      // call. The same request also fails on v23 and v20, so it is a retirement
      // across the API and not a version this project could pin back to. No
      // replacement endpoint exposes the buckets either — field expansion,
      // per-age/gender impression metrics and a `page_audience` guess were all
      // tried.
      //
      // The honest result is therefore zero dimensions, which surfaces in the UI
      // as "not collected" rather than an error or an empty chart that would
      // read as "this Page has no audience". Instagram still answers
      // `follower_demographics`, so audience ingestion stays worth running.
      this.logger.debug(
        `Facebook Page audience demographics unavailable on Graph ${META_ORGANIC_INSIGHTS_GRAPH_VERSION}; skipping asset ${credential.assetId}.`,
      );
    } else {
      throw new SocialOrganicSyncError('unsupported_analytics_asset_type');
    }

    const rowsWritten = await this.writer.upsert(rows);

    const summary: SocialOrganicAudienceSyncSummary = {
      assetId: credential.assetId,
      metricDate,
      dimensions,
      rowsWritten,
      apiCalls,
    };

    this.logger.log(
      `Organic audience snapshot stored: ${JSON.stringify(summary)}`,
    );

    return summary;
  }
}
