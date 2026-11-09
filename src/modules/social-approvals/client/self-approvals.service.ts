import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { In, Repository } from 'typeorm';
import type { CompanyAwareScope } from '../../../common/context/company-aware-scope';
import { AgencyUserProfileEntity } from '../../agency/entities/agency-settings.entities';
import type { ClientAreaSelfContext } from '../../client-area/client-area.types';
import { approvalScopeWhere } from '../approval-scope';
import { isApprovalSnapshotMediaRef } from '../approval-snapshot-media-ref';
import type { ClientApprovalBoardQueryDto } from '../dto/social-approval-piece.dto';
import {
  SocialApprovalCommentEntity,
  SocialApprovalEventEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
  type SocialApprovalPieceEntity,
  type SocialApprovalStepEntity,
} from '../entities';
import { SocialApprovalAuthorityService } from '../social-approval-authority.service';
import { SocialApprovalMediaService } from '../social-approval-media.service';
import { SocialApprovalSettingsService } from '../social-approval-settings.service';
import { SocialApprovalsService } from '../social-approvals.service';
import {
  ApprovalSubjectResolver,
  type ResolvedApprovalSubject,
} from '../subjects/approval-subject-resolver';
import {
  ClientApprovalBoardService,
  type ClientBoardSource,
} from './client-approval-board.service';
import type { ClientBoardColumn } from './client-approval-board.view';
import { ClientApprovalMediaService } from './client-approval-media.service';
import {
  buildClientApprovalActions,
  buildClientApprovalComment,
  buildClientApprovalHistory,
  buildClientApprovalListItem,
  buildClientApprovalPreview,
  isClientApprovalMediaRef,
  type ClientApprovalAuthor,
  type ClientApprovalDetail,
  type ClientApprovalListItem,
  type ClientApprovalPreview,
} from './client-approval.view';

const AGENCY_TEAM_LABEL = 'Equipe da agência';

/** D-24's "sent": the first hand-over to internal approval, not a draft. */
const submittedSql = (alias: string) => `(
  ${alias}.status IN ('awaiting_internal_review','changes_requested')
  OR EXISTS (
    SELECT 1 FROM "social_approval_events" submitted_event
     WHERE submitted_event.request_id = ${alias}.id AND submitted_event.type = 'sent'
  )
  OR EXISTS (
    SELECT 1 FROM "social_approval_stage_decisions" submitted_decision
     WHERE submitted_decision.approval_request_id = ${alias}.id
       AND submitted_decision.decision IN ('approved','changes_requested')
  )
)`;

const PIECE_SUBMITTED = `EXISTS (
  SELECT 1 FROM "social_approval_requests" sent
    JOIN "social_approval_steps" sent_step ON sent_step.id = sent.step_id
   WHERE sent_step.piece_id = piece.id AND ${submittedSql('sent')}
)`;

const SELF_COLUMNS: Record<
  ClientBoardColumn,
  ReturnType<ClientBoardSource['columnsFor']>
> = {
  awaiting_you: ['internal_review'],
  with_agency: ['preparation', 'changes'],
  approved: ['approved'],
  finished: ['finished'],
};

export type SelfApprovalReader = {
  userId: string;
  agencyRole: 'owner' | 'admin';
  permissions: { comment: boolean; decide: boolean };
};

/**
 * The agency's own scope, by construction: `ClientAreaSelfContext` carries no
 * company, and none is invented (PD3). Not a variant of `toCompanyAwareScope`.
 */
export function selfApprovalScope(
  context: Pick<ClientAreaSelfContext, 'tenantId' | 'workspaceId'>,
): CompanyAwareScope {
  return {
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    agencyClientId: null,
    companyContextId: null,
  };
}

/**
 * Translates an own-scope request into the shape the client projection reads,
 * so both surfaces share one set of builders. The internal stage plays the
 * client's part here (D-24), and nothing of this object leaves the server:
 * the builders still emit field by field.
 */
