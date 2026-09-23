import { Injectable, Logger } from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { hostname } from 'node:os';
import { SocialOrganicCredentialResolver } from '../credentials/social-organic-credential.resolver';
import type { SocialOrganicSyncRunEntity } from './entities/social-organic-sync-run.entity';
import { MetaOrganicInsightsService } from './meta/meta-organic-insights.service';
import { MetaOrganicAudienceService } from './meta/meta-organic-audience.service';
import { enumerateCalendarDays } from './social-organic-analytics-time';
import {
  classifyOrganicSyncFailure,
  nextOrganicSyncAttempt,
} from './social-organic-sync-retry';
import { SocialOrganicSyncError } from './social-organic-sync.error';
import {
  SocialOrganicSyncRunService,
  type SocialOrganicSyncRunCounters,
} from './social-organic-sync-run.service';

const TICK_MS = 5_000;
const CLAIM_LIMIT = 1;

@Injectable()
export class SocialOrganicSyncWorker {
  private readonly logger = new Logger(SocialOrganicSyncWorker.name);
  private readonly workerId = `${hostname()}:${process.pid}:organic-insights`;
  private running = false;

  constructor(
    private readonly runs: SocialOrganicSyncRunService,
    private readonly credentials: SocialOrganicCredentialResolver,
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
  ) {}

  @Interval(TICK_MS)
  async tick(): Promise<void> {
    if (this.running) return;
    this.running = true;
    try {
      await this.runs.recoverStale();
      await this.processDue(CLAIM_LIMIT);
    } catch (error) {
      this.logger.error(
        `Organic analytics worker cycle failed: ${error instanceof Error ? error.name : 'unknown'}`,
      );
    } finally {
      this.running = false;
    }
  }

  async processDue(limit = CLAIM_LIMIT): Promise<number> {
    const runs = await this.runs.claim({ workerId: this.workerId, limit });
    for (const run of runs) await this.processOne(run);
    return runs.length;
  }

  private async processOne(run: SocialOrganicSyncRunEntity): Promise<void> {
    const counters: SocialOrganicSyncRunCounters = {
      rowsWritten: 0,
      rowsSkipped: 0,
      apiCalls: 0,
    };

    try {
      if (!run.windowStart || !run.windowEnd) {
        throw new SocialOrganicSyncError('run_window_missing');
      }
      try {
        enumerateCalendarDays(run.windowStart, run.windowEnd);
      } catch {
        throw new SocialOrganicSyncError('invalid_sync_window');
      }

      // Scope is re-read from the durable row and re-validated by the resolver.
      const resolved = await this.credentials.resolvePersistedForAnalytics({
        tenantId: run.tenantId,
        workspaceId: run.workspaceId,
        agencyClientId: run.agencyClientId,
        assetId: run.assetId,
      });
      const summary = await this.insights.sync({
        resolved,
        fromDate: run.windowStart,
        toDate: run.windowEnd,
        syncRunId: run.id,
      });
      counters.rowsWritten =
        summary.postRows.length + summary.accountRows.length;
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
        const audience = await this.audience.sync({
          resolved,
          syncRunId: run.id,
        });
        counters.rowsWritten += audience.rowsWritten;
        counters.apiCalls += audience.apiCalls;
      } catch (error) {
        this.logger.warn(
          `Organic audience snapshot failed for run ${run.id}: ${
            error instanceof Error ? error.name : 'unknown'
          }`,
        );
      }

      await this.runs.markSucceeded({
        runId: run.id,
        lockedBy: this.workerId,
        counters,
      });
      this.log(run, 'succeeded', counters, null);
    } catch (error) {
      const policy = classifyOrganicSyncFailure(error);
      if (policy.retry && run.attempts < run.maxAttempts) {
        await this.runs.reschedule({
          runId: run.id,
          lockedBy: this.workerId,
          counters,
          lastError: policy.code,
          availableAt: nextOrganicSyncAttempt({
            attempts: run.attempts,
            rateLimited: policy.rateLimited,
            now: new Date(),
          }),
        });
        this.log(run, 'requeued', counters, policy.code);
        return;
      }

      const finish = {
        runId: run.id,
        lockedBy: this.workerId,
        counters,
        lastError: policy.code,
      };
      if (policy.retry) await this.runs.markDeadLetter(finish);
      else await this.runs.markFailed(finish);
      this.log(
        run,
        policy.retry ? 'dead_letter' : 'failed',
        counters,
        policy.code,
      );
    }
  }

  private log(
    run: SocialOrganicSyncRunEntity,
    status: string,
    counters: SocialOrganicSyncRunCounters,
    code: string | null,
  ): void {
    this.logger.log(
      `Organic analytics run settled: ${JSON.stringify({
        runId: run.id,
        assetId: run.assetId,
        status,
        rowsWritten: counters.rowsWritten,
        rowsSkipped: counters.rowsSkipped,
        code,
      })}`,
    );
  }
}
