import { Inject, Injectable } from '@nestjs/common';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { SCHEDULER_RUNTIME, type SchedulerRuntime } from '../scheduler';
import { LEADFLOW_FOLLOWUP_TIMER_CONSUMER } from './leadflow-followup-timer.consumer';
import { LeadFlowAutomationTriggerMatcherService } from './leadflow-automation-trigger-matcher.service';

/**
 * Turns a real outbound message into a future idle check.
 *
 * It does not claim that the conversation is idle at scheduling time. The timer
 * consumer re-reads the latest message and emits `conversation.idle` only when
 * the same outbound is still the latest interaction and no inbound followed it.
 */
@Injectable()
export class LeadFlowFollowupIdleDetectorService {
  constructor(
    private readonly matcher: LeadFlowAutomationTriggerMatcherService,
    @Inject(SCHEDULER_RUNTIME) private readonly scheduler: SchedulerRuntime,
  ) {}

  async observeDelivery(
    delivery: LeadFlowEventDeliveryEntity,
  ): Promise<number> {
    if (
      delivery.eventName !== 'leadflow.inbox.conversation.message.sent' ||
      delivery.aggregateType !== 'inbox_conversation'
    ) {
      return 0;
    }
    // Follow-ups schedule their own next D+N attempt after a confirmed send.
    // Observing that same system message would start a second recursive chain.
    if (
      delivery.payload?.authorType === 'system' &&
      typeof delivery.payload.automationId === 'string'
    ) {
      return 0;
    }
    const baselineMessageId =
      typeof delivery.payload?.messageId === 'string'
        ? delivery.payload.messageId
        : null;
    if (!baselineMessageId) return 0;

    const matches = await this.matcher.findMatchingTrigger(
      delivery.tenantId,
      delivery.workspaceId,
      'conversation.idle',
    );
    let scheduled = 0;
    for (const match of matches) {
      if (match.source.status !== LeadFlowAutomationStatus.Active) continue;
      const delayHours = finitePositive(
        match.automation.triggerConfig?.delayHours,
        24,
      );
      const fireAt = new Date(
        delivery.occurredAt.getTime() + delayHours * 60 * 60 * 1_000,
      );
      await this.scheduler.schedule({
        tenantId: delivery.tenantId,
        workspaceId: delivery.workspaceId,
        timerKey: `idle:${match.source.id}:${delivery.aggregateId}:${baselineMessageId}`,
        dedupeScope: match.source.id,
        fireAt: fireAt.toISOString(),
        purpose: 'automation_followup',
        consumerKey: LEADFLOW_FOLLOWUP_TIMER_CONSUMER,
        payload: {
          kind: 'idle_detection',
          automationId: match.source.id,
          conversationId: delivery.aggregateId,
          baselineMessageId,
          baselineAt: delivery.occurredAt.toISOString(),
          idleHours: delayHours,
        },
      });
      scheduled += 1;
    }
    return scheduled;
  }
}

function finitePositive(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}
