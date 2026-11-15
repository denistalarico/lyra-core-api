import { Injectable, Logger } from '@nestjs/common';
import {
  META_INSTAGRAM_PROVIDER,
  META_ORGANIC_PROVIDER,
} from '../../providers/meta/meta-organic-oauth.support';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';
import type {
  SocialOrganicAnalyticsProvider,
  SocialOrganicAnalyticsSyncInput,
} from '../social-organic-analytics.provider';
import {
  calendarDayIn,
  periodReachWindows,
} from '../social-organic-analytics-time';
import { SocialOrganicReachPeriodWriterService } from '../social-organic-reach-period-writer.service';
import type { SocialOrganicSyncRunCounters } from '../social-organic-sync-run.service';
import { MetaOrganicAudienceService } from './meta-organic-audience.service';
import { MetaOrganicFacebookReelsService } from './meta-organic-facebook-reels.service';
import { MetaOrganicInsightsService } from './meta-organic-insights.service';
import { MetaOrganicOnlineFollowersService } from './meta-organic-online-followers.service';
import { MetaOrganicPeriodReachService } from './meta-organic-period-reach.service';
import { MetaOrganicStoriesService } from './meta-organic-stories.service';

/**
 * The Meta (Facebook Page + Instagram) analytics pass, moved out of
 * `SocialOrganicSyncWorker` in OR0 without changing what it does: the window
 * metrics, then the isolated side passes, then the period reach.
 */
@Injectable()
export class MetaOrganicAnalyticsProvider implements SocialOrganicAnalyticsProvider {
  readonly providers = [META_ORGANIC_PROVIDER, META_INSTAGRAM_PROVIDER];
  private readonly logger = new Logger(MetaOrganicAnalyticsProvider.name);

  constructor(
    private readonly insights: MetaOrganicInsightsService,
    /**
     * The follower-demographics snapshot, taken alongside the metrics window.
     *
     * It was written, registered in the module, and then never called from
     * anywhere — so the table stayed empty no matter what
     * `SOCIAL_ORGANIC_AUDIENCE_ENABLED` said, and enabling the gate looked like
     * it had failed. This is the call it was waiting for.
     */
    private readonly audience: MetaOrganicAudienceService,
    private readonly onlineFollowers: MetaOrganicOnlineFollowersService,
    /** Period reach, measured by Meta and cached — see `measurePeriodReach`. */
    private readonly periodReach: MetaOrganicPeriodReachService,
    private readonly reachWriter: SocialOrganicReachPeriodWriterService,
    /**
     * Live stories. The hourly scheduler is the real capture; this call exists
     * so a manual sync also picks up what is up right now.
     */
    private readonly stories: MetaOrganicStoriesService,
    /**
     * Facebook Page reels, which live on an edge of their own — see
     * `MetaOrganicFacebookReelsService`. A no-op on an Instagram asset.
     */
    private readonly facebookReels: MetaOrganicFacebookReelsService,
  ) {}