function asClientFacing(
  request: SocialApprovalRequestEntity,
  sentAt: Date,
): SocialApprovalRequestEntity {
  return {
    ...request,
    status:
      request.status === 'awaiting_internal_review'
        ? 'awaiting_client'
        : request.status,
    sentToClientAt: sentAt,
    clientFirstViewedAt: request.internalFirstViewedAt,
    clientLastViewedAt: request.internalLastViewedAt,
    clientViewedByUserId: request.internalViewedByUserId,
  };
}

/**
 * D-24 — the approvals screen of the agency's own Client Area. Same payloads
 * as the company branch over a different source: the own scope, with the
 * decision going to the internal approval. External clients never reach it:
 * `ClientAreaSelfContextGuard` requires an active self access held by an
 * Owner or Admin of this workspace, and answers a generic 404 otherwise.
 */
@Injectable()
export class SelfApprovalsService {
  constructor(
    @InjectRepository(SocialApprovalRequestEntity, 'agency')
    private readonly requests: Repository<SocialApprovalRequestEntity>,
    @InjectRepository(SocialApprovalCommentEntity, 'agency')
    private readonly comments: Repository<SocialApprovalCommentEntity>,
    @InjectRepository(SocialApprovalStageDecisionEntity, 'agency')
    private readonly decisions: Repository<SocialApprovalStageDecisionEntity>,
    @InjectRepository(SocialApprovalEventEntity, 'agency')
    private readonly events: Repository<SocialApprovalEventEntity>,
    @InjectRepository(AgencyUserProfileEntity, 'agency')
    private readonly profiles: Repository<AgencyUserProfileEntity>,
    private readonly subjects: ApprovalSubjectResolver,
    private readonly approvals: SocialApprovalsService,
    private readonly authority: SocialApprovalAuthorityService,
    private readonly settings: SocialApprovalSettingsService,
    private readonly board: ClientApprovalBoardService,
    private readonly media: ClientApprovalMediaService,
    private readonly snapshotMedia: SocialApprovalMediaService,
  ) {}

  private async findVisible(scope: CompanyAwareScope, approvalId: string) {
    const approval = await this.requests
      .createQueryBuilder('request')
      .where({ ...approvalScopeWhere(scope), id: approvalId })
      .andWhere(submittedSql('request'))
      .getOne();
    if (!approval) throw new NotFoundException('Aprovação não encontrada.');
    return approval;
  }

  /** Last hand-over to review; `requestedAt` only for pre-AR1 requests. */
  private async sentAtByRequest(
    requests: readonly SocialApprovalRequestEntity[],
  ): Promise<Map<string, Date>> {
    const sentAt = new Map<string, Date>(
      requests.map((request) => [request.id, request.requestedAt]),
    );
    if (requests.length === 0) return sentAt;
    const events = await this.events.find({
      where: {
        requestId: In(requests.map((request) => request.id)),
        type: 'sent',
      },
      order: { createdAt: 'ASC' },
    });
    for (const event of events) sentAt.set(event.requestId!, event.createdAt);
    return sentAt;
  }

  private source(
    scope: CompanyAwareScope,
    reader?: SelfApprovalReader,
  ): ClientBoardSource {
    return {
      scope,
      visibleSql: PIECE_SUBMITTED,
      columnsFor: (column) => SELF_COLUMNS[column],
      presentPiece: (piece: SocialApprovalPieceEntity) => ({
        ...piece,
        boardColumn:
          piece.boardColumn === 'internal_review'
            ? 'awaiting_client'
            : piece.boardColumn,
      }),
      latestVisible: (steps) => this.latestSubmitted(scope, steps),
      detail: (approvalId) =>
        this.detail(scope, approvalId, reader as SelfApprovalReader),
    };
  }

