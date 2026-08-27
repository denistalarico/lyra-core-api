import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { currentDayIn, currentHourIn, shiftDay } from '../sync/insights-window';
import {
  INSIGHTS_ENTITY_LEVELS,
  SYNC_ENTITY_LEVELS,
  buildSyncIdempotencyKey,
} from '../sync/social-ad-sync-run.contract';
import { SocialAdBackfillPlannerService } from './social-ad-backfill-planner.service';
import {
  SocialAdConnectionService,
  type SocialAdSchedulableConnection,
} from './social-ad-connection.service';
import { SocialAdSyncConfigService } from './social-ad-sync-config.service';
import { SocialAdSyncRunService } from './social-ad-sync-run.service';

/**
 * The account's local hour after which its previous day is worth reading.
 *
 * Not midnight. Meta keeps attributing conversions to a day for hours after it
 * closes, and a read at 00:05 would store numbers that are already wrong by
 * breakfast. Four in the morning is late enough that the previous day has
 * settled and early enough that the numbers are there when people arrive.
 */
const LOCAL_START_HOUR = 4;

/**
 * The account's local hour before which today is not worth reading.
 *
 * Six, and the reason is arithmetic rather than taste: at 00:30 the account's
 * day is thirty minutes old, so an intraday read costs a full pass of the
 * provider to store a row that is almost entirely zeroes and will be replaced
 * three hours later. Worse, most accounts deliver nothing at all overnight, so
 * the early buckets buy a row that says the same thing as the row's absence.
 *
 * A constant rather than a knob. It is not a preference an operator has any
 * evidence to change, and the value that *is* worth turning — how often a pass
 * happens — is the interval, which is configurable.
 */
const INTRADAY_START_HOUR = 6;

/**
 * Which pass of the account's day this is.
 *
 * The bucket is what makes an intraday intent identifiable. Every pass of one
 * day asks for the same window — today — so without a label the 09:00 snapshot
 * and the 12:00 snapshot are the same intent, and the second is deduplicated
 * against the first, which has already settled. The account would get one
 * intraday reading per day and no more.
 *
 * Derived from the account's own hour, floored to the interval, and never from
 * a clock reading. `h09` covers 09:00 to 11:59 with a three-hour interval, so
 * an hourly tick that fires four times inside it asks the same question four
 * times and enqueues once — which is also what makes a missed tick harmless:
 * the next hour is still inside the bucket and still finds it undone.
 *
 * Zero-padded so the label sorts the way the day runs.
 */
export function intradayBucket(hour: number, intervalHours: number): string {
  const start =
    intervalHours > 0 ? Math.floor(hour / intervalHours) * intervalHours : hour;

  return `h${String(start).padStart(2, '0')}`;
}

/**
 * Decides, once an hour, what every connection owes.
 *
 * A single global tick rather than a timer per account. Ad accounts span every
 * timezone, and a cron per connection would mean a scheduler whose job count
 * changes whenever somebody connects an account — with nothing to re-create
 * those jobs after a restart. Instead the tick asks the same questions of every
 * connection every hour, and each is answered in the account's own zone: *has
 * this account's morning arrived and is yesterday still unread? is it far
 * enough into today for another snapshot? does it still owe history?* An
 * account in Auckland answers the first one thirteen hours before an account in
 * São Paulo, from the same tick.
 *
 * That shape is also what makes a missed hour harmless. If the process is down
 * at 04:00 the 05:00 tick sees the same unanswered question and enqueues then;
 * nothing depends on firing at a particular minute. The intraday bucket works
 * the same way — an hour lost inside a bucket is recovered by the next hour
 * still inside it.
 *
 * ## Order within a tick
 *
 * Daily, then intraday, then backfill, per connection. Not a priority system —
 * the run table has no priority column and does not need one — but the order in
 * which rows are created, which the claim query then follows: it takes the
 * oldest due run first, so work enqueued earlier in the same tick is claimed
 * first. Yesterday's final numbers matter more than today's provisional ones,
 * and both matter more than a quarter of history nobody is watching arrive.
 */
