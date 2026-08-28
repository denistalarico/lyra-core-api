import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SocialAdRetentionService } from './social-ad-retention.service';

/**
 * How many batches one nightly tick may sweep.
 *
 * The backlog is drained over several nights rather than in one sitting. With
 * the default batch size this is 5 000 rows a night — far more than the
 * runtime produces in a day, so the steady state is reached and held, while a
 * one-off accumulation (a period with retention disabled, say) is cleared over
 * a few nights instead of in a single long-running statement.
 *
 * A constant rather than a knob: it exists to bound one tick's cost, and the
 * value worth turning is the batch size, which already is one.
 */
const MAX_BATCHES_PER_TICK = 5;

/**
 * Runs the sync-run retention sweep, once a day.
 *
 * ## Its own scheduler
 *
 * Separate from `SocialAdSyncScheduler` deliberately. That one is about
 * fetching: it ticks hourly, asks per-connection questions, and answers each in
 * the ad account's own timezone. This one deletes, ticks daily, and is global —
 * there is no account whose local morning matters to a log sweep, and no reason
 * for housekeeping to share a failure mode with ingestion. Folding this into
 * the hourly tick would also mean an exception in the sweep could interrupt the
 * enqueueing that pays for the product.
 *
 * ## Global, not per tenant
 *
 * One cron for the whole table. A job per tenant or per connection would
 * multiply into hundreds of timers that nothing re-creates after a restart, to
 * do work whose predicate does not mention a tenant.
 *
 * ## 03:00
 *
 * Chosen against the sync's own clock rather than for any user-facing reason.
 * The daily sync fires when an ad account's local hour reaches 04:00, and
 * accounts are spread across zones, so no hour is entirely quiet — but 03:00
 * server time avoids being the same instant as the tick that enqueues the
 * bulk of the morning's work.
 */
@Injectable()
export class SocialAdRetentionScheduler {
  private readonly logger = new Logger(SocialAdRetentionScheduler.name);

  constructor(private readonly retention: SocialAdRetentionService) {}

  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async tick(): Promise<void> {
    try {
      await this.run();
    } catch (error) {
      // Swallowed on purpose: housekeeping must never take the process down or
      // surface as an unhandled rejection. The name alone, because a driver
      // error's message can carry statement fragments.
      this.logger.error(
        `Social ad retention sweep failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }

  /**
   * Sweeps until the backlog is drained or the tick's budget is spent.
   *
   * Stops on the first batch that did not fill, which is the normal case after
   * the first night: `hadMore` false means the predicate matched fewer rows
   * than the limit, so there is nothing left to find.
   */
  async run(now?: Date): Promise<{ deleted: number; batches: number }> {
    let deleted = 0;
    let batches = 0;

    for (let index = 0; index < MAX_BATCHES_PER_TICK; index += 1) {
      const result = await this.retention.sweep({ now });

      // The switch is off: no delete happened and none will this tick.
      if (result.skipped) break;

      deleted += result.deleted;
      batches += 1;

      if (!result.hadMore) break;
    }

    return { deleted, batches };
  }
}
