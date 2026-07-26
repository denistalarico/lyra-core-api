import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { MoreThan, Repository } from 'typeorm';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../../inbox/entities/inbox-message.entity';
import { InboxSettingsEntity } from '../../inbox/entities/inbox-settings.entity';
import { LeadFlowAutomationEntity } from '../entities';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { SendMessageExecutor } from '../executors/send-message.executor';
import {
  SCHEDULER_RUNTIME,
  ScheduledTimerConsumerRegistry,
  type ScheduledTimerConsumer,
  type SchedulerRuntime,
  type TimerFireEnvelope,
} from '../scheduler';
import { LeadFlowAutomationExecutionGate } from './leadflow-automation-execution-gate.service';
import { evaluateBusinessHours } from './leadflow-automation-context-loader.service';

export const LEADFLOW_FOLLOWUP_TIMER_CONSUMER =
  'leadflow.automations.followup' as const;

/**
 * Owns the two timer payloads used by Fase 6:
 * - `idle_detection`: revalidates the conversation and emits the canonical
 *   `conversation.idle` event;
 * - `followup_delivery`: revalidates reply/handoff/stage/autonomy, requests the
 *   Inbox message effect, and schedules the next D+N attempt only after success.
 */
@Injectable()
export class LeadFlowFollowupTimerConsumer
  implements ScheduledTimerConsumer, OnModuleInit
{
  readonly consumerKey = LEADFLOW_FOLLOWUP_TIMER_CONSUMER;

  constructor(
    private readonly registry: ScheduledTimerConsumerRegistry,
    @Inject(SCHEDULER_RUNTIME) private readonly scheduler: SchedulerRuntime,
    private readonly gate: LeadFlowAutomationExecutionGate,
    private readonly sendMessage: SendMessageExecutor,
    @InjectRepository(LeadFlowAutomationEntity, 'agency')
    private readonly automations: Repository<LeadFlowAutomationEntity>,
    @InjectRepository(InboxConversationEntity, 'agency')
    private readonly conversations: Repository<InboxConversationEntity>,
    @InjectRepository(InboxMessageEntity, 'agency')
    private readonly messages: Repository<InboxMessageEntity>,
    @InjectRepository(InboxDomainOutboxEntity, 'agency')
    private readonly outbox: Repository<InboxDomainOutboxEntity>,
    @InjectRepository(CrmOpportunityEntity, 'agency')
    private readonly opportunities: Repository<CrmOpportunityEntity>,
    @InjectRepository(InboxSettingsEntity, 'agency')
    private readonly inboxSettings: Repository<InboxSettingsEntity>,
  ) {}

  onModuleInit(): void {
    this.registry.register(this);
  }

  async handleTimer(envelope: TimerFireEnvelope): Promise<void> {
    const kind = stringField(envelope.payload.kind);
    if (kind === 'idle_detection') {
      await this.detectIdle(envelope);
      return;
    }
    if (kind === 'followup_delivery') {
      await this.deliverFollowup(envelope);
      return;
    }
    throw new Error('followup_timer_payload_invalid');
  }

  private async detectIdle(envelope: TimerFireEnvelope): Promise<void> {
    const automationId = stringField(envelope.payload.automationId);
    const conversationId = stringField(envelope.payload.conversationId);
    const baselineMessageId = stringField(envelope.payload.baselineMessageId);
    const baselineAt = dateField(envelope.payload.baselineAt);
    const idleHours = numberField(envelope.payload.idleHours);
    if (
      !automationId ||
      !conversationId ||
      !baselineMessageId ||
      !baselineAt ||
      idleHours === null
    ) {
      throw new Error('idle_detector_payload_invalid');
    }

    const automation = await this.activeAutomation(
      envelope,
      automationId,
      'followup_idle_lead',
    );
    if (!automation) return;
    const conversation = await this.conversations.findOne({
      where: {
        id: conversationId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
      },
    });
    if (!conversation || isConversationTerminal(conversation)) return;
    if (isHandoff(conversation)) return;

    const latest = await this.messages.findOne({
      where: {
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        conversationId,
      },
      select: { id: true, direction: true, occurredAt: true },
      order: { occurredAt: 'DESC' },
    });
    // A newer interaction supersedes this detector. A later inbound is exactly
    // the stopIfReplied case; a later outbound starts its own detector cycle.
    if (!latest || latest.id !== baselineMessageId) return;
    const replied = await this.messages.exist({
      where: {
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        conversationId,
        direction: 'inbound',
        occurredAt: MoreThan(baselineAt),
      },
    });
    if (replied) return;

    const idempotencyKey =
      `conversation.idle:${automationId}:${baselineMessageId}`.slice(0, 180);
    try {
      await this.outbox.insert(
        this.outbox.create({
          tenantId: envelope.tenantId,
          workspaceId: envelope.workspaceId,
          aggregateType: 'inbox_conversation',
          aggregateId: conversationId,
          eventName: 'leadflow.inbox.conversation.idle',
          eventVersion: 1,
          idempotencyKey,
          payload: {
            conversationId,
            opportunityId: conversation.opportunityId,
            automationId,
            idleSince: baselineAt.toISOString(),
            idleHours,
            baselineMessageId,
            correlationId: envelope.timerId,
          },
          publishedAt: null,
        }) as never,
      );
    } catch (error) {
      // A retried timer may race after the same event was already published.
      // Ignore only the unique idempotency boundary; never reset a published
      // outbox row back to pending through an upsert.
      if (!isUniqueViolation(error)) throw error;
    }
  }

  private async deliverFollowup(envelope: TimerFireEnvelope): Promise<void> {
    const automationId = stringField(envelope.payload.automationId);
    const baselineAt = dateField(envelope.payload.baselineAt);
    const attemptIndex = integerField(envelope.payload.attemptIndex);
    if (!automationId || !baselineAt || attemptIndex === null) {
      throw new Error('followup_delivery_payload_invalid');
    }
    const automation = await this.activeAutomation(
      envelope,
      automationId,
      null,
    );
    if (!automation) return;

    const opportunityId = stringField(envelope.payload.opportunityId);
    let conversationId = stringField(envelope.payload.conversationId);
    let expectedVersion: number | null = null;
    if (opportunityId) {
      const opportunity = await this.opportunities.findOne({
        where: {
          id: opportunityId,
          tenantId: envelope.tenantId,
          workspaceId: envelope.workspaceId,
        },
      });
      if (
        !opportunity ||
        opportunity.status !== 'open' ||
        opportunity.autonomyMode === 'manual'
      ) {
        return;
      }
      const expectedStageId = stringField(envelope.payload.expectedStageId);
      if (expectedStageId && opportunity.stageId !== expectedStageId) return;
      conversationId ??= opportunity.inboxConversationId;
      expectedVersion = opportunity.rowVersion;
    }
    if (!conversationId) return;

    const conversation = await this.conversations.findOne({
      where: {
        id: conversationId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
      },
    });
    if (!conversation || isConversationTerminal(conversation)) return;
    if (
      booleanField(envelope.payload.stopIfHandoff, true) &&
      isHandoff(conversation)
    )
      return;
    if (booleanField(envelope.payload.stopIfReplied, true)) {
      const replied = await this.messages.exist({
        where: {
          tenantId: envelope.tenantId,
          workspaceId: envelope.workspaceId,
          conversationId,
          direction: 'inbound',
          occurredAt: MoreThan(baselineAt),
        },
      });
      if (replied) return;
    }
    const newerOutbound = await this.messages.findOne({
      where: {
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        conversationId,
        direction: 'outbound',
        occurredAt: MoreThan(baselineAt),
      },
      select: { id: true, metadata: true, occurredAt: true },
      order: { occurredAt: 'DESC' },
    });
    // A human/agent intervention (or another automation) supersedes this
    // sequence. Previous sends from this same automation are the expected
    // baseline for D+3/D+7 and therefore keep the chain alive.
    if (
      newerOutbound &&
      stringField(newerOutbound.metadata?.automationId) !== automationId
    ) {
      return;
    }
    if (booleanField(envelope.payload.respectBusinessHours, true)) {
      const settings = await this.inboxSettings.findOne({
        where: {
          tenantId: envelope.tenantId,
          workspaceId: envelope.workspaceId,
        },
        select: { businessHours: true },
      });
      if (
        evaluateBusinessHours(
          settings?.businessHours ?? null,
          new Date(envelope.firedAt),
        ) !== true
      ) {
        return;
      }
    }

    const gate = await this.gate.evaluate({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      automationId,
      actionKeys: ['send_message'],
    });
    if (!gate.allowed) return;

    const result = await this.sendMessage.execute({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      automationId,
      runId: envelope.timerId,
      attemptNumber: attemptIndex + 1,
      actionKey: 'send_message',
      correlationId:
        stringField(envelope.payload.correlationId) ?? envelope.timerId,
      idempotencyKey: effectKey(
        automationId,
        conversationId,
        baselineAt.toISOString(),
        attemptIndex,
      ),
      actorRef:
        stringField(envelope.payload.actorRef) ?? `automation:${automationId}`,
      policyRef:
        stringField(envelope.payload.policyRef) ??
        `followup:${automation.publishedVersionId ?? automation.id}`,
      payload: {
        conversationId,
        text: nullableString(envelope.payload.text),
        templateRef: nullableString(envelope.payload.templateRef),
        templateLanguage:
          nullableString(envelope.payload.templateLanguage) ?? 'pt_BR',
      },
      revalidation: {
        contextSchemaVersion: 1,
        capturedAt: envelope.firedAt,
        subjects: {
          inbox_conversation: conversationId,
          ...(opportunityId ? { crm_opportunity: opportunityId } : {}),
        },
        expectedVersion: expectedVersion ?? conversation.ownershipVersion,
      },
    });
    if (result.status === 'failed') throw new Error('followup_message_failed');
    if (result.status !== 'confirmed') return;

    const offsets = numberList(envelope.payload.attemptOffsetsHours);
    const nextIndex = attemptIndex + 1;
    if (nextIndex >= offsets.length) return;
    const nextAt = new Date(
      baselineAt.getTime() + offsets[nextIndex] * 60 * 60 * 1_000,
    );
    const fireAt = new Date(Math.max(Date.now(), nextAt.getTime()));
    const subjectId = opportunityId ?? conversationId;
    await this.scheduler.schedule({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      timerKey: `followup:${automationId}:${subjectId}:${baselineAt.toISOString()}:${nextIndex + 1}`,
      dedupeScope: automationId,
      fireAt: fireAt.toISOString(),
      purpose: 'automation_followup',
      consumerKey: this.consumerKey,
      payload: {
        ...envelope.payload,
        conversationId,
        attemptIndex: nextIndex,
      },
    });
  }

  private async activeAutomation(
    envelope: TimerFireEnvelope,
    automationId: string,
    recipeKey: string | null,
  ): Promise<LeadFlowAutomationEntity | null> {
    const automation = await this.automations.findOne({
      where: {
        id: automationId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        status: LeadFlowAutomationStatus.Active,
      },
    });
    if (
      !automation ||
      !automation.publishedVersionId ||
      (recipeKey && automation.recipeKey !== recipeKey)
    ) {
      return null;
    }
    return automation;
  }
}

function isConversationTerminal(
  conversation: InboxConversationEntity,
): boolean {
  return (
    conversation.ownershipState === 'closed' ||
    ['resolved', 'closed', 'archived'].includes(conversation.status)
  );
}

function isHandoff(conversation: InboxConversationEntity): boolean {
  return ['handoff_requested', 'human_active'].includes(
    conversation.ownershipState,
  );
}

function effectKey(
  automationId: string,
  conversationId: string,
  baselineAt: string,
  attemptIndex: number,
): string {
  return `followup:${createHash('sha256')
    .update([automationId, conversationId, baselineAt, attemptIndex].join(':'))
    .digest('hex')}`;
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  return stringField(value);
}

function dateField(value: unknown): Date | null {
  const text = stringField(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function integerField(value: unknown): number | null {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0
    ? value
    : null;
}

function booleanField(value: unknown, fallback: boolean): boolean {
  return typeof value === 'boolean' ? value : fallback;
}

function numberList(value: unknown): number[] {
  return Array.isArray(value)
    ? value.filter(
        (item): item is number =>
          typeof item === 'number' && Number.isFinite(item) && item >= 0,
      )
    : [];
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    (error as { code?: string }).code === '23505'
  );
}
