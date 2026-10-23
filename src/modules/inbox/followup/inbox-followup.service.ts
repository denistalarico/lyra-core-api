import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import type { RequestContext } from '../../../common/context/request-context.interface';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceCompanySettingsEntity,
} from '../../agency/entities/agency-settings.entities';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import {
  readOpportunityFollowUp,
  writeOpportunityFollowUp,
  type CrmOpportunityFollowUpAttempt,
} from '../../crm/services/crm-opportunity-follow-up';
import { FacebookMessengerOutboundService } from '../channels/facebook-messenger/services/facebook-messenger-outbound.service';
import { InstagramOutboundService } from '../channels/instagram/services/instagram-outbound.service';
import {
  loadMetaMessagingWindow,
  type MetaMessagingWindowSource,
} from '../channels/meta/meta-messaging-window';
import { SendInboxFollowupDto } from '../dto/inbox-followup.dto';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { inboxEntityMatchesScope } from '../inbox-company-scope';
import { InboxFollowupTemplatesService } from './inbox-followup-templates.service';
import {
  firstName,
  renderFollowupTemplate,
  type FollowupTemplateValues,
} from './inbox-followup-variables';

/** The pending manual step a person can send with one click. */
export type InboxPendingFollowUp = {
  stepKey: string;
  channel: string;
  expiresAt: string;
  proposedText: string | null;
};

export type InboxConversationMessagingWindow = {
  channelType: string | null;
  /** Only Instagram/Messenger: the shared window (D-IX-4). */
  standardExpiresAt: string | null;
  /** Null when the `HUMAN_AGENT` extension is switched off or does not apply. */
  humanAgentExpiresAt: string | null;
  source: MetaMessagingWindowSource | null;
  pendingFollowUp: InboxPendingFollowUp | null;
};

const MANUAL_FOLLOWUP_CHANNEL_TYPES = ['instagram', 'facebook_messenger'];

/**
 * The person's half of the assisted follow-up (IX2, D-IX-3/D-IX-9).
 *
 * Reads the window the composer shows, and sends a follow-up as a person
 * through the channel service — which is what applies ownership, the window
 * and the `HUMAN_AGENT` tag. Nothing here talks to Meta, and the UI is never
 * the barrier.
 */
