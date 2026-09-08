import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { MetaOrganicHealthService } from '../providers/meta/meta-organic-health.service';

/**
 * `MA4` scheduled health pass.
 *
 * One global hourly tick, not a timer per asset — the same shape as
 * `SocialAdSyncScheduler` and for the same reason: a job per asset would mean
 * a scheduler whose job count changes on every connect/disconnect, with
 * nothing to recreate those jobs after a restart. Hourly matches
 * `SocialAdSyncScheduler`'s own cadence and is conservative for a
 * "can this still publish?" signal — token/scope loss is not a per-minute
 * event, and a 7-day `degraded` window (see `HEALTH_NEAR_EXPIRY_MS`) easily
 * absorbs an hour of latency before an operator needs to act.
 *
 * Thundering herd: each asset is checked sequentially, in one pass, awaited
 * one at a time rather than fired concurrently — with today's asset counts
 * this keeps one pass well under the tick interval, and the pattern matches
 * `SocialAdSyncScheduler`'s own per-connection loop. A single asset's
 * failure is caught and logged so it cannot stop the remaining batch.
 */
@Injectable()
export class SocialOrganicHealthScheduler {
  private readonly logger = new Logger(SocialOrganicHealthScheduler.name);
  private running = false;

  constructor(private readonly health: MetaOrganicHealthService) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<number> {
    if (this.running) return 0;

    this.running = true;
    try {
      return await this.runDue();
    } catch (error) {
      this.logger.error(
        `Social organic health scheduling failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  /** Public so unit and PostgreSQL tests can drive a deterministic pass. */
  async runDue(): Promise<number> {
    const assets = await this.health.listEligibleForScheduledCheck();
    let checked = 0;

    for (const asset of assets) {
      try {
        await this.health.runCheck(asset);
        checked += 1;
      } catch (error) {
        this.logger.error(
          `Health check failed for social organic asset ${asset.id}: ${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
      }
    }

    return checked;
  }
}
