import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { LeadFlowAutomationEntity } from '../entities';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import {
  SCHEDULER_RUNTIME,
  ScheduledTimerConsumerRegistry,
  type ScheduledTimerConsumer,
  type SchedulerRuntime,
  type TimerFireEnvelope,
} from '../scheduler';
import {
  dailyOccurrenceForDate,
  nextScheduledOccurrence,
  previousScheduledOccurrence,
  readSummarySchedule,
  type SummarySchedule,
} from './leadflow-daily-schedule';

export const LEADFLOW_DAILY_SUMMARY_TIMER_CONSUMER =
  'leadflow.automations.daily-summary' as const;

/**
 * Revalidates a summary schedule, emits its canonical trigger and chains the
 * next timer. The outbox idempotency key makes an at-least-once timer fire
 * produce at most one automation delivery for the occurrence.
 *
 * The cadence in force is read from the automation row rather than from the
 * timer payload, so an operator who switches from daily to weekly does not get
 * one last delivery under the old rule.
 */
@Injectable()
export class LeadFlowDailySummaryTimerConsumer
  implements ScheduledTimerConsumer, OnModuleInit
{
  readonly consumerKey = LEADFLOW_DAILY_SUMMARY_TIMER_CONSUMER;

  constructor(
    private readonly registry: ScheduledTimerConsumerRegistry,
    @Inject(SCHEDULER_RUNTIME) private readonly scheduler: SchedulerRuntime,
    @InjectRepository(LeadFlowAutomationEntity, 'agency')
    private readonly automations: Repository<LeadFlowAutomationEntity>,
    @InjectRepository(InboxDomainOutboxEntity, 'agency')
    private readonly outbox: Repository<InboxDomainOutboxEntity>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handleTimer(envelope: TimerFireEnvelope): Promise<void> {
    const automationId = stringField(envelope.payload.automationId);
    const localDate = stringField(envelope.payload.localDate);
    const dailyTime = stringField(envelope.payload.dailyTime);
    const timezone = stringField(envelope.payload.timezone);
    const scheduledFor =
      stringField(envelope.payload.scheduledFor) ?? envelope.firedAt;
    if (!automationId || !localDate || !dailyTime || !timezone) {
      throw new Error('daily_summary_timer_payload_invalid');
    }

    const automation = await this.automations.findOne({
      where: {
        id: automationId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
      },
    });
    if (
      !automation ||
      automation.status !== LeadFlowAutomationStatus.Active ||
      automation.recipeKey !== 'daily_opportunity_summary' ||
      !automation.publishedVersionId
    ) {
      return;
    }

    const schedule: SummarySchedule = readSummarySchedule(
      automation.schedulePolicy,
    ) ?? { frequency: 'daily', dailyTime, timezone };
    const period = previousScheduledOccurrence(
      dailyOccurrenceForDate(localDate, schedule.dailyTime, schedule.timezone),
      schedule,
    );

    await this.outbox
      .createQueryBuilder()
      .insert()
      .values(
        this.outbox.create({
          tenantId: envelope.tenantId,
          workspaceId: envelope.workspaceId,
          aggregateType: 'leadflow_automation',
          aggregateId: automationId,
          eventName: 'leadflow.automations.schedule.daily',
          eventVersion: 1,
          idempotencyKey: `schedule.daily:${automationId}:${localDate}`,
          payload: {
            automationId,
            scheduledFor,
            localDate,
            timezone: schedule.timezone,
            frequency: schedule.frequency,
            periodStart: period.fireAt.toISOString(),
            periodEnd: scheduledFor,
          },
          publishedAt: null,
        }) as never,
      )
      .orIgnore()
      .execute();

    // Do not replay a long backlog one occurrence at a time after an outage.
    // The durable current fire is honored, then recurrence resumes at the next
    // future wall-clock occurrence.
    const next = nextScheduledOccurrence(new Date(envelope.firedAt), schedule);
    await this.scheduler.schedule({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      timerKey: `daily-summary:${automationId}:${next.localDate}`,
      dedupeScope: automationId,
      fireAt: next.fireAt.toISOString(),
      purpose: 'automation_daily_summary',
      consumerKey: LEADFLOW_DAILY_SUMMARY_TIMER_CONSUMER,
      payload: {
        automationId,
        localDate: next.localDate,
        dailyTime: schedule.dailyTime,
        timezone: schedule.timezone,
        frequency: schedule.frequency,
        scheduledFor: next.fireAt.toISOString(),
      },
    });
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