@Injectable()
export class InboxFollowupService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly instagram: InstagramOutboundService,
    private readonly messenger: FacebookMessengerOutboundService,
    private readonly templates: InboxFollowupTemplatesService,
  ) {}

  async getMessagingWindow(
    ctx: RequestContext,
    conversationId: string,
  ): Promise<InboxConversationMessagingWindow> {
    const conversation = await this.findConversation(ctx, conversationId);
    const channelType = await this.channelType(conversation);
    if (!channelType || !MANUAL_FOLLOWUP_CHANNEL_TYPES.includes(channelType)) {
      return {
        channelType,
        standardExpiresAt: null,
        humanAgentExpiresAt: null,
        source: null,
        pendingFollowUp: null,
      };
    }
    const window = await loadMetaMessagingWindow({
      messages: this.dataSource.getRepository(InboxMessageEntity),
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
      conversationId: conversation.id,
    });
    const opportunity = await this.findOpportunity(conversation);
    const pending = opportunity ? pendingAttempt(opportunity) : null;
    return {
      channelType,
      standardExpiresAt: window.standardExpiresAt?.toISOString() ?? null,
      humanAgentExpiresAt: window.humanAgentExpiresAt?.toISOString() ?? null,
      source: window.source,
      pendingFollowUp: pending
        ? {
            stepKey: pending.stepKey,
            channel: pending.channel,
            expiresAt: pending.expiresAt!,
            proposedText: pending.proposedText ?? null,
          }
        : null,
    };
  }

  async send(
    ctx: RequestContext,
    conversationId: string,
    dto: SendInboxFollowupDto,
  ) {
    const conversation = await this.findConversation(ctx, conversationId);
    const channelType = await this.channelType(conversation);
    const service =
      channelType === 'instagram'
        ? this.instagram
        : channelType === 'facebook_messenger'
          ? this.messenger
          : null;
    if (!service) {
      throw new BadRequestException('followup_channel_unsupported');
    }

    const source = dto.templateId
      ? (await this.templates.findUsable(ctx, dto.templateId, channelType!))
          .body
      : (dto.text ?? '');
    const opportunity = await this.findOpportunity(conversation);
    const text = renderFollowupTemplate(
      source,
      await this.variableValues(ctx, conversation, opportunity),
    );
    if (!text) throw new BadRequestException('followup_text_required');

    const pending = opportunity
      ? pendingAttempt(opportunity, dto.stepKey)
      : null;
    const result = await service.sendFollowUpText({
      ctx,
      conversationId: conversation.id,
      text,
      idempotencyKey: dto.idempotencyKey,
      stepKey: dto.stepKey,
      automationId: pending?.automationId ?? null,
    });

    // The card is the board's state. A retry with the same key replays the
    // message without sending it again and lands here once more, so a failure
    // of this write surfaces instead of being swallowed.
    if (opportunity && pending) {
      await this.markSent(opportunity, pending);
    }
    return { message: result.message };
  }

  private async markSent(
    opportunity: CrmOpportunityEntity,
    pending: CrmOpportunityFollowUpAttempt,
  ) {
    const repository = this.dataSource.getRepository(CrmOpportunityEntity);
    const fresh = await repository.findOne({
      where: {
        id: opportunity.id,
        tenantId: opportunity.tenantId,
        workspaceId: opportunity.workspaceId,
      },
    });
    if (!fresh) return;
    writeOpportunityFollowUp(fresh, {
      attempt: {
        stepKey: pending.stepKey,
        result: 'sent',
        channel: pending.channel,
        at: new Date().toISOString(),
        runId: pending.runId,
      },
    });
    await repository.update(
      {
        id: fresh.id,
        tenantId: fresh.tenantId,
        workspaceId: fresh.workspaceId,
      },
      { metadata: fresh.metadata as never },
    );
  }

  private async variableValues(
    ctx: RequestContext,
    conversation: InboxConversationEntity,
    opportunity: CrmOpportunityEntity | null,
  ): Promise<FollowupTemplateValues> {
    const metadata = conversation.metadata ?? {};
    const username = readString(metadata.username);
    // A name or an @ — never the scoped id (D-IX-1).
    const contactName =
      readString(opportunity?.contactName) ??
      readString(metadata.contactName) ??
      readString(metadata.senderName) ??
      (username ? `@${username.replace(/^@/, '')}` : null);
    const [profile, company] = await Promise.all([
      ctx.userId
        ? this.dataSource.getRepository(AgencyUserProfileEntity).findOne({
            where: { tenantId: conversation.tenantId, userId: ctx.userId },
            select: { userId: true, displayName: true },
          })
        : null,
      this.dataSource
        .getRepository(AgencyWorkspaceCompanySettingsEntity)
        .findOne({
          where: {
            tenantId: conversation.tenantId,
            workspaceId: conversation.workspaceId,
          },
          select: { workspaceName: true, tradeName: true, legalName: true },
        })
        .catch(() => null),
    ]);
    return {
      'contact.name': contactName,
      'contact.firstName': firstName(contactName),
      'user.firstName': firstName(profile?.displayName),
      'business.name':
        readString(company?.tradeName) ??
        readString(company?.workspaceName) ??
        readString(company?.legalName),
    };
  }

  private async findConversation(
    ctx: RequestContext,
    conversationId: string,
  ): Promise<InboxConversationEntity> {
    if (!ctx.workspaceId) {
      throw new BadRequestException('Workspace context is required.');
    }
    const conversation = await this.dataSource
      .getRepository(InboxConversationEntity)
      .findOne({
        where: {
          id: conversationId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      });
    if (!conversation || !inboxEntityMatchesScope(ctx, conversation)) {
      throw new NotFoundException('Inbox conversation not found.');
    }
    return conversation;
  }

  private async channelType(
    conversation: InboxConversationEntity,
  ): Promise<string | null> {
    if (!conversation.channelId) return null;
    const channel = await this.dataSource
      .getRepository(InboxChannelEntity)
      .findOne({
        where: {
          id: conversation.channelId,
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
        },
        select: { id: true, type: true },
      });
    return channel?.type ?? null;
  }

  private async findOpportunity(
    conversation: InboxConversationEntity,
  ): Promise<CrmOpportunityEntity | null> {
    const repository = this.dataSource.getRepository(CrmOpportunityEntity);
    const scope = {
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
    };
    return (
      (conversation.opportunityId
        ? await repository.findOne({
            where: { id: conversation.opportunityId, ...scope },
          })
        : null) ??
      (await repository.findOne({
        where: { inboxConversationId: conversation.id, ...scope },
        order: { createdAt: 'DESC' },
      }))
    );
  }
}

/**
 * The step a person is being asked to send: `manual_pending`, still inside its
 * window. With `stepKey`, only that step; otherwise the most recent one.
 */
function pendingAttempt(
  opportunity: CrmOpportunityEntity,
  stepKey?: string,
): CrmOpportunityFollowUpAttempt | null {
  const now = Date.now();
  const candidates = readOpportunityFollowUp(opportunity).attempts.filter(
    (attempt) =>
      attempt.result === 'manual_pending' &&
      (!stepKey || attempt.stepKey === stepKey) &&
      typeof attempt.expiresAt === 'string' &&
      new Date(attempt.expiresAt).getTime() > now,
  );
  return (
    candidates.sort(
      (a, b) => new Date(b.at).getTime() - new Date(a.at).getTime(),
    )[0] ?? null
  );
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}