@Injectable()
export class SocialAdSyncScheduler {
  private readonly logger = new Logger(SocialAdSyncScheduler.name);

  constructor(
    private readonly config: SocialAdSyncConfigService,
    private readonly connectionService: SocialAdConnectionService,
    private readonly runService: SocialAdSyncRunService,
    private readonly backfillPlanner: SocialAdBackfillPlannerService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    // The same switch the worker reads. Queueing while nothing drains would
    // build a backlog that starts executing all at once when it is turned back
    // on — every connection's every missed day, at once.
    if (!this.config.enabled) return;

    try {
      await this.enqueueDue();
    } catch (error) {
      this.logger.error(
        `Social ad sync scheduling failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    }
  }

  /** Queues everything every connection is due, in one pass. */
  async enqueueDue(now: Date = new Date()): Promise<number> {
    const connections = await this.connectionService.listSchedulable();

    let enqueued = 0;

    for (const connection of connections) {
      try {
        if (await this.enqueueDaily(connection, now)) enqueued += 1;
        if (await this.enqueueIntraday(connection, now)) enqueued += 1;

        /**
         * The recovery path for the backfill chain, not its engine.
         *
         * The chain normally advances the moment a chunk settles, which is
         * seconds rather than an hour. This call is what restarts one that lost
         * its hand-off — a worker killed mid-run, a credential that failed to
         * resolve, a chunk enqueued while the runtime was switched off — and it
         * is also the only path that ever starts a chain for a connection made
         * during an outage. The planner is idempotent, so asking every hour
         * costs two indexed reads for a connection that owes nothing.
         */
        const decision = await this.backfillPlanner.planNext(connection, now);

        if (decision.action === 'enqueued') enqueued += 1;
      } catch (error) {
        // One connection's failure is not the tick's. A row with an unreadable
        // timezone must not stop every other account from being scheduled.
        this.logger.error(
          `Social ad scheduling failed for ${connection.connectionId}: ${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
      }
    }

    return enqueued;
  }

  private async enqueueDaily(
    connection: SocialAdSchedulableConnection,
    now: Date,
  ): Promise<boolean> {
    if (currentHourIn(connection.timezone, now) < LOCAL_START_HOUR) {
      return false;
    }

    const window = this.dailyWindow(connection.timezone, now);

    const idempotencyKey = buildSyncIdempotencyKey({
      connectionId: connection.connectionId,
      runKind: 'daily',
      windowStart: window.since,
      windowEnd: window.until,
      entityLevels: SYNC_ENTITY_LEVELS,
    });

    /**
     * Today's work is done if a run for today's window has settled.
     *
     * The in-flight unique index already collapses a duplicate that is queued
     * or running; this covers the other half, and it counts failures too. A
     * daily run that dead-lettered at 04:00 must not be re-enqueued at 05:00
     * and every hour after — that is how a broken connection becomes twenty
     * runs a day and a rate limit becomes a self-inflicted one.
     *
     * The window is part of the key, so tomorrow's tick asks a different
     * question and gets a fresh attempt.
     */
    if (
      await this.runService.hasSettledRun(
        connection.connectionId,
        idempotencyKey,
      )
    ) {
      return false;
    }

    const result = await this.runService.enqueue({
      tenantId: connection.tenantId,
      workspaceId: connection.workspaceId,
      agencyClientId: connection.agencyClientId,
      connectionId: connection.connectionId,
      provider: connection.provider,
      runKind: 'daily',
      windowStart: window.since,
      windowEnd: window.until,
      // Nobody asked for it. The column is what separates a run somebody is
      // waiting on from one the clock produced.
      requestedById: null,
    });

    if (result.deduplicated) return false;

    this.logger.log(
      `Social ad daily sync queued: ${JSON.stringify({
        connectionId: connection.connectionId,
        runId: result.run.id,
        since: window.since,
        until: window.until,
      })}`,
    );

    return true;
  }

  /**
   * Queues one snapshot of the account's unfinished day, per bucket.
   *
   * Three gates, and each rejects something different:
   *
   * 1. **The interval.** `0` turns intraday off entirely — the table then has
   *    no rows for today, which is exactly what it had before this existed.
   * 2. **The hour.** Nothing before 06:00 local, so an account does not spend a
   *    provider read on a day that is barely under way.
   * 3. **The bucket.** One settled run per bucket is enough. The window alone
   *    cannot express this — every pass of one day asks for the same day — so
   *    the bucket is part of the idempotency key.
   *
   * A failed intraday run is *not* retried by the next hour's tick, for the
   * same reason a failed daily run is not: `hasSettledRun` counts failures, and
   * a broken connection re-enqueued every hour becomes twenty runs a day and a
   * self-inflicted rate limit. It is retried by the run's own attempts, and
   * then by the next bucket three hours later.
   *
   * Nothing downstream depends on this having happened. If every intraday pass
   * of a day fails, the account's daily run reads that day the next morning as
   * a closed window and writes the same rows with `is_partial = false`. The
   * intraday pass makes today visible earlier; it is never the thing that makes
   * today correct.
   */
  private async enqueueIntraday(
    connection: SocialAdSchedulableConnection,
    now: Date,
  ): Promise<boolean> {
    const intervalHours = this.config.intradayIntervalHours;

    if (intervalHours <= 0) return false;

    const hour = currentHourIn(connection.timezone, now);

    if (hour < INTRADAY_START_HOUR) return false;

    // The account's own today, on both ends: an intraday window is one day, and
    // the worker re-checks that it is still this day when it claims the run.
    const today = currentDayIn(connection.timezone, now);
    const bucket = intradayBucket(hour, intervalHours);

    const idempotencyKey = buildSyncIdempotencyKey({
      connectionId: connection.connectionId,
      runKind: 'intraday',
      windowStart: today,
      windowEnd: today,
      entityLevels: INSIGHTS_ENTITY_LEVELS,
      bucket,
    });

    if (
      await this.runService.hasSettledRun(
        connection.connectionId,
        idempotencyKey,
      )
    ) {
      return false;
    }

    const result = await this.runService.enqueue({
      tenantId: connection.tenantId,
      workspaceId: connection.workspaceId,
      agencyClientId: connection.agencyClientId,
      connectionId: connection.connectionId,
      provider: connection.provider,
      runKind: 'intraday',
      windowStart: today,
      windowEnd: today,
      entityLevels: INSIGHTS_ENTITY_LEVELS,
      requestedById: null,
      // The same bucket the key above was built from. `enqueue` rebuilds the
      // key from its inputs rather than accepting one, so that a run row and
      // the question asked about it cannot be keyed differently.
      bucket,
    });

    if (result.deduplicated) return false;

    this.logger.log(
      `Social ad intraday sync queued: ${JSON.stringify({
        connectionId: connection.connectionId,
        runId: result.run.id,
        day: today,
        bucket,
      })}`,
    );

    return true;
  }

  /**
   * The lookback window, ending at the account's last settled day.
   *
   * It re-reads days that were already stored, on purpose: Meta restates
   * recent numbers as conversions arrive late, so a conversion attributed today
   * to a click five days ago only reaches the table if something reads that day
   * again. The writes are idempotent upserts, so the cost of re-reading is a
   * request rather than a duplicate row.
   *
   * Inclusive on both ends: a seven-day lookback covers D-7 through D-1.
   */
  private dailyWindow(timezone: string, now: Date) {
    const until = shiftDay(currentDayIn(timezone, now), -1);

    return {
      since: shiftDay(until, -(this.config.dailyLookbackDays - 1)),
      until,
    };
  }
}
