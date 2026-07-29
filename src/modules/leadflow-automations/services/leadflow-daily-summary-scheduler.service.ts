import {
  Inject,
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { Interval } from '@nestjs/schedule';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { SCHEDULER_RUNTIME, type SchedulerRuntime } from '../scheduler';
import { nextDailyOccurrence } from './leadflow-daily-schedule';
import { LEADFLOW_DAILY_SUMMARY_TIMER_CONSUMER } from './leadflow-daily-summary-timer.consumer';
import { LeadFlowAutomationTriggerMatcherService } from './leadflow-automation-trigger-matcher.service';

/**
 * Maintains one durable next-occurrence timer for each active daily summary.
 *
 * Reconciliation runs on startup and periodically so a freshly activated or
 * edited automation does not depend on an application restart. Scheduler
 * idempotency makes repeated reconciliation safe.
 */
@Injectable()
export class LeadFlowDailySummarySchedulerService
  implements OnModuleInit, OnApplicationShutdown
{
  private readonly logger = new Logger(
    LeadFlowDailySummarySchedulerService.name,
  );
  private running = false;
  private stopping = false;

  constructor(
    private readonly matcher: LeadFlowAutomationTriggerMatcherService,
    @Inject(SCHEDULER_RUNTIME) private readonly scheduler: SchedulerRuntime,
  ) {}

  async onModuleInit(): Promise<void> {
    try {
      await this.reconcile();
    } catch (error) {
      this.logger.warn(
        `Initial daily summary reconciliation failed: ${errorCode(error)}`,
      );
    }
  }

  onApplicationShutdown(): void {
    this.stopping = true;
  }

  @Interval(60_000)
  async tick(): Promise<void> {
    if (this.running || this.stopping) return;
    this.running = true;
    try {
      await this.reconcile();
    } catch (error) {
      this.logger.error(
        `Daily summary reconciliation failed: ${errorCode(error)}`,
      );
    } finally {
      this.running = false;
    }
  }

  async reconcile(now = new Date()): Promise<number> {
    const matches =
      await this.matcher.findActiveMatchingTriggerAcrossScopes(
        'schedule.daily',
      );
    let scheduled = 0;
    for (const match of matches) {
      if (match.source.status !== LeadFlowAutomationStatus.Active) continue;
      const dailyTime = stringField(match.automation.schedulePolicy?.dailyTime);
      const timezone =
        stringField(match.automation.schedulePolicy?.timezone) ?? 'UTC';
      if (!dailyTime) continue;

      try {
        const occurrence = nextDailyOccurrence(now, dailyTime, timezone);
        const request = {
          tenantId: match.source.tenantId,
          workspaceId: match.source.workspaceId,
          timerKey: timerKey(match.source.id, occurrence.localDate),
          dedupeScope: match.source.id,
          fireAt: occurrence.fireAt.toISOString(),
          purpose: 'automation_daily_summary' as const,
          consumerKey: LEADFLOW_DAILY_SUMMARY_TIMER_CONSUMER,
          payload: {
            automationId: match.source.id,
            localDate: occurrence.localDate,
            dailyTime,
            timezone,
            scheduledFor: occurrence.fireAt.toISOString(),
          },
        };
        const handle = await this.scheduler.schedule(request);
        if (handle.fireAt !== request.fireAt) {
          await this.scheduler.reschedule(request);
        }
        scheduled += 1;
      } catch (error) {
        this.logger.warn(
          `Invalid daily schedule for automation ${match.source.id}: ${errorCode(error)}`,
        );
      }
    }
    return scheduled;
  }
}

function timerKey(automationId: string, localDate: string): string {
  return `daily-summary:${automationId}:${localDate}`;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error';
}
