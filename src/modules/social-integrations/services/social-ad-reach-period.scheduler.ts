import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { currentHourIn } from '../sync/insights-window';
import {
  SocialAdConnectionService,
  type SocialAdSchedulableConnection,
} from './social-ad-connection.service';
import { SocialAdReachPeriodConfigService } from './social-ad-reach-period-config.service';
import { SocialAdReachPeriodService } from './social-ad-reach-period.service';

/**
 * The account's local hour after which its presets are worth measuring.
 *
 * Five, an hour after the daily insights sync's own 04:00. Not to sequence them —
 * nothing here reads what that sync wrote — but because the two spend the same
 * business quota, and firing at the same local hour would make them compete for
 * it at exactly the moment the expensive one is running.
 *
 * Also late enough that the previous day is settled, which matters for what this
 * pass measures: at 05:00 the rolling windows have a yesterday in them worth
 * counting, and `month_previous` on the first of a month is final rather than
 * being measured an hour into existence.
 */
const LOCAL_START_HOUR = 5;

/**
 * Measures each account's preset reach ranges, once a day, in its own morning.
 *
 * ## Why its own scheduler
 *
 * Separate from `SocialAdSyncScheduler`, on the precedent
 * `SocialAdRetentionScheduler` set. That one enqueues the work that pays for the
 * product, and an exception raised while measuring a number the dashboard can
 * live without must not interrupt it. The failure modes are genuinely different
 * too: a sync run that fails is retried by the run's own attempts and reported in
 * the run log, while a failed measurement simply leaves a range unmeasured and
 * `periodReach` null — which the UI already renders as its own state.
 *
 * Deliberately **not** a `SocialAdSyncSegment`. That union is the run log's
 * *stored* contract: S2.5's worker reads it and S2.9's retention reasons about
 * it, so widening it would change what every historical run's recorded coverage
 * means. Etapa 2A refused for the same reason, and this refuses for it again.
 *
 * ## Per connection, in the account's zone
 *
 * The same shape as the sync tick and for the same reason: a preset is defined
 * relative to the account's own today, so "últimos 7 dias" for an Auckland
 * account is a different range than for a São Paulo one at the same instant. An
 * hourly global tick asking each connection whether its morning has arrived
 * answers that correctly without a timer per account — and makes a missed hour
 * harmless, since the next tick finds the same question unanswered.
 *
 * Idempotence comes from the cache rather than from a run log. A second pass on
 * the same day re-measures only what is still partial: the closed presets are
 * final and are served from the table without a request. So the cost of ticking
 * hourly after the account's 05:00 is a handful of measurements of ranges that
 * include today — which are exactly the ones worth refreshing.
 */
@Injectable()
export class SocialAdReachPeriodScheduler {
  private readonly logger = new Logger(SocialAdReachPeriodScheduler.name);

  constructor(
    private readonly config: SocialAdReachPeriodConfigService,
    private readonly connectionService: SocialAdConnectionService,
    private readonly reachPeriods: SocialAdReachPeriodService,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<void> {
    // Checked here as well as inside the service, so a disabled deployment does
    // not even list connections — and never logs a failure per connection for a
    // capability nobody turned on.
    if (!this.config.enabled) return;

    try {
      await this.prewarmDue();
    } catch (error) {
      // Swallowed on purpose: this must never take the process down or surface
      // as an unhandled rejection. The name alone, because a driver error's
      // message can carry statement fragments.
      this.logger.error(
        `Social ad period reach scheduling failed: ${
          error instanceof Error ? error.name : 'unknown'
        }`,
      );
    }
  }

  /** Prewarms every connection whose local morning has arrived. */
  async prewarmDue(now: Date = new Date()): Promise<number> {
    const connections = await this.connectionService.listSchedulable();

    let prewarmed = 0;

    for (const connection of connections) {
      if (!this.isDue(connection, now)) continue;

      try {
        await this.reachPeriods.prewarmConnection({
          tenantId: connection.tenantId,
          workspaceId: connection.workspaceId,
          agencyClientId: connection.agencyClientId,
          connectionId: connection.connectionId,
          now,
        });

        prewarmed += 1;
      } catch (error) {
        // One connection's failure is not the tick's. An expired credential must
        // not stop every other account from being measured — and the summary of
        // a partially failed pass is already inside `prewarm`, which does not
        // throw for a single failed preset.
        this.logger.error(
          `Social ad period reach prewarm failed for ${connection.connectionId}: ${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
      }
    }

    return prewarmed;
  }

  private isDue(connection: SocialAdSchedulableConnection, now: Date): boolean {
    return currentHourIn(connection.timezone, now) >= LOCAL_START_HOUR;
  }
}
