import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { currentDayIn, currentHourIn, shiftDay } from '../sync/insights-window';
import {
  SYNC_ENTITY_LEVELS,
  buildSyncIdempotencyKey,
} from '../sync/social-ad-sync-run.contract';
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
 * Enqueues one daily run per connection, per day.
 *
 * A single global tick rather than a timer per account. Ad accounts span every
 * timezone, and a cron per connection would mean a scheduler whose job count
 * changes whenever somebody connects an account — with nothing to re-create
 * those jobs after a restart. Instead the tick asks the same question of every
 * connection every hour: *has this account's morning arrived, and has today's
 * work already been done?* An account in Auckland answers yes thirteen hours
 * before one in São Paulo, from the same tick.
 *
 * That shape is also what makes a missed hour harmless. If the process is down
 * at 04:00 the 05:00 tick sees the same unanswered question and enqueues then;
 * nothing depends on firing at a particular minute.
 *
 * Only the daily cadence exists here. Weekly re-reads, the 90-day backfill and
 * the intraday D0 pass are deliberately absent: each needs a decision this
 * slice has no evidence for, and D0 in particular needs `is_partial` handling
 * that the ingest does not have yet.
 */
@Injectable()
export class SocialAdSyncScheduler {
  private readonly logger = new Logger(SocialAdSyncScheduler.name);

  constructor(
    private readonly config: SocialAdSyncConfigService,
    private readonly connectionService: SocialAdConnectionService,
    private readonly runService: SocialAdSyncRunService,
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

  /** Queues the daily run for every connection whose morning has arrived. */
  async enqueueDue(now: Date = new Date()): Promise<number> {
    const connections = await this.connectionService.listSchedulable();

    let enqueued = 0;

    for (const connection of connections) {
      try {
        if (await this.enqueueDaily(connection, now)) enqueued += 1;
      } catch (error) {
        // One connection's failure is not the tick's. A row with an unreadable
        // timezone must not stop every other account from being scheduled.
        this.logger.error(
          `Social ad daily scheduling failed for ${connection.connectionId}: ${
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
