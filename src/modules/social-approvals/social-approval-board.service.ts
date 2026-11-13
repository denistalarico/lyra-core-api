import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository, type SelectQueryBuilder } from 'typeorm';
import {
  resolveCompanyAwareScope,
  type CompanyAwareScope,
} from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import {
  SocialCampaignInstanceEntity,
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { approvalPiecePost } from './approval-piece-post';
import { approvalStepPhase } from './approval-piece.projection';
import { approvalScopeWhere } from './approval-scope';
import { approvalScopeKind } from './approval-stage.policy';
import type { SocialApprovalBoardQueryDto } from './dto/social-approval-piece.dto';
import {
  SOCIAL_APPROVAL_BOARD_COLUMNS,
  SocialApprovalEventEntity,
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
  type SocialApprovalBoardColumn,
} from './entities';
import { SocialApprovalAuthorityService } from './social-approval-authority.service';
import {
  SocialApprovalInboxService,
  type SocialApprovalInboxContext,
} from './social-approval-inbox.service';
import { SocialApprovalPieceSyncService } from './social-approval-piece-sync.service';
import { SocialApprovalPiecesService } from './social-approval-pieces.service';
import { SocialApprovalSettingsService } from './social-approval-settings.service';
import { SocialApprovalsService } from './social-approvals.service';
import { ApprovalSubjectResolver } from './subjects/approval-subject-resolver';

const DEFAULT_LIMIT = 30;
const ACTIVE_STATUSES = new Set([
  'draft',
  'awaiting_internal_review',
  'awaiting_client',
  'changes_requested',
]);

export type ApprovalBoardReader = {
  userId: string;
  role?: string | null;
  permissions: ReadonlySet<string>;
};

export function parseBoardCursor(cursor?: string): number {
  if (!cursor) return 0;
  const offset = Number(cursor);
  if (!Number.isInteger(offset) || offset < 0)
    throw new BadRequestException('Cursor inválido.');
  return offset;
}

type ContextSettings = ReturnType<SocialApprovalSettingsService['get']>;

type RawCard = {
  planned_date: string | null;
  content_type: string | null;
  creative_format: string | null;
  destinations: Array<{ channel: string; placement: string }> | null;
  plan_title: string | null;
  campaign_name: string | null;
};

/**
 * Agency read side of the board. Like the inbox it spans every context the
 * caller may operate; each row carries its `context`, and acting on it still
 * goes through the per-context routes.
 */
@Injectable()
export class SocialApprovalBoardService {
  constructor(
    @InjectRepository(SocialApprovalPieceEntity, 'agency')
    private readonly pieces: Repository<SocialApprovalPieceEntity>,
    @InjectRepository(SocialApprovalStepEntity, 'agency')
    private readonly steps: Repository<SocialApprovalStepEntity>,
    @InjectRepository(SocialApprovalRequestEntity, 'agency')
    private readonly requests: Repository<SocialApprovalRequestEntity>,
    @InjectRepository(SocialApprovalEventEntity, 'agency')
    private readonly events: Repository<SocialApprovalEventEntity>,
    private readonly inbox: SocialApprovalInboxService,
    private readonly sync: SocialApprovalPieceSyncService,
    private readonly approvals: SocialApprovalsService,
    private readonly domain: SocialApprovalPiecesService,
    private readonly settings: SocialApprovalSettingsService,
    private readonly authority: SocialApprovalAuthorityService,
    private readonly subjects: ApprovalSubjectResolver,
  ) {}

  private async contexts(
    ctx: RequestContext,
    scope: CompanyAwareScope,
    query: SocialApprovalBoardQueryDto,
  ) {
    const includeOwn =
      approvalScopeKind(scope) === 'own' &&
      query.scope !== 'managed' &&
      !query.clientId;
    const companies =
      query.scope === 'own'
        ? []
        : (await this.inbox.companies(ctx, scope)).filter(
            (company) => !query.clientId || company.clientId === query.clientId,
          );
    return { includeOwn, companies };
  }

  async board(
    ctx: RequestContext,
    query: SocialApprovalBoardQueryDto,
    reader?: ApprovalBoardReader,
  ) {
    const scope = resolveCompanyAwareScope(ctx);
    const { includeOwn, companies } = await this.contexts(ctx, scope, query);
    const columns = (
      query.column ? [query.column] : [...SOCIAL_APPROVAL_BOARD_COLUMNS]
    ) as SocialApprovalBoardColumn[];
    const empty = () =>
      Object.fromEntries(
        columns.map((column) => [
          column,
          { items: [], total: 0, nextCursor: null },
        ]),
      );
    if (!includeOwn && companies.length === 0) return { columns: empty() };

    await this.sync.syncContexts(scope, [
      ...(includeOwn ? [{ clientId: null, companyContextId: null }] : []),
      ...companies.map((company) => ({
        clientId: company.clientId,
        companyContextId: company.companyContextId,
      })),
    ]);

    const base = this.baseQuery(scope, includeOwn, companies, query);
    const totals = new Map(
      (
        await base
          .clone()
          .select('piece.boardColumn', 'column')
          .addSelect('COUNT(*)', 'total')
          .groupBy('piece.boardColumn')
          .getRawMany<{ column: string; total: string }>()
      ).map((row) => [row.column, Number(row.total)]),
    );

    const limit = query.limit ?? DEFAULT_LIMIT;
    const offset = parseBoardCursor(query.cursor);
    const byPair = new Map(
      companies.map((company) => [
        `${company.clientId}:${company.companyContextId}`,
        company,
      ]),
    );
    const result: Record<string, unknown> = {};
    const settingsByContext = new Map<string, ContextSettings>();
    await Promise.all(
      columns.map(async (column) => {
        const qb = base
          .clone()
          .andWhere('piece.boardColumn = :column', { column });
        if (column === 'preparation')
          qb.orderBy('item.plannedDate', 'ASC', 'NULLS LAST').addOrderBy(
            'piece.updatedAt',
            'DESC',
          );
        else qb.orderBy('piece.updatedAt', 'DESC');
        const { entities, raw } = await qb
          .addOrderBy('piece.id', 'DESC')
          .limit(limit)
          .offset(offset)
          .getRawAndEntities();
        const total = totals.get(column) ?? 0;
        result[column] = {
          items: await this.cards(
            entities,
            raw as RawCard[],
            byPair,
            reader,
            settingsByContext,
          ),
          total,
          nextCursor:
            offset + entities.length < total
              ? String(offset + entities.length)
              : null,
        };
      }),
    );
    return { columns: result };
  }

  /** `source_state = 'hidden'` is what makes archiving take a card away. */
  private baseQuery(
    scope: CompanyAwareScope,
    includeOwn: boolean,
    companies: ReadonlyArray<{ clientId: string; companyContextId: string }>,
    query: SocialApprovalBoardQueryDto,
  ): SelectQueryBuilder<SocialApprovalPieceEntity> {
    const qb = this.pieces
      .createQueryBuilder('piece')
      .leftJoin(
        SocialContentItemEntity,
        'item',
        `piece.kind = 'content_item' AND item.id = piece.sourceId`,
      )
      .leftJoin(
        SocialPlanEntity,
        'plan',
        `plan.id = CASE WHEN piece.kind = 'plan_table' THEN piece.sourceId ELSE item.planId END`,
      )
      .leftJoin(
        SocialCampaignInstanceEntity,
        'campaign',
        `campaign.id = CASE WHEN piece.kind = 'campaign_table' THEN piece.sourceId ELSE item.campaignInstanceId END`,
      )
      // to_char: a raw `date` would come back as a Date at local midnight.
      .addSelect(`to_char(item.planned_date, 'YYYY-MM-DD')`, 'planned_date')
      .addSelect('item.contentType', 'content_type')
      .addSelect('item.creativeFormat', 'creative_format')
      .addSelect(
        `(SELECT COALESCE(json_agg(json_build_object('channel', d.channel, 'placement', d.placement) ORDER BY d.channel, d.placement), '[]'::json) FROM social_content_destinations d WHERE d.content_item_id = item.id)`,
        'destinations',
      )
      .addSelect('plan.title', 'plan_title')
      .addSelect('campaign.name', 'campaign_name')
      .where(
        'piece.tenantId = :tenantId AND piece.workspaceId = :workspaceId',
        {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
        },
      )
      .andWhere(`piece.sourceState <> 'hidden'`)
      .andWhere(
        new Brackets((where) => {
          if (includeOwn)
            where.orWhere(
              'piece.agencyClientId IS NULL AND piece.companyContextId IS NULL',
            );
          companies.forEach((company, index) =>
            where.orWhere(
              `piece.agencyClientId = :client${index} AND piece.companyContextId = :company${index}`,
              {
                [`client${index}`]: company.clientId,
                [`company${index}`]: company.companyContextId,
              },
            ),
          );
        }),
      );
    if (query.kind) qb.andWhere('piece.kind = :kind', { kind: query.kind });
    if (query.search?.trim())
      qb.andWhere('piece.title ILIKE :search', {
        search: `%${query.search.trim()}%`,
      });
    if (query.planId)
      qb.andWhere(
        `((piece.kind = 'plan_table' AND piece.sourceId = :planId) OR item.planId = :planId)`,
        { planId: query.planId },
      );
    if (query.campaignId)
      qb.andWhere(
        `((piece.kind = 'campaign_table' AND piece.sourceId = :campaignId) OR item.campaignInstanceId = :campaignId)`,
        { campaignId: query.campaignId },
      );
    return qb;
  }

  private async cards(
    pieces: SocialApprovalPieceEntity[],
    raw: RawCard[],
    byPair: ReadonlyMap<string, SocialApprovalInboxContext>,
    reader: ApprovalBoardReader | undefined,
    settingsByContext: Map<string, ContextSettings>,
  ) {
    if (pieces.length === 0) return [];
    const steps = await this.steps.find({
      where: { pieceId: In(pieces.map((piece) => piece.id)) },
      order: { position: 'ASC' },
    });
    const requestIds = steps
      .map((step) => step.currentRequestId)
      .filter((id): id is string => Boolean(id));
    const requests = requestIds.length
      ? await this.requests.find({ where: { id: In(requestIds) } })
      : [];
    const requestById = new Map(requests.map((item) => [item.id, item]));
    const thumbnails = await this.subjects.thumbnailPaths(requests);

    const has = (key: string) => reader?.permissions.has(key) ?? false;
    const settingsOf = (piece: SocialApprovalPieceEntity) => {
      const key = `${piece.agencyClientId}:${piece.companyContextId}`;
      let found = settingsByContext.get(key);
      if (!found) {
        found = this.settings.get({
          tenantId: piece.tenantId,
          workspaceId: piece.workspaceId,
          agencyClientId: piece.agencyClientId,
          companyContextId: piece.companyContextId,
        });
        settingsByContext.set(key, found);
      }
      return found;
    };

    return Promise.all(
      pieces.map(async (piece, index) => {
        const pieceSteps = steps.filter((step) => step.pieceId === piece.id);
        const current = pieceSteps
          .map((step) =>
            step.currentRequestId
              ? requestById.get(step.currentRequestId)
              : undefined,
          )
          .filter((item): item is SocialApprovalRequestEntity => Boolean(item));
        const awaitingInternal = current.some(
          (item) => item.status === 'awaiting_internal_review',
        );
        const designated =
          awaitingInternal && reader
            ? this.authority.canDecideInternal(await settingsOf(piece), {
                userId: reader.userId,
                role: reader.role,
              })
            : false;
        const standalone = piece.kind === 'standalone';
        const closedSource =
          !standalone && (piece.finishedAt || piece.sourceState === 'posted');
        const withThumbnail = pieceSteps.find(
          (step) =>
            step.currentRequestId && thumbnails.has(step.currentRequestId),
        );
        const active = pieceSteps.find(
          (step) => step.id === piece.activeStepId,
        );
        return {
          id: piece.id,
          kind: piece.kind,
          origin: piece.origin,
          title: piece.title,
          sendOrder: piece.sendOrder,
          boardColumn: piece.boardColumn,
          activeStep: active
            ? { id: active.id, kind: active.kind, title: active.title }
            : null,
          steps: pieceSteps.map((step) => {
            const request = step.currentRequestId
              ? requestById.get(step.currentRequestId)
              : undefined;
            return {
              id: step.id,
              kind: step.kind,
              title: step.title,
              position: step.position,
              isStale: step.isStale,
              phase: approvalStepPhase(request?.status ?? null, step.isStale),
              approvalId: request?.id ?? null,
              status: request?.status ?? null,
              resolution: request?.resolution ?? null,
              changesKind:
                request?.status === 'changes_requested'
                  ? request.changesKind
                  : null,
            };
          }),
          sourceState: piece.sourceState,
          thumbnailPath: withThumbnail
            ? (thumbnails.get(withThumbnail.currentRequestId as string)?.path ??
              null)
            : null,
          sourceId: piece.sourceId,
          cardColor: piece.cardColor,
          tags: piece.tags,
          display: piece.cardDisplay,
          actions: {
            canApprove:
              designated &&
              has('social.approvals.review.approve_internal.manager'),
            canRequestChanges:
              designated &&
              has('social.approvals.review.request_changes.manager'),
            canEdit: has('social.approvals.review.comment.assigned'),
            canDelete:
              has('social.approvals.review.comment.assigned') &&
              (has(
                'social.approvals.review.override.owner_or_admin_explicit',
              ) ||
                current.some(
                  (item) => item.requestedByUserId === reader?.userId,
                )) &&
              (standalone || current.length > 0) &&
              !closedSource,
          },
          contentType: raw[index]?.content_type ?? null,
          creativeFormat: raw[index]?.creative_format ?? null,
          destinations: raw[index]?.destinations ?? [],
          plannedDate: raw[index]?.planned_date ?? null,
          planTitle: raw[index]?.plan_title ?? null,
          campaignName: raw[index]?.campaign_name ?? null,
          finishedAt: piece.finishedAt?.toISOString() ?? null,
          lastActivityAt: piece.updatedAt.toISOString(),
          context:
            piece.agencyClientId === null
              ? ({ kind: 'own' } as const)
              : (byPair.get(
                  `${piece.agencyClientId}:${piece.companyContextId}`,
                ) as SocialApprovalInboxContext),
        };
      }),
    );
  }

  /** One context: the caller opens a card with that row's own context. */
  async pieceDetail(
    scope: CompanyAwareScope,
    pieceId: string,
    reader: ApprovalBoardReader,
  ) {
    const piece = await this.pieces.findOne({
      where: { ...approvalScopeWhere(scope), id: pieceId },
    });
    if (
      !piece ||
      (piece.kind === 'standalone' && piece.sourceState === 'hidden')
    )
      throw new NotFoundException('Peça não encontrada no contexto atual.');
    const [steps, events, settings] = await Promise.all([
      this.steps.find({
        where: { pieceId: piece.id },
        order: { position: 'ASC' },
      }),
      this.events.find({
        where: { pieceId: piece.id },
        order: { createdAt: 'ASC' },
      }),
      this.settings.get(scope),
    ]);
    const has = (key: string) => reader.permissions.has(key);
    const internalDesignated = this.authority.canDecideInternal(settings, {
      userId: reader.userId,
      role: reader.role,
    });

    const detailed = await Promise.all(
      steps.map(async (step) => {
        const approval = step.currentRequestId
          ? await this.approvals.detail(scope, step.currentRequestId)
          : null;
        const preview = approval
          ? await this.approvals.preview(scope, approval.id).catch(() => null)
          : null;
        const status = approval?.status ?? null;
        const active = status !== null && ACTIVE_STATUSES.has(status);
        const inInternalReview = status === 'awaiting_internal_review';
        return {
          id: step.id,
          kind: step.kind,
          title: step.title,
          position: step.position,
          isStale: step.isStale,
          phase: approvalStepPhase(status, step.isStale),
          approval,
          preview,
          actions: {
            canSubmit:
              (status === 'draft' || status === 'changes_requested') &&
              has('social.approvals.review.comment.assigned'),
            canApproveInternal:
              inInternalReview &&
              internalDesignated &&
              has('social.approvals.review.approve_internal.manager'),
            canRequestChanges:
              inInternalReview &&
              internalDesignated &&
              has('social.approvals.review.request_changes.manager'),
            canComment:
              active && has('social.approvals.review.comment.assigned'),
            canCancel:
              active &&
              has('social.approvals.review.override.owner_or_admin_explicit'),
            canAgencyOverride:
              active && has('social.approvals.review.agency_override.owner'),
          },
          pending: !(status === 'approved' && !step.isStale),
        };
      }),
    );
    const anyPending = detailed.some((step) => step.pending);
    const open =
      !piece.finishedAt &&
      piece.sourceState !== 'hidden' &&
      piece.sourceState !== 'posted';
    return {
      id: piece.id,
      kind: piece.kind,
      origin: piece.origin,
      title: piece.title,
      description: piece.description,
      sendOrder: piece.sendOrder,
      boardColumn: piece.boardColumn,
      activeStepId: piece.activeStepId,
      sourceState: piece.sourceState,
      finishedAt: piece.finishedAt?.toISOString() ?? null,
      finishReason: piece.finishReason,
      post: await approvalPiecePost(this.pieces.manager, piece),
      steps: detailed,
      events,
      actions: {
        canDelete:
          has('social.approvals.review.comment.assigned') &&
          (has('social.approvals.review.override.owner_or_admin_explicit') ||
            detailed.some(
              (step) => step.approval?.requestedByUserId === reader.userId,
            )) &&
          (piece.kind === 'standalone' ||
            detailed.some((step) => step.approval)) &&
          (piece.kind === 'standalone' ||
            (!piece.finishedAt && piece.sourceState !== 'posted')),
        canFinish:
          open &&
          has(
            anyPending
              ? 'social.approvals.review.agency_override.owner'
              : 'social.approvals.review.approve_internal.manager',
          ),
        finishRequiresOverride: anyPending,
      },
    };
  }

  /** Which requests one decision over the piece reaches, in step order. */
  async feedbackTargets(
    scope: CompanyAwareScope,
    pieceId: string,
    visibility?: 'internal' | 'client',
  ) {
    const piece = await this.pieces.findOne({
      where: { ...approvalScopeWhere(scope), id: pieceId },
    });
    if (
      !piece ||
      (piece.kind === 'standalone' && piece.sourceState === 'hidden')
    )
      throw new NotFoundException('Peça não encontrada no contexto atual.');
    const steps = await this.steps.find({
      where: { pieceId: piece.id },
      order: { position: 'ASC' },
    });
    const ids = steps
      .map((step) => step.currentRequestId)
      .filter((id): id is string => Boolean(id));
    const found = ids.length
      ? await this.requests.find({ where: { id: In(ids) } })
      : [];
    const ordered = ids
      .map((id) => found.find((request) => request.id === id))
      .filter((request): request is SocialApprovalRequestEntity =>
        Boolean(request),
      );
    return {
      decide: ordered
        .filter((request) => request.status === 'awaiting_internal_review')
        .map((request) => request.id),
      comment: ordered
        .filter(
          (request) =>
            ACTIVE_STATUSES.has(request.status) &&
            (visibility !== 'client' || request.sentToClientAt),
        )
        .map((request) => request.id),
    };
  }

  /** RK-1: recompute one context from its source, and close stuck rounds. */
  async reconcile(scope: CompanyAwareScope) {
    await this.sync.syncContexts(scope, [
      {
        clientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      },
    ]);
    const roundsClosed = await this.approvals.reconcileOpenRounds(scope);
    const pieces = await this.pieces.find({
      where: approvalScopeWhere(scope),
      select: { id: true },
    });
    return {
      piecesProcessed: await this.domain.recomputeMany(
        pieces.map((piece) => piece.id),
      ),
      roundsClosed,
    };
  }
}