  private async latestSubmitted(
    scope: CompanyAwareScope,
    steps: readonly SocialApprovalStepEntity[],
  ) {
    const latest = new Map<string, SocialApprovalRequestEntity>();
    if (steps.length === 0) return latest;
    const requests = await this.requests
      .createQueryBuilder('request')
      .where({
        ...approvalScopeWhere(scope),
        stepId: In(steps.map((step) => step.id)),
      })
      .andWhere(submittedSql('request'))
      .orderBy('request.createdAt', 'ASC')
      .addOrderBy('request.id', 'ASC')
      .getMany();
    const sentAt = await this.sentAtByRequest(requests);
    for (const request of requests)
      latest.set(
        request.stepId!,
        asClientFacing(request, sentAt.get(request.id)!),
      );
    return latest;
  }

  boardList(scope: CompanyAwareScope, query: ClientApprovalBoardQueryDto) {
    return this.board.boardFor(this.source(scope), query);
  }

  piece(scope: CompanyAwareScope, pieceId: string, reader: SelfApprovalReader) {
    return this.board.pieceFor(this.source(scope, reader), pieceId);
  }

  /** Same fields as the company list, for the same screen. */
  async list(
    scope: CompanyAwareScope,
  ): Promise<{ items: ClientApprovalListItem[] }> {
    const requests = await this.requests
      .createQueryBuilder('request')
      .where(approvalScopeWhere(scope))
      .andWhere(submittedSql('request'))
      .orderBy('request.createdAt', 'DESC')
      .addOrderBy('request.id', 'DESC')
      .getMany();
    const sentAt = await this.sentAtByRequest(requests);
    const items = requests.map((request) =>
      buildClientApprovalListItem(
        asClientFacing(request, sentAt.get(request.id)!),
      ),
    );
    items.sort((a, b) => {
      if (a.needsYou !== b.needsYou) return a.needsYou ? -1 : 1;
      return b.lastActivityAt.localeCompare(a.lastActivityAt);
    });
    return { items };
  }

  private async getPreview(
    scope: CompanyAwareScope,
    approval: SocialApprovalRequestEntity,
  ): Promise<ClientApprovalPreview> {
    return buildClientApprovalPreview(
      await this.subjects.getPreview(scope, {
        subjectType:
          approval.subjectType as ResolvedApprovalSubject['subjectType'],
        subjectId: approval.subjectId,
        subjectRevisionId: approval.subjectRevisionId,
        title: approval.title,
        subjectVersionLabel: approval.subjectVersionLabel,
      }),
    );
  }

  async preview(scope: CompanyAwareScope, approvalId: string) {
    return this.getPreview(scope, await this.findVisible(scope, approvalId));
  }

  /**
   * Everyone in this thread is the agency, so operators keep their real
   * names here, which the company branch hides from an external client.
   */
  private async authors(
    tenantId: string,
    userIds: ReadonlyArray<string | null>,
  ) {
    const ids = [...new Set(userIds.filter((id): id is string => Boolean(id)))];
    const profiles = ids.length
      ? await this.profiles.find({ where: { tenantId, userId: In(ids) } })
      : [];
    const names = new Map(
      profiles
        .filter((profile) => profile.displayName?.trim())
        .map((profile) => [profile.userId, profile.displayName.trim()]),
    );
    return (userId: string | null): ClientApprovalAuthor => ({
      name: userId ? (names.get(userId) ?? 'Usuário') : AGENCY_TEAM_LABEL,
      side: 'agency',
    });
  }

  async detail(
    scope: CompanyAwareScope,
    approvalId: string,
    reader: SelfApprovalReader,
  ): Promise<ClientApprovalDetail> {
    const request = await this.findVisible(scope, approvalId);
    const [comments, decisions, preview, sentAt, settings] = await Promise.all([
      this.comments.find({
        where: { approvalRequestId: request.id },
        order: { createdAt: 'ASC' },
      }),
      this.decisions.find({
        where: { approvalRequestId: request.id },
        order: { createdAt: 'ASC' },
      }),
      this.getPreview(scope, request),
      this.sentAtByRequest([request]),
      this.settings.get(scope),
    ]);
    const approval = asClientFacing(request, sentAt.get(request.id)!);
    const authorFor = await this.authors(scope.tenantId, [
      ...comments.map((comment) => comment.actorUserId),
      ...decisions.map((decision) => decision.actorUserId),
      approval.clientViewedByUserId,
    ]);
    return {
      ...buildClientApprovalListItem(approval, comments),
      preview,
      comments: comments.map((comment) =>
        buildClientApprovalComment(
          comment,
          authorFor(comment.actorUserId),
          reader.userId,
        ),
      ),
      history: buildClientApprovalHistory(
        approval,
        decisions,
        comments,
        (userId) => authorFor(userId).name,
      ),
      actions: buildClientApprovalActions(approval, {
        comment: reader.permissions.comment,
        decide:
          reader.permissions.decide &&
          this.authority.canDecideInternal(settings, {
            userId: reader.userId,
            role: reader.agencyRole,
          }),
      }),
    };
  }

