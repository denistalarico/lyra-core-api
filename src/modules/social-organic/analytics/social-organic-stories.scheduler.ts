import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import { MetaOrganicStoriesService } from './meta/meta-organic-stories.service';
import { SocialOrganicSyncRunService } from './social-organic-sync-run.service';

export const SOCIAL_ORGANIC_STORIES_ASSET_BATCH = 20;

/**
 * The hourly story capture.
 *
 * ## Why stories get a scheduler of their own
 *
 * The daily sync's scheduler enqueues at most one run per asset per local day,
 * which is right for facts that can be re-read: a metric missed at 09:00 is the
 * same metric at 18:00, so one pass a day converges.
 *
 * A story cannot be re-read. It is on `/{ig-user}/stories` for 24 hours and
 * then it is unreachable — it never reaches `/{ig-user}/media` at all. A
 * once-a-day pass would therefore capture whatever happened to be live at that
 * hour and permanently lose everything posted and expired between two passes.
 *
 * Hourly is what makes that loss impossible rather than merely unlikely: a
 * story lives 24 hours, so every story is live for at least one tick whatever
 * the phase. The cost is bounded and small — one listing call per asset per
 * hour, plus two per story actually live, and an account with no stories up
 * costs exactly one call.
 *
 * ## Why it does not go through the durable run queue
 *
 * The queue exists to make a failed window retryable, and retry is what this
 * job cannot use: by the time a failed capture is retried, the story it missed
 * may be gone, and the next hourly tick is a better attempt than a replay of
 * the old one would be. A failure here is logged and dropped on purpose, and
 * the following hour is the recovery.
 *
 * Runs are passed `syncRunId: null` for the same reason — there is no run to
 * attribute the rows to, and inventing one would put a row in the runs table
 * that no window explains.
 */
@Injectable()
export class SocialOrganicStoriesScheduler {
  private readonly logger = new Logger(SocialOrganicStoriesScheduler.name);
  private running = false;

  constructor(
    private readonly runs: SocialOrganicSyncRunService,
    private readonly credentials: SocialOrganicCredentialResolver,
    private readonly stories: MetaOrganicStoriesService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.captureDue();
    } catch (error) {
      this.logger.error(
        `Organic story capture failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** One pass over the schedulable assets. Returns how many stories were seen. */
  async captureDue(): Promise<number> {
    const candidates = await this.runs.listSchedulableCandidates(
      SOCIAL_ORGANIC_STORIES_ASSET_BATCH,
    );
    let seen = 0;

    for (const candidate of candidates) {
      try {
        const resolved = await this.credentials.resolveForAnalytics(candidate);
        const summary = await this.stories.sync({
          resolved,
          syncRunId: null,
        });
        seen += summary.storiesSeen;
      } catch (error) {
        // One asset never prevents another, and a failure is not retried: the
        // next hourly tick is the recovery. See the class docblock.
        this.logger.warn(
          `Organic story capture skipped: ${JSON.stringify({
            assetId: candidate.assetId,
            reason: error instanceof Error ? error.name : 'unknown',
          })}`,
        );
      }
    }

    return seen;
  }
}
