import { Injectable, Logger } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import {
  calendarDayIn,
  calendarHourIn,
  shiftCalendarDay,
} from './social-organic-analytics-time';
import { SocialOrganicSyncRunService } from './social-organic-sync-run.service';

export const SOCIAL_ORGANIC_SYNC_ASSET_BATCH = 20;
export const SOCIAL_ORGANIC_SYNC_LOOKBACK_DAYS = 2;
const LOCAL_START_HOUR = 6;

/**
 * One bounded, sequential hourly pass. Each asset gets at most one scheduled
 * two-day intent per local day; the queue's own retries handle failures.
 */
@Injectable()
export class SocialOrganicSyncScheduler {
  private readonly logger = new Logger(SocialOrganicSyncScheduler.name);
  private running = false;

  constructor(
    private readonly runs: SocialOrganicSyncRunService,
    private readonly credentials: SocialOrganicCredentialResolver,
  ) {}

  @Cron(CronExpression.EVERY_HOUR)
  async tick(): Promise<number> {
    if (this.running) return 0;
    this.running = true;
    try {
      return await this.enqueueDue();
    } catch (error) {
      this.logger.error(
        `Organic analytics scheduling failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
      return 0;
    } finally {
      this.running = false;
    }
  }

  async enqueueDue(now: Date = new Date()): Promise<number> {
    const candidates = await this.runs.listSchedulableCandidates(
      SOCIAL_ORGANIC_SYNC_ASSET_BATCH,
    );
    let enqueued = 0;

    for (const candidate of candidates) {
      try {
        const resolved = await this.credentials.resolveForAnalytics(candidate);
        if (calendarHourIn(resolved.assetTimezone, now) < LOCAL_START_HOUR) {
          continue;
        }

        const toDate = calendarDayIn(resolved.assetTimezone, now);
        const fromDate = shiftCalendarDay(
          toDate,
          -(SOCIAL_ORGANIC_SYNC_LOOKBACK_DAYS - 1),
        );
        const idempotencyKey = this.runs.idempotencyKey({
          assetId: resolved.credential.assetId,
          runKind: 'scheduled',
          fromDate,
          toDate,
        });
        if (
          await this.runs.hasSettledRun(
            resolved.credential.assetId,
            idempotencyKey,
          )
        ) {
          continue;
        }

        const result = await this.runs.enqueue({
          resolved,
          runKind: 'scheduled',
          fromDate,
          toDate,
        });
        if (!result.deduplicated) enqueued += 1;
      } catch (error) {
        // One ineligible/broken asset never prevents another scoped asset.
        this.logger.warn(
          `Organic analytics asset skipped: ${JSON.stringify({
            assetId: candidate.assetId,
            reason: error instanceof Error ? error.name : 'unknown',
          })}`,
        );
      }
    }

    return enqueued;
  }
}
