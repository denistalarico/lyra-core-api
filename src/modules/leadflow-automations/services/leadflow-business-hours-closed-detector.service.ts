import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { LeadFlowEventDeliveryEntity } from '../../leadflow-events/entities';
import { InboxConversationEntity } from '../../inbox/entities/inbox-conversation.entity';
import { InboxDomainOutboxEntity } from '../../inbox/entities/inbox-domain-outbox.entity';
import { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import { OUTSIDE_BUSINESS_HOURS_RECIPE_KEY } from '../catalog/automation-recipes.catalog';
import {
  normalizeBusinessHoursSchedule,
  resolveClosedWindowStart,
  type BusinessHoursSchedule,
} from './business-hours-schedule';
import { evaluateBusinessHours } from './leadflow-automation-context-loader.service';
import { LeadFlowWorkspaceBusinessHoursService } from './leadflow-workspace-business-hours.service';

const AGENCY_CONNECTION = 'agency';
const HANDOFF_EVENT = 'leadflow.inbox.conversation.handoff.requested';
const INBOUND_EVENT = 'leadflow.inbox.conversation.message.received';
const CLOSED_EVENT = 'leadflow.inbox.business_hours.closed';

/** Why nobody is going to answer this conversation right now. */
type ClosedCause = 'handoff' | 'unattended';

/**
 * Derives the outside-hours signal from the two moments where nobody answers.
 *
 * A lead is left waiting in exactly two ways. Either they asked for a human —
 * the canonical handoff request, which by definition means the agent has
 * stepped aside — or they wrote into a channel where no agent picked the
 * conversation up at all: no published agent bound to it, AI disabled, a
 * keyword rule that did not match. The Inbox has already made that decision by
 * the time the message event is published, and it is written on the
 * conversation: `ai_active` means the agent is answering and the canned reply
 * would be talking over it.
 *
 * Being outside hours is judged against the schedule that automation itself
 * carries, falling back to the workspace's. It refuses to guess when neither is
 * configured, and writes a canonical outbox event keyed by the conversation and
 * the current closed stretch — so four messages at midnight, or a handoff
 * followed by a message, are one derivation and one reply.
 */
@Injectable()
export class LeadFlowBusinessHoursClosedDetectorService {
  constructor(
    private readonly workspaceHours: LeadFlowWorkspaceBusinessHoursService,
    @InjectRepository(InboxDomainOutboxEntity, AGENCY_CONNECTION)
    private readonly outbox: Repository<InboxDomainOutboxEntity>,
    @InjectRepository(InboxConversationEntity, AGENCY_CONNECTION)
    private readonly conversations: Repository<InboxConversationEntity>,
    @InjectRepository(LeadFlowAutomationEntity, AGENCY_CONNECTION)
    private readonly automations: Repository<LeadFlowAutomationEntity>,
  ) {}

  async observeDelivery(delivery: LeadFlowEventDeliveryEntity): Promise<void> {
    if (delivery.aggregateType !== 'inbox_conversation') return;
    const cause = causeOf(delivery.eventName);
    if (!cause) return;

    // The agent is mid-conversation: it answers, and it answers better than a
    // fixed sentence would. Only a conversation nobody is holding is ours.
    if (cause === 'unattended' && (await this.agentIsAnswering(delivery))) {
      return;
    }

    const schedule = await this.resolveSchedule(delivery);
    if (!schedule) return;

    const evaluatedAt = new Date();
    if (evaluateBusinessHours({ ...schedule }, evaluatedAt) !== false) return;

    await this.outbox
      .createQueryBuilder()
      .insert()
      .values({
        tenantId: delivery.tenantId,
        workspaceId: delivery.workspaceId,
        aggregateType: 'inbox_conversation',
        aggregateId: delivery.aggregateId,
        eventName: CLOSED_EVENT,
        eventVersion: 1,
        idempotencyKey: this.idempotencyKey(delivery, schedule, evaluatedAt),
        payload: {
          conversationId: delivery.aggregateId,
          reason: cause,
          // Only a derivation that came from a handoff has one to point at.
          ...(cause === 'handoff'
            ? { handoffEventId: delivery.sourceEventId }
            : {}),
          handoffCycle:
            typeof delivery.payload.ownershipVersion === 'number'
              ? delivery.payload.ownershipVersion
              : 'unknown',
          timezone: schedule.timezone,
          evaluatedAt: evaluatedAt.toISOString(),
        },
        publishedAt: null,
      })
      .orIgnore()
      .execute();
  }

  /** One derivation per conversation per closed stretch. */
  private idempotencyKey(
    delivery: LeadFlowEventDeliveryEntity,
    schedule: BusinessHoursSchedule,
    evaluatedAt: Date,
  ): string {
    const windowStart = resolveClosedWindowStart(schedule, evaluatedAt);
    // A schedule with no closing time to point at — every day off — has no
    // stretch to deduplicate against. Falling back to the source event keeps the
    // old one-per-event behaviour rather than answering once and never again.
    return windowStart
      ? `business-hours-closed:${delivery.aggregateId}:${windowStart.toISOString()}`
      : `business-hours-closed:${delivery.sourceEventId}`;
  }

  private async agentIsAnswering(
    delivery: LeadFlowEventDeliveryEntity,
  ): Promise<boolean> {
    const conversation = await this.conversations.findOne({
      where: {
        id: delivery.aggregateId,
        tenantId: delivery.tenantId,
        workspaceId: delivery.workspaceId,
      },
      select: { id: true, ownershipState: true },
    });
    return conversation?.ownershipState === 'ai_active';
  }

  /**
   * The schedule this decision is made against.
   *
   * The automation's own comes first: an operator who set custom hours there
   * did it precisely to disagree with the workspace, and a signal derived from
   * the workspace hours would silently overrule them.
   */
  private async resolveSchedule(
    delivery: LeadFlowEventDeliveryEntity,
  ): Promise<BusinessHoursSchedule | null> {
    const automation = await this.automations.findOne({
      where: {
        tenantId: delivery.tenantId,
        workspaceId: delivery.workspaceId,
        recipeKey: OUTSIDE_BUSINESS_HOURS_RECIPE_KEY,
      },
      select: { id: true, schedulePolicy: true },
    });
    const custom = normalizeBusinessHoursSchedule(
      automation?.schedulePolicy?.businessHours,
    );
    if (custom) return custom;

    return this.workspaceHours.getSchedule({
      tenantId: delivery.tenantId,
      workspaceId: delivery.workspaceId,
    });
  }
}

function causeOf(eventName: string): ClosedCause | null {
  if (eventName === HANDOFF_EVENT) return 'handoff';
  if (eventName === INBOUND_EVENT) return 'unattended';
  return null;
}