  async sync(input: SocialOrganicAnalyticsSyncInput): Promise<void> {
    const { resolved, fromDate, toDate, syncRunId, counters } = input;

    const summary = await this.insights.sync({
      resolved,
      fromDate,
      toDate,
      syncRunId,
    });
    counters.rowsWritten = summary.postRows.length + summary.accountRows.length;
    counters.rowsSkipped = summary.rowsSkipped;
    counters.apiCalls = summary.apiCalls;

    // A stock snapshot, not part of the window — it measures "now" and files
    // itself under today, which is why it takes no dates.
    //
    // Its failure must not fail the run. The metrics above are already
    // written and correct; losing a day of demographics is a smaller harm
    // than rescheduling a window whose facts are in the table, which would
    // re-read the whole thing against the same quota. The gate being closed
    // returns an empty summary rather than throwing, so this costs nothing
    // when the capability is off.
    try {
      const audience = await this.audience.sync({ resolved, syncRunId });
      counters.rowsWritten += audience.rowsWritten;
      counters.apiCalls += audience.apiCalls;
    } catch (error) {
      this.logger.warn(
        `Organic audience snapshot failed for run ${syncRunId}: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }

    // The online-followers grid, isolated for the reason the audience pass
    // above is — and with more at stake in getting the isolation right: Meta
    // keeps only ~30 days of this metric, so a failure here loses days that
    // cannot be re-read later. Losing them is still better than failing a run
    // whose facts are already written, which would re-read the whole window.
    try {
      const online = await this.onlineFollowers.sync({ resolved, syncRunId });
      counters.rowsWritten += online.rowsWritten;
      counters.apiCalls += online.apiCalls;
    } catch (error) {
      this.logger.warn(
        `Organic online-followers sync failed for run ${syncRunId}: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }

    // The live stories, isolated for the same reason. This pass is not the
    // primary capture — `SocialOrganicStoriesScheduler` runs hourly because a
    // story is unreadable after 24 hours and a daily pass would lose whole
    // stories. It runs here too so that a manual sync captures what is up
    // now, rather than leaving an operator who just triggered one wondering
    // why today's story is missing.
    try {
      const stories = await this.stories.sync({ resolved, syncRunId });
      counters.rowsWritten += stories.rowsWritten;
      counters.apiCalls += stories.apiCalls;
    } catch (error) {
      this.logger.warn(
        `Organic stories capture failed for run ${syncRunId}: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }

    // Facebook reels, isolated for the same reason as the passes above. A
    // Page reel is on neither `/posts` nor `/media` and answers only
    // `/{reel}/video_insights`, so nothing the insights pass did covers it —
    // and nothing it writes is at risk if this fails. A reel is permanent,
    // so a lost pass is recovered by the next one.
    try {
      const reels = await this.facebookReels.sync({
        resolved,
        fromDate,
        toDate,
        syncRunId,
      });
      counters.rowsWritten += reels.rowsWritten;
      counters.apiCalls += reels.apiCalls;
    } catch (error) {
      this.logger.warn(
        `Facebook reels sync failed for run ${syncRunId}: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }

    await this.measurePeriodReach(resolved, counters);
  }

  /**
   * Measures the reach of the windows the dashboard can actually ask for.
   *
   * Only the presets, deliberately. A custom range is one request each and the
   * set of them is unbounded, so measuring every possible window would spend a
   * shared quota on answers nobody asked for. A custom range therefore reports
   * null, exactly as the paid side does, and the card says the measurement has
   * not been taken rather than inventing a sum.
   *
   * Every failure is swallowed per window: the facts of this run are already
   * written, and reach is an addition to them. Rescheduling over it would
   * re-read the whole window against the same quota to recover a number that
   * the next hourly pass would have fetched anyway.
   */
  private async measurePeriodReach(
    resolved: ResolvedOrganicAnalyticsCredential,
    counters: SocialOrganicSyncRunCounters,
  ): Promise<void> {
    const today = calendarDayIn(resolved.assetTimezone, new Date());

    for (const window of periodReachWindows(today)) {
      try {
        // `measurePeriod`, not `measure`: the same two API calls carry views
        // and reach with their organic and paid slices, and the narrower call
        // discarded five of the six. Nothing extra is spent here.
        const measurement = await this.periodReach.measurePeriod({
          resolved,
          since: window.since,
          until: window.until,
        });

        counters.apiCalls += measurement.apiCalls;
        // Zero calls means the asset type has nothing to measure at all. A
        // Facebook Page now spends one call per window — `measurePage` reads
        // what a Page still answers — so this no longer fires for one.
        if (measurement.apiCalls === 0) return;

        await this.reachWriter.record({
          tenantId: resolved.credential.tenantId,
          workspaceId: resolved.credential.workspaceId,
          agencyClientId: resolved.credential.agencyClientId,
          assetId: resolved.credential.assetId,
          provider: resolved.credential.provider,
          periodSince: window.since,
          periodUntil: window.until,
          assetTimezone: resolved.assetTimezone,
          reach: measurement.reach,
          reachOrganic: measurement.reachOrganic,
          reachPaid: measurement.reachPaid,
          reachFeed: measurement.reachFeed,
          reachReel: measurement.reachReel,
          reachStory: measurement.reachStory,
          views: measurement.views,
          viewsOrganic: measurement.viewsOrganic,
          viewsPaid: measurement.viewsPaid,
          viewsFeed: measurement.viewsFeed,
          viewsReel: measurement.viewsReel,
          viewsStory: measurement.viewsStory,
          interactionsReel: measurement.interactionsReel,
          interactionsStory: measurement.interactionsStory,
          likesReel: measurement.likesReel,
          commentsReel: measurement.commentsReel,
          savesReel: measurement.savesReel,
          sharesReel: measurement.sharesReel,
          sharesStory: measurement.sharesStory,
          // Facebook only; null on an Instagram measurement. The Page's
          // reaction, comment and share totals are not written here for the
          // same reason the counts are not — they are sums over the post table,
          // which the read layer computes for the period actually requested.
          pageViews: measurement.pageViews,
          // `reelCount`/`storyCount` are deliberately not written here. They
          // are questions about published content rather than measurements of a
          // window, Meta has no metric for them, and the post facts and the
          // story table already answer them — so the read layer counts rows for
          // the period it was actually asked about, instead of this cache
          // pinning an answer to one of four pre-measured windows.
          measuredSince: measurement.measuredSince,
          measuredUntil: measurement.measuredUntil,
          truncated: measurement.truncated,
          // A window whose last day is today is still accumulating, so it is
          // worth re-measuring on the next pass; a closed one is final.
          isPartial: window.until >= today,
        });
      } catch (error) {
        this.logger.warn(
          `Organic period reach failed for ${window.since}..${window.until}: ${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
      }
    }
  }
}