  async view(scope: CompanyAwareScope, approvalId: string, userId: string) {
    const request = await this.findVisible(scope, approvalId);
    const saved = await this.approvals.markAgencyViewed(
      scope,
      request.id,
      userId,
      'self',
    );
    const sentAt = await this.sentAtByRequest([saved]);
    return buildClientApprovalListItem(
      asClientFacing(saved, sentAt.get(saved.id)!),
    );
  }

  /** Internal by nature: `client` is refused in a scope with no client. */
  async comment(
    scope: CompanyAwareScope,
    approvalId: string,
    reader: SelfApprovalReader,
    body: string,
  ) {
    const request = await this.findVisible(scope, approvalId);
    if (request.status !== 'awaiting_internal_review')
      throw new ConflictException(
        'A aprovação não está em um estado que permite esta ação.',
      );
    await this.approvals.comment(
      scope,
      request.id,
      reader.userId,
      body,
      'internal',
      'self',
    );
    return this.detail(scope, approvalId, reader);
  }

  async approve(
    scope: CompanyAwareScope,
    approvalId: string,
    reader: SelfApprovalReader,
  ) {
    await this.findVisible(scope, approvalId);
    await this.approvals.approveInternal(
      scope,
      approvalId,
      reader.userId,
      reader.agencyRole,
      'self',
    );
    return this.detail(scope, approvalId, reader);
  }

  async requestChanges(
    scope: CompanyAwareScope,
    approvalId: string,
    reader: SelfApprovalReader,
    body: string,
  ) {
    await this.findVisible(scope, approvalId);
    await this.approvals.requestChanges(
      scope,
      approvalId,
      reader.userId,
      body,
      reader.agencyRole,
      'self',
    );
    return this.detail(scope, approvalId, reader);
  }

  /** Bytes by opaque slot, read off the approval just proved visible. */
  async openMedia(
    scope: CompanyAwareScope,
    approvalId: string,
    mediaRef: string,
  ): Promise<
    | { kind: 'stored'; storagePath: string; mimeType: string }
    | {
        kind: 'opened';
        opened: Awaited<ReturnType<SocialApprovalMediaService['open']>>;
      }
  > {
    if (
      !isClientApprovalMediaRef(mediaRef) &&
      !isApprovalSnapshotMediaRef(mediaRef)
    )
      throw new NotFoundException('Mídia não encontrada.');
    const approval = await this.findVisible(scope, approvalId);
    if (isClientApprovalMediaRef(mediaRef)) {
      const media = await this.media.resolveForApproval(
        scope,
        approval,
        mediaRef,
      );
      return {
        kind: 'stored',
        storagePath: media.storagePath,
        mimeType: media.mimeType,
      };
    }
    if (approval.subjectType !== 'approval_snapshot')
      throw new NotFoundException('Mídia não encontrada.');
    return {
      kind: 'opened',
      opened: await this.snapshotMedia.open(
        scope,
        approval.subjectRevisionId,
        mediaRef,
        approval.subjectId,
      ),
    };
  }

  async deliverable(scope: CompanyAwareScope, approvalId: string) {
    return this.media.deliverableForApproval(
      scope,
      await this.findVisible(scope, approvalId),
    );
  }
}
