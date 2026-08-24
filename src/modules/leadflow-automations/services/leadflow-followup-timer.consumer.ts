import { Inject, Injectable, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { createHash } from 'node:crypto';
import { MoreThan, Repository } from 'typeorm';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import {
  readOpportunityFollowUp,
  writeOpportunityFollowUp,
  type CrmOpportunityFollowUpAttempt,
  type CrmOpportunityFollowUpState,
} from '../../crm/services/crm-opportunity-follow-up';
import { InboxChannelEntity } from '../../inbox/entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../../inbox/entities/inbox-message.entity';
import { InboxSettingsEntity } from '../../inbox/entities/inbox-settings.entity';
import { hasLeadFlowOutboundOptOut } from '../../inbox/services/leadflow-contact-opt-out';
import { FOLLOWUP_IDLE_LEAD_RECIPE_KEY } from '../catalog/automation-recipes.catalog';
import {
  enabledFollowupSteps,
  FOLLOWUP_STEP_KEYS,
  isFollowupStepKey,
  isInConversationStep,
  type FollowupPlanStep,
  type FollowupStepKey,
} from '../catalog/followup-plan.catalog';
import { LeadFlowAutomationEntity } from '../entities';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { SendMessageExecutor } from '../executors/send-message.executor';
import type {
  LeadFlowFollowupChannel,
  LeadFlowFollowupChannelConfig,
  LeadFlowFollowupChannelResult,
  LeadFlowFollowupStepConfig,
} from '../types/leadflow-automation.types';
import { resolveFollowupSendAt } from './followup-quiet-hours';
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
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly inboxChannels: Repository<InboxChannelEntity>,
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
      null,
    );
    if (!automation || automation.recipeKey !== FOLLOWUP_IDLE_LEAD_RECIPE_KEY) {
      return;
    }
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
    let followUp: CrmOpportunityFollowUpState | null = null;
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
      // The card's own switch. Turning it off stops the chain for this
      // opportunity only — every other one the automation governs is untouched.
      followUp = readOpportunityFollowUp(opportunity);
      if (followUp.mode === 'disabled') {
        await this.clearNextFollowUp(envelope, opportunityId);
        return;
      }
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
    ) {
      // Handoff already stops the send below; this only retracts the "próximo
      // follow" the card shows. The ownership transition itself clears it the
      // instant handoff happens — this is the fallback for a timer armed
      // before that fix, or one that outlives a retry.
      if (opportunityId) await this.clearNextFollowUp(envelope, opportunityId);
      return;
    }
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
    // Which plan governs this fire, and which attempt of it this is. The
    // canonical cadence is addressed by name, so a plan edited mid-chain — an
    // attempt switched off on the card — moves the chain instead of breaking it.
    const canonical =
      stringField(envelope.payload.automationRecipeKey) ===
      FOLLOWUP_IDLE_LEAD_RECIPE_KEY;
    const plan = canonical
      ? enabledFollowupSteps(
          followUp?.mode === 'manual'
            ? followUp.steps
            : envelope.payload.followupSteps,
        )
      : [];
    const currentKey = canonical
      ? isFollowupStepKey(envelope.payload.stepKey)
        ? envelope.payload.stepKey
        : (plan[attemptIndex]?.stepKey ?? null)
      : null;
    const step = canonical
      ? (plan.find((item) => item.stepKey === currentKey) ?? null)
      : (followupSteps(envelope.payload.followupSteps)[attemptIndex] ?? null);
    if (canonical && !currentKey) return;

    // Quiet hours move an attempt, they never delete it. Returning here — which
    // is what the business-hours check used to do — dropped this attempt *and*
    // every one after it, because the next is only scheduled once this one runs.
    // An attempt that is no longer in the plan has nothing to hold back: it
    // skips straight to the hand-over below, and holding it against a stale
    // offset would park the whole chain on an attempt that will never send.
    if (!canonical || step) {
      const firedAt = new Date(envelope.firedAt);
      const dueMinutes = step
        ? step.delayMinutes
        : (numberList(envelope.payload.attemptOffsetsHours)[attemptIndex] ??
            0) * 60;
      // A chain armed before the cadence had names carries offsets instead of a
      // plan; with neither, the fire itself is the best due time there is. What
      // must not happen is a lead hearing from us at three in the morning
      // because the payload was too old to say when the attempt was due.
      const dueAt = dueMinutes
        ? new Date(baselineAt.getTime() + dueMinutes * 60 * 1_000)
        : firedAt;
      const sendAt = resolveFollowupSendAt({
        dueAt,
        now: firedAt,
        timeZone: await this.resolveTimeZone(envelope),
        respectQuietHours: booleanField(
          envelope.payload.respectBusinessHours,
          true,
        ),
        allowAnticipation:
          canonical && step !== null && isInConversationStep(step.stepKey),
      });
      if (sendAt.getTime() > firedAt.getTime() + 60 * 1_000) {
        await this.deferAttempt(envelope, sendAt);
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

    const channelConfigs = await this.resolveChannelConfigs({
      envelope,
      canonical,
      step,
      conversation,
    });
    const lastInbound = await this.messages.findOne({
      where: {
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
        conversationId,
        direction: 'inbound',
      },
      select: { id: true, occurredAt: true },
      order: { occurredAt: 'DESC' },
    });
    const insideMessagingWindow =
      lastInbound !== null &&
      new Date(envelope.firedAt).getTime() - lastInbound.occurredAt.getTime() <
        24 * 60 * 60 * 1_000;
    let failedProviders = 0;

    // What this attempt says. Inside the conversation it is the agent's
    // proposal (or, on a card in manual mode, what the person wrote); an
    // attempt that leaves the window is a template and carries no free text.
    const text = resolveAttemptText({
      canonical,
      step,
      followUp,
      fallback: nullableString(envelope.payload.text),
    });
    // A lead who wrote "parar" asked for automated messages to stop, and every
    // attempt of this cadence is one. The check used to belong to the
    // reactivation recipe alone; the cadence inherited its job when that recipe
    // was retired, and applying it to the whole plan is the reading of consent
    // that does not need a rule about which attempt counts.
    const optedOut = hasLeadFlowOutboundOptOut(conversation);

    for (const channelConfig of channelConfigs) {
      let channelResult: LeadFlowFollowupChannelResult;
      let reference: string | null = null;
      const outsideUnsupported = [
        'facebook_messenger',
        'instagram_direct',
        'webchat',
      ].includes(channelConfig.channel);

      if (optedOut) {
        channelResult = 'skipped_contact_opt_out';
      } else if (
        canonical &&
        step &&
        isInConversationStep(step.stepKey) &&
        !text
      ) {
        // Manual mode with nothing written yet: there is no message to send,
        // and the default copy is not this card's voice to borrow.
        channelResult = 'skipped_message_unavailable';
      } else if (!insideMessagingWindow && outsideUnsupported) {
        channelResult = 'skipped_outside_messaging_window';
      } else if (
        !insideMessagingWindow &&
        channelConfig.channel === 'whatsapp' &&
        channelConfig.whatsappTemplate?.status === 'language_mismatch'
      ) {
        channelResult = 'skipped_template_language_mismatch';
      } else if (
        !insideMessagingWindow &&
        channelConfig.channel === 'whatsapp' &&
        channelConfig.whatsappTemplate?.status === 'components_unsupported'
      ) {
        channelResult = 'skipped_template_components_unsupported';
      } else if (
        !insideMessagingWindow &&
        channelConfig.channel === 'whatsapp' &&
        ['not_found', 'not_approved'].includes(
          channelConfig.whatsappTemplate?.status ?? '',
        )
      ) {
        channelResult = 'skipped_template_invalid';
      } else if (
        !insideMessagingWindow &&
        channelConfig.channel === 'whatsapp' &&
        !channelConfig.outsideWindowEnabled
      ) {
        channelResult = 'skipped_template_required';
      } else if (
        !insideMessagingWindow &&
        channelConfig.channel === 'whatsapp' &&
        !channelConfig.whatsappTemplate?.providerTemplateName.trim()
      ) {
        channelResult = 'skipped_template_required';
      } else {
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
            channelConfig.channel,
          ),
          actorRef:
            stringField(envelope.payload.actorRef) ??
            `automation:${automationId}`,
          policyRef:
            stringField(envelope.payload.policyRef) ??
            `followup:${automation.publishedVersionId ?? automation.id}`,
          payload: {
            conversationId,
            // Only the no-show recovery carries one, and it is what lets the
            // recovery message name the commitment it is recovering.
            appointmentId: stringField(envelope.payload.appointmentId),
            channel: channelConfig.channel,
            connectionRef: channelConfig.connectionRef ?? null,
            text,
            templateRef:
              channelConfig.whatsappTemplate?.providerTemplateName ??
              nullableString(envelope.payload.templateRef),
            templateLanguage:
              channelConfig.whatsappTemplate?.languageCode ??
              nullableString(envelope.payload.templateLanguage) ??
              'pt_BR',
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
        reference = result.reference ?? null;
        channelResult = mapChannelResult(result);
        if (channelResult === 'failed_provider') failedProviders += 1;
      }

      const stepKey = step?.stepKey ?? `legacy_${attemptIndex + 1}`;
      await this.recordChannelResult({
        envelope,
        automationId,
        conversationId,
        stepKey,
        channel: channelConfig.channel,
        result: channelResult,
        reference,
      });
      // The event above is the log; this is the state the board reads. Without
      // it, "o follow foi enviado?" could only be answered by replaying events.
      if (opportunityId) {
        await this.recordAttemptOnCard({
          envelope,
          opportunityId,
          attempt: {
            stepKey,
            result: channelResult,
            channel: channelConfig.channel,
            at: envelope.firedAt,
            runId: envelope.timerId,
          },
        });
      }
    }

    if (
      channelConfigs.length > 0 &&
      failedProviders === channelConfigs.length
    ) {
      throw new Error('followup_message_failed');
    }

    // The next attempt is resolved by name against the plan in force, not by
    // walking a frozen list of offsets: an attempt switched off mid-chain must
    // hand over to the one after it, not end the sequence.
    const next = canonical
      ? nextPlanStep(plan, currentKey)
      : legacyNextStep(envelope.payload, attemptIndex);
    if (!next) {
      if (opportunityId) await this.clearNextFollowUp(envelope, opportunityId);
      return;
    }

    const nextDueAt = new Date(
      baselineAt.getTime() + next.delayMinutes * 60 * 1_000,
    );
    const fireAt = resolveFollowupSendAt({
      dueAt: nextDueAt,
      now: new Date(),
      timeZone: await this.resolveTimeZone(envelope),
      respectQuietHours: booleanField(
        envelope.payload.respectBusinessHours,
        true,
      ),
      allowAnticipation: canonical && isInConversationStep(next.stepKey),
    });
    const nextIndex = canonical
      ? plan.findIndex((item) => item.stepKey === next.stepKey)
      : attemptIndex + 1;
    const subjectId = opportunityId ?? conversationId;
    await this.scheduler.schedule({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      timerKey: `followup:${automationId}:${subjectId}:${baselineAt.toISOString()}:${next.stepKey}`,
      dedupeScope: automationId,
      fireAt: fireAt.toISOString(),
      purpose: 'automation_followup',
      consumerKey: this.consumerKey,
      payload: {
        ...envelope.payload,
        conversationId,
        attemptIndex: nextIndex,
        stepKey: next.stepKey,
      },
    });
    // What the card shows as "próximo follow-up". Nothing else writes it, and
    // it is a projection of the timer above — not a governed decision.
    if (opportunityId) {
      await this.opportunities.update(
        {
          id: opportunityId,
          tenantId: envelope.tenantId,
          workspaceId: envelope.workspaceId,
        },
        { nextFollowUpAt: fireAt },
      );
    }
  }

  /** Re-arms this same attempt for the first instant it may reach the lead. */
  private async deferAttempt(
    envelope: TimerFireEnvelope,
    sendAt: Date,
  ): Promise<void> {
    await this.scheduler.schedule({
      tenantId: envelope.tenantId,
      workspaceId: envelope.workspaceId,
      // The instant is part of the key, so a repeated deferral to the same
      // moment is the same timer rather than a second one.
      timerKey: `${envelope.timerKey}:defer:${sendAt.toISOString()}`.slice(
        0,
        180,
      ),
      dedupeScope:
        stringField(envelope.payload.automationId) ?? envelope.timerId,
      fireAt: sendAt.toISOString(),
      purpose: envelope.purpose,
      consumerKey: this.consumerKey,
      payload: envelope.payload,
    });
  }

  /** The zone the quiet-hours envelope is read in. */
  private async resolveTimeZone(envelope: TimerFireEnvelope): Promise<string> {
    const configured = stringField(envelope.payload.timezone);
    if (configured) return configured;
    const settings = await this.inboxSettings.findOne({
      where: {
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
      },
      select: { businessHours: true },
    });
    const businessHours = settings?.businessHours ?? null;
    const timezone =
      businessHours && typeof businessHours.timezone === 'string'
        ? businessHours.timezone
        : null;
    return timezone ?? 'America/Sao_Paulo';
  }

  /**
   * Keeps the outcome of one attempt on the opportunity.
   *
   * Read-modify-write on the jsonb bag, so it re-reads the row rather than
   * trusting the copy loaded before the send: the attempt may have taken a
   * while, and the agent may have written its drafts in between.
   */
  private async recordAttemptOnCard(input: {
    envelope: TimerFireEnvelope;
    opportunityId: string;
    attempt: CrmOpportunityFollowUpAttempt;
  }): Promise<void> {
    const scope = {
      id: input.opportunityId,
      tenantId: input.envelope.tenantId,
      workspaceId: input.envelope.workspaceId,
    };
    const opportunity = await this.opportunities.findOne({ where: scope });
    if (!opportunity) return;
    writeOpportunityFollowUp(opportunity, { attempt: input.attempt });
    await this.opportunities.update(scope, {
      metadata: opportunity.metadata as never,
    });
  }

  private async clearNextFollowUp(
    envelope: TimerFireEnvelope,
    opportunityId: string,
  ): Promise<void> {
    await this.opportunities.update(
      {
        id: opportunityId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
      },
      { nextFollowUpAt: null },
    );
  }

  /**
   * The channels one attempt actually goes out on.
   *
   * d0 and d1 answer inside the conversation the lead opened, so they carry no
   * channel of their own — offering the choice is what would let a lead who
   * wrote on Instagram be answered on WhatsApp. d3 and d7 have left the window
   * and need a transport that can start a conversation, which is the channel
   * list the operator configured.
   */
  private async resolveChannelConfigs(input: {
    envelope: TimerFireEnvelope;
    canonical: boolean;
    step: { stepKey: string; channels: LeadFlowFollowupChannelConfig[] } | null;
    conversation: InboxConversationEntity;
  }): Promise<LeadFlowFollowupChannelConfig[]> {
    const { envelope, canonical, step, conversation } = input;
    // No step in a named cadence means this attempt was switched off after the
    // timer was armed: nothing goes out, and the chain moves on to the next.
    if (!step) return canonical ? [] : [legacyWhatsappConfig(envelope.payload)];
    if (!canonical || !isInConversationStep(step.stepKey)) {
      return step.channels.filter((item) => item.enabled);
    }
    if (!conversation.channelId) return [];
    const channel = await this.inboxChannels.findOne({
      where: {
        id: conversation.channelId,
        tenantId: envelope.tenantId,
        workspaceId: envelope.workspaceId,
      },
      select: { id: true, type: true },
    });
    const mapped = channel ? mapInboxChannelType(channel.type) : null;
    if (!mapped) return [];
    return [
      {
        channel: mapped,
        enabled: true,
        outsideWindowEnabled: false,
        connectionRef: channel!.id,
      },
    ];
  }

  private async recordChannelResult(input: {
    envelope: TimerFireEnvelope;
    automationId: string;
    conversationId: string;
    stepKey: string;
    channel: string;
    result: LeadFlowFollowupChannelResult;
    reference: string | null;
  }): Promise<void> {
    const idempotencyKey =
      `followup.result:${input.envelope.timerId}:${input.stepKey}:${input.channel}`.slice(
        0,
        180,
      );
    try {
      await this.outbox.insert(
        this.outbox.create({
          tenantId: input.envelope.tenantId,
          workspaceId: input.envelope.workspaceId,
          aggregateType: 'inbox_conversation',
          aggregateId: input.conversationId,
          eventName: 'leadflow.automations.followup.channel_result',
          eventVersion: 1,
          idempotencyKey,
          payload: {
            automationId: input.automationId,
            timerId: input.envelope.timerId,
            stepKey: input.stepKey,
            channel: input.channel,
            result: input.result,
            reference: input.reference,
          },
          publishedAt: null,
        }) as never,
      );
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
    }
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

/** The next enabled attempt after `currentKey`, in cadence order. */
function nextPlanStep(
  plan: FollowupPlanStep[],
  currentKey: FollowupStepKey | null,
): { stepKey: string; delayMinutes: number } | null {
  if (!currentKey) return null;
  const current = FOLLOWUP_STEP_KEYS.indexOf(currentKey);
  return (
    plan.find((step) => FOLLOWUP_STEP_KEYS.indexOf(step.stepKey) > current) ??
    null
  );
}

/**
 * The chain of a recipe that still declares its cadence as a list of offsets.
 * The step key reproduces the 1-based position the timer keys already use, so
 * a chain armed before this change keeps its identity and is not duplicated.
 */
function legacyNextStep(
  payload: Record<string, unknown>,
  attemptIndex: number,
): { stepKey: string; delayMinutes: number } | null {
  const offsets = numberList(payload.attemptOffsetsHours);
  const nextIndex = attemptIndex + 1;
  if (nextIndex >= offsets.length) return null;
  return {
    stepKey: String(nextIndex + 1),
    delayMinutes: offsets[nextIndex] * 60,
  };
}

/**
 * The words this attempt goes out with.
 *
 * Only the attempts that answer inside the conversation carry free text. On an
 * automatic card that text is what the agent proposed while reading the
 * conversation, falling back to the recipe's default copy; on a manual card it
 * is only what the person wrote — borrowing the default would put words in
 * their mouth.
 */
function resolveAttemptText(input: {
  canonical: boolean;
  step: { stepKey: string } | null;
  followUp: CrmOpportunityFollowUpState | null;
  fallback: string | null;
}): string | null {
  const { canonical, step, followUp, fallback } = input;
  if (!canonical || !step || !isInConversationStep(step.stepKey)) {
    return fallback;
  }
  const proposed =
    step.stepKey === 'd0' ? followUp?.texts.d0 : followUp?.texts.d1;
  if (followUp?.mode === 'manual') return proposed ?? null;
  return proposed ?? fallback;
}

function mapInboxChannelType(type: string): LeadFlowFollowupChannel | null {
  if (type === 'instagram') return 'instagram_direct';
  return ['whatsapp', 'email', 'sms', 'facebook_messenger', 'webchat'].includes(
    type,
  )
    ? (type as LeadFlowFollowupChannel)
    : null;
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
  channel: string,
): string {
  return `followup:${createHash('sha256')
    .update(
      [automationId, conversationId, baselineAt, attemptIndex, channel].join(
        ':',
      ),
    )
    .digest('hex')}`;
}

function followupSteps(value: unknown): LeadFlowFollowupStepConfig[] {
  if (!Array.isArray(value)) return [];
  return value.filter(
    (step: unknown): step is LeadFlowFollowupStepConfig =>
      typeof step === 'object' &&
      step !== null &&
      'stepKey' in step &&
      typeof step.stepKey === 'string' &&
      'delayMinutes' in step &&
      typeof step.delayMinutes === 'number' &&
      'channels' in step &&
      Array.isArray(step.channels),
  );
}

function legacyWhatsappConfig(
  payload: Record<string, unknown>,
): LeadFlowFollowupChannelConfig {
  const templateRef = nullableString(payload.templateRef);
  return {
    channel: 'whatsapp',
    enabled: true,
    outsideWindowEnabled: Boolean(templateRef),
    connectionRef: null,
    ...(templateRef
      ? {
          whatsappTemplate: {
            providerTemplateName: templateRef,
            languageCode: nullableString(payload.templateLanguage) ?? 'pt_BR',
            status: 'pending_validation' as const,
          },
        }
      : {}),
  };
}

function mapChannelResult(result: {
  status: string;
  errorCode?: string;
}): LeadFlowFollowupChannelResult {
  if (result.status === 'confirmed') return 'sent';
  if (result.status === 'failed') return 'failed_provider';
  switch (result.errorCode) {
    case 'whatsapp_template_required':
      return 'skipped_template_required';
    case 'whatsapp_template_language_mismatch':
      return 'skipped_template_language_mismatch';
    case 'whatsapp_template_components_unsupported':
      return 'skipped_template_components_unsupported';
    case 'whatsapp_template_invalid':
      return 'skipped_template_invalid';
    case 'message_conversation_not_found':
      return 'skipped_recipient_unavailable';
    default:
      return 'skipped_channel_unavailable';
  }
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
