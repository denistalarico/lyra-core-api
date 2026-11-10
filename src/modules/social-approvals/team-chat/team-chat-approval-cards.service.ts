import {
  BadRequestException,
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import { PlatformPermissionService } from '../../permissions';
import { AgencyChatMessage } from '../../team-chat/entities';
import type { TeamChatContext } from '../../team-chat/services/team-chat-access';
import { TeamChatCardPostService } from '../../team-chat/services/team-chat-card-post.service';
import type {
  TeamChatCardMessage,
  TeamChatCardResolver,
} from '../../team-chat/services/team-chat-card-resolver.port';
import { TeamChatChannelsService } from '../../team-chat/services/team-chat-channels.service';
import type { ApprovalDecisionRecord } from '../client-conversation-card.port';
import {
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
} from '../entities';
import { SocialApprovalAuthorityService } from '../social-approval-authority.service';
import { deterministicUuid } from '../social-approval-pieces.service';
import {
  SocialApprovalSettingsService,
  type EffectiveSocialApprovalSettings,
} from '../social-approval-settings.service';
import { SocialApprovalsService } from '../social-approvals.service';
import type { TeamChatApprovalCardPublisher } from '../team-chat-approval-card.port';

const AGENCY_CONNECTION = 'agency';
const SOURCE_MODULE = 'social_approvals';
const SENDER = {
  displayName: 'Orion',
  agentType: 'social_approvals',
} as const;
const MAX_BATCH_ITEMS = 50;

export const APPROVE_INTERNAL_PERMISSION =
  'social.approvals.review.approve_internal.manager';
export const REQUEST_CHANGES_PERMISSION =
  'social.approvals.review.request_changes.manager';
const VIEW_PERMISSION = 'social.approvals.review.view.assigned';

type ApprovalCardRef = { approvalId: string; batchId: string | null };

export type TeamChatApprovalCardActions = {
  canApprove: boolean;
  canRequestChanges: boolean;
  canOpen: boolean;
};

export type TeamChatApprovalCardView = {
  state: Record<string, unknown>;
  actions: TeamChatApprovalCardActions;
};

/** A card is only ever one the platform wrote: people can write `metadata`. */
function readApprovalCard(
  message: TeamChatCardMessage,
): ApprovalCardRef | null {
  if (message.senderUserId !== null) return null;
  const card = message.metadata?.card as Record<string, unknown> | undefined;
  if (card?.kind !== 'approval_card' || typeof card.approvalId !== 'string')
    return null;
  return {
    approvalId: card.approvalId,
    batchId: typeof card.batchId === 'string' ? card.batchId : null,
  };
}

function scopeOf(approval: SocialApprovalRequestEntity): CompanyAwareScope {
  return {
    tenantId: approval.tenantId,
    workspaceId: approval.workspaceId,
    agencyClientId: approval.agencyClientId,
    companyContextId: approval.companyContextId,
  } as CompanyAwareScope;
}

function decisionReply(
  approval: SocialApprovalRequestEntity,
  record: ApprovalDecisionRecord,
): string {
  const who = record.actorName ?? 'Alguém';
  const subject = `${approval.title} (${approval.subjectVersionLabel})`;
  if (record.decision === 'agency_override')
    return `${who} aprovou pela agência: ${subject}.`;
  const where = record.stage === 'internal' ? 'internamente ' : '';
  return record.decision === 'approved'
    ? `${who} aprovou ${where}${subject}.`
    : `${who} solicitou alterações em ${subject}.`;
}

/**
 * AR5 — the Team Chat side of approvals. Publishes the card, resolves its
 * status and actions per reader (D-07) and takes the decision through the same
 * domain methods as the board, so the events and decisions are the same ones.
 * Being in the channel only lets a person see the card; deciding is D-17.
 */
@Injectable()
export class TeamChatApprovalCardsService
  implements TeamChatApprovalCardPublisher, TeamChatCardResolver
{
  private readonly logger = new Logger(TeamChatApprovalCardsService.name);

  constructor(
    @InjectRepository(SocialApprovalRequestEntity, AGENCY_CONNECTION)
    private readonly requests: Repository<SocialApprovalRequestEntity>,
    @InjectRepository(SocialApprovalStepEntity, AGENCY_CONNECTION)
    private readonly steps: Repository<SocialApprovalStepEntity>,
    @InjectRepository(SocialApprovalPieceEntity, AGENCY_CONNECTION)
    private readonly pieces: Repository<SocialApprovalPieceEntity>,
    @InjectRepository(AgencyChatMessage, AGENCY_CONNECTION)
    private readonly messages: Repository<AgencyChatMessage>,
    private readonly posts: TeamChatCardPostService,
    private readonly channels: TeamChatChannelsService,
    private readonly approvals: SocialApprovalsService,
    private readonly settings: SocialApprovalSettingsService,
    private readonly authority: SocialApprovalAuthorityService,
    private readonly permissions: PlatformPermissionService,
  ) {}

  // ---------------------------------------------------------------- publish

  async publishCard(input: {
    approval: SocialApprovalRequestEntity;
    channelId: string;
    dedupeKey: string;
  }): Promise<void> {
    const { approval, channelId, dedupeKey } = input;
    const result = await this.posts.postCard({
      tenantId: approval.tenantId,
      workspaceId: approval.workspaceId,
      channelId,
      dedupeKey,
      messageId: deterministicUuid(dedupeKey),
      sender: SENDER,
      body: approval.batchId
        ? 'Um lote de peças aguarda aprovação interna.'
        : `${approval.title} (${approval.subjectVersionLabel}) aguarda aprovação interna.`,
      card: {
        kind: 'approval_card',
        approvalId: approval.id,
        batchId: approval.batchId,
        title: approval.title,
        version: approval.subjectVersionLabel,
      },
      source: {
        module: SOURCE_MODULE,
        resourceId: approval.batchId ?? approval.id,
      },
    });
    if (result.status === 'channel_unavailable')
      this.logger.warn(
        `Team Chat channel ${channelId} is unavailable for approval ${approval.id}.`,
      );
    // D-19: another item joined a batch card someone may be looking at.
    if (result.status === 'duplicate')
      this.posts.broadcastCardChanged({
        tenantId: approval.tenantId,
        workspaceId: approval.workspaceId,
        channelId,
        messageId: result.messageId,
      });
  }

  async publishDecisionReply(input: {
    approval: SocialApprovalRequestEntity;
    record: ApprovalDecisionRecord;
  }): Promise<void> {
    const parent = await this.findCard(input.approval);
    if (!parent?.channelId) return;
    await this.posts.postReply({
      tenantId: input.approval.tenantId,
      workspaceId: input.approval.workspaceId,
      channelId: parent.channelId,
      parentMessageId: parent.id,
      dedupeKey: `social.approval.decision:${input.record.eventId}`,
      sender: SENDER,
      body: decisionReply(input.approval, input.record),
      replyTo: {
        id: parent.id,
        senderDisplayName: parent.senderDisplayName,
        body: parent.body,
      },
      source: { module: SOURCE_MODULE, resourceId: input.approval.id },
    });
  }

  async announceCardChanged(
    approval: SocialApprovalRequestEntity,
  ): Promise<void> {
    const card = await this.findCard(approval);
    if (!card?.channelId) return;
    this.posts.broadcastCardChanged({
      tenantId: approval.tenantId,
      workspaceId: approval.workspaceId,
      channelId: card.channelId,
      messageId: card.id,
    });
  }

  private findCard(approval: SocialApprovalRequestEntity) {
    return this.posts.findCardMessage({
      tenantId: approval.tenantId,
      workspaceId: approval.workspaceId,
      module: SOURCE_MODULE,
      resourceId: approval.batchId ?? approval.id,
    });
  }

  // ------------------------------------------------------------------- read

  async resolve(
    context: TeamChatContext,
    messages: readonly TeamChatCardMessage[],
  ): Promise<Map<string, Record<string, unknown>>> {
    const cards = messages
      .map((message) => ({ message, ref: readApprovalCard(message) }))
      .filter(
        (entry): entry is typeof entry & { ref: ApprovalCardRef } =>
          entry.ref !== null,
      );
    const resolved = new Map<string, Record<string, unknown>>();
    if (cards.length === 0) return resolved;

    const views = await this.views(
      context,
      cards.map((entry) => entry.ref),
    );
    for (const { message, ref } of cards) {
      const view = views.get(ref.approvalId);
      if (view) resolved.set(message.id, view);
    }
    return resolved;
  }

  /** Every read is by tenant and workspace; the card only names an id. */
  private async views(
    context: TeamChatContext,
    refs: readonly ApprovalCardRef[],
  ): Promise<Map<string, TeamChatApprovalCardView>> {
    const views = new Map<string, TeamChatApprovalCardView>();
    const where = {
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
    };
    const approvals = await this.requests.find({
      where: { ...where, id: In(refs.map((ref) => ref.approvalId)) },
    });
    const batchIds = [
      ...new Set(
        approvals
          .map((approval) => approval.batchId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const batchMembers = batchIds.length
      ? await this.requests.find({
          where: { ...where, batchId: In(batchIds) },
          order: { requestedAt: 'ASC', id: 'ASC' },
        })
      : [];
    const stepIds = approvals
      .map((approval) => approval.stepId)
      .filter((id): id is string => Boolean(id));
    const steps = stepIds.length
      ? await this.steps.find({ where: { id: In(stepIds) } })
      : [];
    const pieces = steps.length
      ? await this.pieces.find({
          where: { id: In(steps.map((step) => step.pieceId)) },
        })
      : [];
    const stepById = new Map(steps.map((step) => [step.id, step]));
    const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
    const settingsByScope = new Map<string, EffectiveSocialApprovalSettings>();
    // The same keys the routes check, resolved once per read.
    const granted = context.userId
      ? await this.permissions.getEffectivePermissions({
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          userId: context.userId,
          role: context.role ?? '',
        })
      : new Set<string>();

    for (const approval of approvals) {
      const key = `${approval.agencyClientId}:${approval.companyContextId}`;
      const settings =
        settingsByScope.get(key) ??
        (await this.settings.get(scopeOf(approval)));
      settingsByScope.set(key, settings);

      const members = approval.batchId
        ? batchMembers.filter((item) => item.batchId === approval.batchId)
        : [];
      const batched = members.length > 1;
      const step = approval.stepId ? stepById.get(approval.stepId) : undefined;
      const piece = step ? pieceById.get(step.pieceId) : undefined;
      views.set(approval.id, {
        state: {
          approvalId: approval.id,
          title: approval.title,
          versionLabel: approval.subjectVersionLabel,
          status: approval.status,
          stage: approval.currentStage,
          piece:
            step && piece
              ? {
                  id: piece.id,
                  kind: piece.kind,
                  stepKind: step.kind,
                  stepTitle: step.title,
                }
              : null,
          context: {
            agencyClientId: approval.agencyClientId,
            companyContextId: approval.companyContextId,
          },
          ...(batched
            ? {
                batch: {
                  total: members.length,
                  pending: members.filter(
                    (item) => item.status === 'awaiting_internal_review',
                  ).length,
                  items: members.slice(0, MAX_BATCH_ITEMS).map((item) => ({
                    approvalId: item.id,
                    title: item.title,
                    versionLabel: item.subjectVersionLabel,
                    status: item.status,
                  })),
                },
              }
            : {}),
        },
        actions: this.actions(context, granted, approval, settings, batched),
      });
    }
    return views;
  }

  /**
   * D-07/D-17 and the route's own keys, so nothing is offered that would 403.
   * A batch is decided piece by piece, on the board.
   */
  private actions(
    context: TeamChatContext,
    granted: ReadonlySet<string>,
    approval: SocialApprovalRequestEntity,
    settings: EffectiveSocialApprovalSettings,
    batched: boolean,
  ): TeamChatApprovalCardActions {
    const has = (key: string) => granted.has(key);
    const designated =
      !batched &&
      approval.status === 'awaiting_internal_review' &&
      Boolean(context.userId) &&
      this.authority.canDecideInternal(settings, {
        userId: context.userId as string,
        role: context.role,
      });
    return {
      canApprove: designated && has(APPROVE_INTERNAL_PERMISSION),
      canRequestChanges: designated && has(REQUEST_CHANGES_PERMISSION),
      canOpen: has(VIEW_PERMISSION),
    };
  }

  // ----------------------------------------------------------------- decide

  /** The card of this channel, proven; one answer for every way it fails. */
  private async loadCard(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
  ) {
    await this.channels.assertChannelAccess(
      context,
      channelId,
      'approval_card.read',
    );
    const message = await this.messages.findOne({
      where: {
        id: messageId,
        channelId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
    const ref = message ? readApprovalCard(message) : null;
    if (!message || !ref)
      throw new NotFoundException('Card de aprovação não encontrado.');
    return ref;
  }

  async view(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
  ): Promise<TeamChatApprovalCardView> {
    const ref = await this.loadCard(context, channelId, messageId);
    const view = (await this.views(context, [ref])).get(ref.approvalId);
    if (!view) throw new NotFoundException('Card de aprovação não encontrado.');
    return view;
  }

  /** The approval of a decidable card; the domain re-checks D-17 under lock. */
  private async decidable(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
  ) {
    const ref = await this.loadCard(context, channelId, messageId);
    const approval = await this.requests.findOne({
      where: {
        id: ref.approvalId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
    if (!approval)
      throw new NotFoundException('Card de aprovação não encontrado.');
    if (approval.batchId) {
      const size = await this.requests.count({
        where: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          batchId: approval.batchId,
        },
      });
      if (size > 1)
        throw new ConflictException(
          'Um lote é decidido peça por peça, na tela de aprovações.',
        );
    }
    return approval;
  }

  async approve(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
  ): Promise<TeamChatApprovalCardView> {
    const approval = await this.decidable(context, channelId, messageId);
    await this.approvals.approveInternal(
      scopeOf(approval),
      approval.id,
      context.userId,
      context.role,
      'team_chat',
    );
    return this.view(context, channelId, messageId);
  }

  async requestChanges(
    context: TeamChatContext,
    channelId: string,
    messageId: string,
    body: string,
  ): Promise<TeamChatApprovalCardView> {
    if (!body?.trim())
      throw new BadRequestException('Descreva as alterações necessárias.');
    const approval = await this.decidable(context, channelId, messageId);
    await this.approvals.requestChanges(
      scopeOf(approval),
      approval.id,
      context.userId,
      body,
      context.role,
      'team_chat',
    );
    return this.view(context, channelId, messageId);
  }
}
