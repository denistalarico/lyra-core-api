import { Inject, Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { LeadFlowCsatService } from '../../leadflow-analytics/services/leadflow-csat.service';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { InboxChannelEntity } from '../../inbox/entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { hasLeadFlowOutboundOptOut } from '../../inbox/services/leadflow-contact-opt-out';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { SCHEDULER_RUNTIME, type SchedulerRuntime } from '../scheduler';
import { LEADFLOW_CSAT_EXPIRY_TIMER_CONSUMER } from '../services/leadflow-csat-expiry-timer.consumer';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';
import { SendMessageExecutor } from './send-message.executor';

@Injectable()
export class RequestCsatExecutor implements AutomationExecutor {
  readonly actionKey = 'request_csat';

  constructor(
    private readonly sendMessage: SendMessageExecutor,
    private readonly csat: LeadFlowCsatService,
    @Inject(SCHEDULER_RUNTIME) private readonly scheduler: SchedulerRuntime,
    @InjectRepository(CrmOpportunityEntity, 'agency')
    private readonly opportunities: Repository<CrmOpportunityEntity>,
    @InjectRepository(InboxConversationEntity, 'agency')
    private readonly conversations: Repository<InboxConversationEntity>,
    @InjectRepository(InboxChannelEntity, 'agency')
    private readonly channels: Repository<InboxChannelEntity>,
  ) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const opportunityId = stringField(request.payload.opportunityId);
    if (!opportunityId) return refused('csat_opportunity_required');

    const opportunity = await this.opportunities.findOne({
      where: {
        id: opportunityId,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
      },
    });
    if (!opportunity || opportunity.status !== 'won') {
      return refused('csat_opportunity_not_won');
    }
    if (!opportunity.inboxConversationId) {
      return refused('csat_conversation_unavailable');
    }
    const conversation = await this.conversations.findOne({
      where: {
        id: opportunity.inboxConversationId,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
      },
    });
    if (!conversation) return refused('csat_conversation_unavailable');
    if (hasLeadFlowOutboundOptOut(conversation)) {
      return refused('csat_contact_opted_out');
    }

    // The request goes out on the channel the lead already used. Asking the
    // operator to pick one could only ever produce the wrong answer: a lead who
    // wrote on Instagram is not reachable — and must not be answered — on
    // WhatsApp. When the transport for that channel is not implemented yet the
    // send refuses, which is the honest outcome; it is never rerouted.
    const channel = await this.resolveConversationChannel(
      request.tenantId,
      request.workspaceId,
      conversation.channelId,
    );
    if (!channel) return refused('csat_channel_unavailable');

    const sendResult = await this.sendMessage.execute({
      ...request,
      actionKey: 'send_message',
      idempotencyKey: `${request.idempotencyKey}:message`,
      payload: {
        conversationId: conversation.id,
        channel,
        text: stringField(request.payload.text),
        templateRef: stringField(request.payload.templateRef),
        templateLanguage:
          stringField(request.payload.templateLanguage) ?? 'pt_BR',
      },
    });
    if (sendResult.status !== 'confirmed' || !sendResult.reference) {
      return sendResult;
    }

    const requestedAt = new Date();
    const responseWindowHours = positiveNumber(
      request.payload.responseWindowHours,
      168,
    );
    const expiresAt = new Date(
      requestedAt.getTime() + responseWindowHours * 60 * 60 * 1_000,
    );
    try {
      const response = await this.csat.startCycle({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        automationId: request.automationId,
        idempotencyKey: request.idempotencyKey,
        requestSourceEventId: request.runId,
        requestMessageId: sendResult.reference,
        requestedAt,
        expiresAt,
        contactId: opportunity.contactId,
        conversationId: conversation.id,
        opportunityId: opportunity.id,
      });
      const cycleExpiresAt = response.expiresAt ?? expiresAt;
      await this.scheduler.schedule({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        timerKey: `csat-expiry:${response.id}`,
        dedupeScope: request.automationId,
        fireAt: cycleExpiresAt.toISOString(),
        purpose: 'generic',
        consumerKey: LEADFLOW_CSAT_EXPIRY_TIMER_CONSUMER,
        payload: {
          responseId: response.id,
          automationId: request.automationId,
        },
      });
      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: response.id,
        details: {
          requestMessageId: sendResult.reference,
          expiresAt: cycleExpiresAt.toISOString(),
          scale: '1-5',
        },
      };
    } catch {
      return {
        status: 'failed',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Transient,
        errorCode: 'csat_cycle_persistence_failed',
        errorMessage: 'O ciclo de avaliação não pôde ser persistido.',
        reference: null,
      };
    }
  }

  /**
   * The conversation's own channel, in the vocabulary the message transport
   * speaks. `instagram` is the only name that differs between the Inbox channel
   * catalogue and the message channel enum; the rest are the same word.
   */
  private async resolveConversationChannel(
    tenantId: string,
    workspaceId: string,
    channelId: string | null,
  ): Promise<string | null> {
    if (!channelId) return null;
    const channel = await this.channels.findOne({
      where: { id: channelId, tenantId, workspaceId },
    });
    if (!channel) return null;
    return channel.type === 'instagram' ? 'instagram_direct' : channel.type;
  }
}

function refused(errorCode: string): AutomationEffectResult {
  return {
    status: 'refused',
    effectConfirmed: false,
    errorClass: LeadFlowAutomationErrorClass.Permanent,
    errorCode,
    errorMessage: 'A avaliação não foi solicitada no estado atual.',
    reference: null,
  };
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function positiveNumber(value: unknown, fallback: number): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0
    ? value
    : fallback;
}
