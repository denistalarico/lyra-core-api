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
import {
  nextScheduledOccurrence,
  readSummarySchedule,
} from './leadflow-daily-schedule';
import { LEADFLOW_DAILY_SUMMARY_TIMER_CONSUMER } from './leadflow-daily-summary-timer.consumer';
import { LeadFlowAutomationTriggerMatcherService } from './leadflow-automation-trigger-matcher.service';

/**
 * Maintains one durable next-occurrence timer for each active summary.
 *
 * Reconciliation runs on startup and periodically so a freshly activated or
 * edited automation does not depend on an application restart. Scheduler
 * idempotency makes repeated reconciliation safe, and the drift check below is
 * what makes an edited cadence — a new weekday, a new hour — take effect within
 * a minute instead of at the next fire.
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
      const schedule = readSummarySchedule(match.automation.schedulePolicy);
      if (!schedule) continue;

      try {
        const occurrence = nextScheduledOccurrence(now, schedule);
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
            dailyTime: schedule.dailyTime,
            timezone: schedule.timezone,
            frequency: schedule.frequency,
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

function errorCode(error: unknown): string {
  return error instanceof Error ? error.message : 'unknown_error';
}
