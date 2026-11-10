import { randomUUID } from 'node:crypto';
import {
  BadRequestException,
  ConflictException,
  HttpException,
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, In, IsNull, Not } from 'typeorm';
import {
  resolveCompanyAwareScope,
  type CompanyAwareScope,
} from '../../common/context/company-aware-scope';
import type { RequestContext } from '../../common/context/request-context.interface';
import { PlatformPermissionService } from '../permissions';
import { CREATIVE_PRODUCTION_PERMISSIONS } from '../social-creative-studio/creative-production.permissions';
import {
  CreativeProductionReadinessService,
  type CreativeProductionSnapshot,
} from '../social-creative-studio/creative-production-readiness.service';
import { CreativeProductionService } from '../social-creative-studio/creative-production.service';
import {
  buildTablePayloads,
  destinationMediaIds,
  destinationMediaPlacements,
  tableWarnings,
  type ApprovalTableSource,
} from '../social-approvals/approval-content-snapshots';
import { approvalScopeWhere } from '../social-approvals/approval-scope';
import { SocialApprovalTransitionRegistry } from '../social-approvals/approval-transition.port';
import {
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalSnapshotEntity,
  SocialApprovalStepEntity,
  type ApprovalSnapshotPayload,
  type SocialApprovalSnapshotKind,
} from '../social-approvals/entities';
import { SocialApprovalPieceActionsService } from '../social-approvals/social-approval-piece-actions.service';
import { SocialApprovalPieceSyncService } from '../social-approvals/social-approval-piece-sync.service';
import {
  hashSnapshotPayload,
  SocialApprovalPiecesService,
} from '../social-approvals/social-approval-pieces.service';
import {
  SocialApprovalsService,
  type ApprovalActor,
  type ApprovalOperation,
} from '../social-approvals/social-approvals.service';
import { ApprovalSubjectResolver } from '../social-approvals/subjects/approval-subject-resolver';
import {
  SocialCampaignInstanceEntity,
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import { SocialContentProductionStatusService } from '../social-planner/services/social-content-production-status.service';
import type { ContentApprovalMode } from './dto/social-planner-approval.dto';

const IN_REVIEW = new Set(['awaiting_internal_review', 'awaiting_client']);

export type ContentSendBlocker =
  | 'copy_missing'
  | 'copy_not_approved'
  | 'creative_missing'
  | 'creative_unavailable'
  | 'creative_revision_required'
  | 'in_review'
  | 'approved'
  | 'content_unavailable'
  | 'piece_finished';

type StepFacts = {
  step: SocialApprovalStepEntity | null;
  request: SocialApprovalRequestEntity | null;
};

type ContentFacts = {
  snapshot: CreativeProductionSnapshot;
  item: SocialContentItemEntity;
  piece: SocialApprovalPieceEntity | null;
  copy: StepFacts;
  creative: StepFacts;
  media: string[];
  copyApproved: boolean;
  creativeSource: 'creative_studio' | 'media_set' | null;
  unavailable: boolean;
};

type SentStep = {
  changed: boolean;
  approvalId: string | null;
  status: string | null;
};

function conflict(
  code: string,
  message: string,
  extra: Record<string, unknown> = {},
) {
  return new ConflictException({
    statusCode: 409,
    error: 'Conflict',
    code,
    message,
    ...extra,
  });
}

/**
 * AR3 — the Planner as the point of sending (R-09, R-10).
 *
 * A join module (D-30): the Planner cannot import the Studio, and "Tudo junto"
 * needs both. Each side keeps ownership of what it writes: the Studio sends
 * its selected version, Approvals runs the state machine and only
 * `SocialContentProductionStatusService` touches `planningStatus` (D-22).
 */
@Injectable()
export class SocialPlannerApprovalsService implements OnModuleInit {
  private readonly logger = new Logger(SocialPlannerApprovalsService.name);

  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly approvals: SocialApprovalsService,
    private readonly pieces: SocialApprovalPiecesService,
    private readonly pieceActions: SocialApprovalPieceActionsService,
    private readonly sync: SocialApprovalPieceSyncService,
    private readonly subjects: ApprovalSubjectResolver,
    private readonly plannerStatus: SocialContentProductionStatusService,
    private readonly production: CreativeProductionService,
    private readonly readiness: CreativeProductionReadinessService,
    private readonly transitions: SocialApprovalTransitionRegistry,
    private readonly permissions: PlatformPermissionService,
  ) {}

  onModuleInit(): void {
    this.transitions.register((request) => this.onTransition(request));
  }

  /**
   * D-23: a direct upload has no Studio version for CS5's observer to read, so
   * its Planner reflection is driven from here, through the same phases.
   */
  private async onTransition(
    request: SocialApprovalRequestEntity,
  ): Promise<void> {
    if (request.subjectType === 'planner_content_revision')
      return this.onCopyTransition(request);
    if (
      request.subjectType !== 'approval_snapshot' ||
      request.displayType !== 'media_set' ||
      !request.stepId
    )
      return;
    const manager = this.dataSource.manager;
    const step = await manager
      .getRepository(SocialApprovalStepEntity)
      .findOne({ where: { id: request.stepId } });
    const piece =
      step &&
      (await manager
        .getRepository(SocialApprovalPieceEntity)
        .findOne({ where: { id: step.pieceId } }));
    if (piece?.kind !== 'content_item' || !piece.sourceId) return;
    const phase =
      request.status === 'approved'
        ? ('final' as const)
        : IN_REVIEW.has(request.status)
          ? ('in_approval' as const)
          : ('in_production' as const);
    await this.plannerStatus.reflectCreativeProduction(request, {
      contentItemId: piece.sourceId,
      phase,
      actorUserId: null,
    });
  }

  /**
   * D-22: an approved copy opens the creative segment of the item. Re-reads
   * the Planner, so approving a revision that is no longer the current text
   * moves nothing.
   */
  private async onCopyTransition(
    request: SocialApprovalRequestEntity,
  ): Promise<void> {
    if (request.status !== 'approved') return;
    const item = await this.dataSource.manager
      .getRepository(SocialContentItemEntity)
      .findOne({
        where: { id: request.subjectId },
        select: { id: true, currentRevisionId: true },
      });
    if (item?.currentRevisionId !== request.subjectRevisionId) return;
    await this.plannerStatus.reflectCopyHandoff(request, {
      contentItemId: request.subjectId,
      actorUserId: null,
    });
  }

  private actor(ctx: RequestContext): ApprovalActor {
    if (!ctx.userId)
      throw new BadRequestException(
        'Usuário autenticado é obrigatório para esta ação.',
      );
    return { type: 'user', userId: ctx.userId };
  }

  // ── Tables ──────────────────────────────────────────────────────────────

  private async planOrThrow(scope: CompanyAwareScope, planId: string) {
    const plan = await this.dataSource.manager
      .getRepository(SocialPlanEntity)
      .findOne({
        where: {
          ...approvalScopeWhere(scope),
          id: planId,
          deletedAt: IsNull(),
        },
      });
    if (!plan) throw new NotFoundException('Plano não encontrado.');
    return plan;
  }

  private async campaignOrThrow(scope: CompanyAwareScope, campaignId: string) {
    const campaign = await this.dataSource.manager
      .getRepository(SocialCampaignInstanceEntity)
      .findOne({ where: { ...approvalScopeWhere(scope), id: campaignId } });
    if (!campaign) throw new NotFoundException('Campanha não encontrada.');
    return campaign;
  }

  async planState(ctx: RequestContext, planId: string) {
    const scope = resolveCompanyAwareScope(ctx);
    const plan = await this.planOrThrow(scope, planId);
    return this.tableState(
      scope,
      'plan_table',
      plan.id,
      plan.status !== 'archived',
    );
  }

  async campaignState(ctx: RequestContext, campaignId: string) {
    const scope = resolveCompanyAwareScope(ctx);
    const campaign = await this.campaignOrThrow(scope, campaignId);
    return this.tableState(
      scope,
      'campaign_table',
      campaign.id,
      this.campaignOpen(campaign),
    );
  }

  private async tableState(
    scope: CompanyAwareScope,
    kind: ApprovalTableSource['kind'],
    sourceId: string,
    sourceOpen: boolean,
  ) {
    await this.sync.refreshStaleness(scope, [
      {
        clientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      },
    ]);
    const manager = this.dataSource.manager;
    const payload = (
      await buildTablePayloads(manager, [{ key: 'table', kind, sourceId }])
    ).get('table')!;
    const piece = await manager
      .getRepository(SocialApprovalPieceEntity)
      .findOne({ where: { ...approvalScopeWhere(scope), kind, sourceId } });
    const { step, request } = await this.stepOf(manager, piece, 'table');
    const canSend =
      sourceOpen &&
      (await this.hasOpenItems(manager, kind, sourceId)) &&
      !piece?.finishedAt;
    return {
      pieceId: piece?.id ?? null,
      approvalId: request?.id ?? null,
      status: request?.status ?? null,
      isStale: step?.isStale ?? false,
      finishedAt: piece?.finishedAt?.toISOString() ?? null,
      itemCount: payload.rows.length,
      warnings: tableWarnings(payload),
      canSend,
    };
  }

  async sendPlanTable(ctx: RequestContext, planId: string) {
    const scope = resolveCompanyAwareScope(ctx);
    const plan = await this.planOrThrow(scope, planId);
    if (plan.status === 'archived')
      throw conflict(
        'approval_content_unavailable',
        'Este plano está arquivado.',
      );
    return this.sendTable(ctx, scope, 'plan_table', plan.id, plan.title);
  }

  async sendCampaignTable(ctx: RequestContext, campaignId: string) {
    const scope = resolveCompanyAwareScope(ctx);
    const campaign = await this.campaignOrThrow(scope, campaignId);
    if (!this.campaignOpen(campaign))
      throw conflict(
        'approval_content_unavailable',
        'Só campanhas planejadas ou ativas podem ser enviadas.',
      );
    return this.sendTable(
      ctx,
      scope,
      'campaign_table',
      campaign.id,
      campaign.name,
    );
  }

  /** R-09: every send is a new immutable picture of the table as it is now. */
  private async sendTable(
    ctx: RequestContext,
    scope: CompanyAwareScope,
    kind: ApprovalTableSource['kind'],
    sourceId: string,
    title: string,
  ) {
    const actor = this.actor(ctx);
    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const outcome = await this.dataSource.transaction(async (manager) => {
      const payload = (
        await buildTablePayloads(manager, [{ key: 'table', kind, sourceId }])
      ).get('table')!;
      if (!(await this.hasOpenItems(manager, kind, sourceId)))
        throw conflict(
          'approval_table_empty',
          'Não há itens para enviar nesta tabela.',
        );
      const step = await this.pieces.ensureTableStep(
        manager,
        scope,
        kind,
        sourceId,
        title,
      );
      await this.assertPieceOpen(manager, step.pieceId);
      const sent = await this.sendSnapshot(
        manager,
        scope,
        actor,
        step,
        'table',
        payload,
        title,
        afterCommit,
        null,
      );
      return { ...sent, step, payload };
    });
    for (const run of afterCommit) await run();
    return {
      changed: outcome.changed,
      pieceId: outcome.step.pieceId,
      approvalId: outcome.request.id,
      status: outcome.request.status,
      revisionLabel: outcome.request.subjectVersionLabel,
      itemCount: outcome.payload.rows.length,
      warnings: tableWarnings(outcome.payload),
    };
  }

  /** D-31: the same rule that keeps the piece on the board once it is sent. */
  private campaignOpen(campaign: SocialCampaignInstanceEntity) {
    return campaign.status === 'planned' || campaign.status === 'active';
  }

  private hasOpenItems(
    manager: EntityManager,
    kind: ApprovalTableSource['kind'],
    sourceId: string,
  ) {
    return manager.getRepository(SocialContentItemEntity).exists({
      where: {
        ...(kind === 'plan_table'
          ? { planId: sourceId }
          : { campaignInstanceId: sourceId }),
        calendarOnly: false,
        archivedAt: IsNull(),
        deletedAt: IsNull(),
        planningStatus: Not(In(['cancelled', 'posted'])),
      },
    });
  }

  private async assertPieceOpen(manager: EntityManager, pieceId: string) {
    const piece = await manager
      .getRepository(SocialApprovalPieceEntity)
      .findOneOrFail({ where: { id: pieceId } });
    if (piece.finishedAt)
      throw conflict('approval_piece_finished', 'Esta peça já foi finalizada.');
  }

  /** The same picture already under review is not a new send (double click). */
  private async sendSnapshot(
    manager: EntityManager,
    scope: CompanyAwareScope,
    actor: ApprovalActor,
    step: SocialApprovalStepEntity,
    kind: SocialApprovalSnapshotKind,
    payload: ApprovalSnapshotPayload,
    title: string,
    afterCommit: ApprovalOperation['afterCommit'],
    batchId: string | null,
  ) {
    const current = step.currentRequestId
      ? await manager
          .getRepository(SocialApprovalRequestEntity)
          .findOne({ where: { id: step.currentRequestId } })
      : null;
    if (
      current &&
      IN_REVIEW.has(current.status) &&
      current.subjectType === 'approval_snapshot'
    ) {
      const reviewed = await manager
        .getRepository(SocialApprovalSnapshotEntity)
        .findOne({ where: { id: current.subjectRevisionId } });
      if (reviewed?.contentHash === hashSnapshotPayload(payload))
        return { request: current, changed: false };
    }
    const snapshot = await this.pieces.createSnapshot(
      manager,
      step,
      kind,
      payload,
      actor,
      'planner',
    );
    return this.approvals.sendInTransaction(
      manager,
      scope,
      actor,
      {
        subjectType: 'approval_snapshot',
        subjectId: step.id,
        subjectRevisionId: snapshot.id,
        sourceModule: 'social_approvals',
        displayType: snapshot.kind,
        title,
        subjectVersionLabel: `r${snapshot.revisionNumber}`,
      },
      afterCommit,
      { batchId, surface: 'planner' },
    );
  }

  // ── Content items ───────────────────────────────────────────────────────

  private async stepOf(
    manager: EntityManager,
    piece: SocialApprovalPieceEntity | null,
    kind: SocialApprovalStepEntity['kind'],
  ): Promise<StepFacts> {
    if (!piece) return { step: null, request: null };
    const step = await manager
      .getRepository(SocialApprovalStepEntity)
      .findOne({ where: { pieceId: piece.id, kind } });
    const request = step?.currentRequestId
      ? await manager
          .getRepository(SocialApprovalRequestEntity)
          .findOne({ where: { id: step.currentRequestId } })
      : null;
    return { step, request };
  }

  private async contentFacts(
    scope: CompanyAwareScope,
    contentId: string,
  ): Promise<ContentFacts> {
    const snapshot = await this.readiness.snapshot(scope, contentId);
    const item = snapshot.contentItem;
    const manager = this.dataSource.manager;
    const piece = await manager
      .getRepository(SocialApprovalPieceEntity)
      .findOne({
        where: {
          ...approvalScopeWhere(scope),
          kind: 'content_item',
          sourceId: item.id,
        },
      });
    const [copy, creative, mediaByItem] = await Promise.all([
      this.stepOf(manager, piece, 'copy'),
      this.stepOf(manager, piece, 'creative'),
      destinationMediaIds(manager, [item.id]),
    ]);
    const media = mediaByItem.get(item.id) ?? [];
    const usableSelection =
      snapshot.selection && !snapshot.selection.unavailableReason;
    return {
      snapshot,
      item,
      piece,
      copy,
      creative,
      media,
      copyApproved:
        copy.request?.status === 'approved' &&
        !copy.step?.isStale &&
        copy.request.subjectRevisionId === item.currentRevisionId,
      creativeSource: usableSelection
        ? 'creative_studio'
        : !snapshot.selection && media.length
          ? 'media_set'
          : null,
      unavailable:
        item.calendarOnly ||
        Boolean(item.archivedAt) ||
        item.planningStatus === 'cancelled' ||
        item.planningStatus === 'posted',
    };
  }

  private blockers(facts: ContentFacts) {
    const general: ContentSendBlocker | null = facts.unavailable
      ? 'content_unavailable'
      : facts.piece?.finishedAt
        ? 'piece_finished'
        : null;
    const copy: ContentSendBlocker | null =
      general ??
      (!facts.item.currentRevisionId
        ? 'copy_missing'
        : IN_REVIEW.has(facts.copy.request?.status ?? '') &&
            facts.copy.request?.subjectRevisionId ===
              facts.item.currentRevisionId
          ? 'in_review'
          : facts.copyApproved
            ? 'approved'
            : null);
    const creativeReady: ContentSendBlocker | null =
      general ??
      (facts.snapshot.selection?.unavailableReason
        ? 'creative_unavailable'
        : !facts.creativeSource
          ? 'creative_missing'
          : facts.creativeSource === 'creative_studio' &&
              facts.snapshot.approval.state === 'changes_requested'
            ? 'creative_revision_required'
            : null);
    const creative: ContentSendBlocker | null =
      creativeReady ??
      (facts.creativeSource === 'creative_studio' &&
      facts.snapshot.approval.state === 'approved'
        ? 'approved'
        : facts.creativeSource === 'creative_studio' &&
            facts.snapshot.approval.state === 'pending' &&
            facts.snapshot.approval.projection?.status !== 'draft'
          ? 'in_review'
          : facts.creativeSource === 'media_set' &&
              IN_REVIEW.has(facts.creative.request?.status ?? '') &&
              facts.creative.request?.displayType === 'media_set'
            ? 'in_review'
            : facts.creativeSource === 'media_set' &&
                facts.creative.request?.status === 'approved' &&
                facts.creative.request.displayType === 'media_set' &&
                !facts.creative.step?.isStale
              ? 'approved'
              : facts.piece?.sendOrder !== 'together' && !facts.copyApproved
                ? 'copy_not_approved'
                : null);
    return { copy, creative, creativeReady };
  }

  /** R-09/D-01/D-21: what the popover shows, decided here and not in the UI. */
  async contentState(ctx: RequestContext, contentId: string) {
    const scope = resolveCompanyAwareScope(ctx);
    await this.sync.refreshStaleness(scope, [
      {
        clientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
      },
    ]);
    const facts = await this.contentFacts(scope, contentId);
    const manager = this.dataSource.manager;
    const tablePiece = await manager
      .getRepository(SocialApprovalPieceEntity)
      .findOne({
        where: {
          ...approvalScopeWhere(scope),
          kind: 'plan_table',
          sourceId: facts.item.planId,
        },
      });
    const table = await this.stepOf(manager, tablePiece, 'table');
    const { copy, creative, creativeReady } = this.blockers(facts);
    const stepView = (step: StepFacts) => ({
      approvalId: step.request?.id ?? null,
      status: step.request?.status ?? null,
      isStale: step.step?.isStale ?? false,
    });
    const settled = (blocker: ContentSendBlocker | null) =>
      blocker === 'in_review' || blocker === 'approved';
    // Copy under review or approved never stops "Tudo junto" (D-21 sends what
    // is left); both settled means there is simply nothing to send.
    const togetherBlocker =
      copy && !settled(copy)
        ? copy
        : (creativeReady ?? (settled(copy) && settled(creative) ? copy : null));
    return {
      pieceId: facts.piece?.id ?? null,
      sendOrder: facts.piece?.sendOrder ?? 'sequential',
      boardColumn: facts.piece?.boardColumn ?? null,
      finishedAt: facts.piece?.finishedAt?.toISOString() ?? null,
      copy: {
        ...stepView(facts.copy),
        ready: copy !== 'copy_missing',
        blocker: copy,
      },
      creative: {
        ...stepView(facts.creative),
        source: facts.creativeSource,
        ready: creativeReady === null,
        blocker: creative,
      },
      // D-01: never blocks; the screen only warns.
      table: {
        pieceId: tablePiece?.id ?? null,
        status: table.request?.status ?? null,
        pending:
          table.request?.status !== 'approved' || Boolean(table.step?.isStale),
      },
      modes: {
        copy: { allowed: copy === null, blocker: copy },
        creative: { allowed: creative === null, blocker: creative },
        sequential: { allowed: copy === null, blocker: copy },
        together: {
          allowed: togetherBlocker === null,
          blocker: togetherBlocker,
        },
      },
    };
  }

  async sendContent(
    ctx: RequestContext,
    contentId: string,
    mode: ContentApprovalMode,
    batchId: string | null = null,
  ) {
    const scope = resolveCompanyAwareScope(ctx);
    const actor = this.actor(ctx);
    if (mode === 'creative' || mode === 'together')
      await this.permissions.assertCan(
        {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          userId: actor.userId!,
          role: ctx.role ?? '',
        },
        CREATIVE_PRODUCTION_PERMISSIONS.submitReview,
      );
    const facts = await this.contentFacts(scope, contentId);
    this.assertSendable(facts);

    let copy: SentStep | null = null;
    let creative: SentStep | null = null;
    switch (mode) {
      case 'copy':
        copy = await this.sendCopy(scope, actor, facts, batchId, null);
        break;
      case 'sequential':
        copy = await this.sendCopy(scope, actor, facts, batchId, 'sequential');
        break;
      case 'creative':
        // D-21: only an explicit send, and only after the copy is approved.
        if (facts.piece?.sendOrder !== 'together' && !facts.copyApproved)
          throw conflict(
            'approval_copy_not_approved',
            'Aprove a copy antes de enviar o criativo.',
          );
        creative = await this.sendCreative(ctx, scope, actor, facts, batchId);
        break;
      case 'together': {
        const { creativeReady } = this.blockers(facts);
        const missing = [
          ...(facts.item.currentRevisionId ? [] : ['copy']),
          ...(creativeReady ? ['creative'] : []),
        ];
        if (missing.length)
          throw conflict(
            'approval_together_not_ready',
            'Para enviar tudo junto, a copy e o criativo precisam estar prontos.',
            { missing, blocker: creativeReady },
          );
        copy = await this.sendCopy(scope, actor, facts, batchId, 'together');
        // D-22: CS2B.4 only enters the creative segment from `copy_ready`.
        await this.plannerStatus.reflectCopyHandoff(scope, {
          contentItemId: facts.item.id,
          actorUserId: actor.userId,
        });
        creative = await this.sendCreative(ctx, scope, actor, facts, batchId);
        break;
      }
    }
    return {
      changed: Boolean(copy?.changed || creative?.changed),
      copy,
      creative,
      state: await this.contentState(ctx, contentId),
    };
  }

  private assertSendable(facts: ContentFacts) {
    if (facts.unavailable)
      throw conflict(
        'approval_content_unavailable',
        'Este conteúdo não pode ser enviado para aprovação.',
      );
    if (facts.piece?.finishedAt)
      throw conflict('approval_piece_finished', 'Esta peça já foi finalizada.');
  }

  private async sendCopy(
    scope: CompanyAwareScope,
    actor: ApprovalActor,
    facts: ContentFacts,
    batchId: string | null,
    sendOrder: 'sequential' | 'together' | null,
  ): Promise<SentStep> {
    const { item } = facts;
    if (!item.currentRevisionId)
      throw conflict(
        'approval_copy_not_ready',
        'Este conteúdo ainda não tem texto salvo.',
      );
    const subject = await this.subjects.resolve(scope, {
      subjectType: 'planner_content_revision',
      subjectId: item.id,
      subjectRevisionId: item.currentRevisionId,
    });
    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const outcome = await this.dataSource.transaction(async (manager) => {
      if (sendOrder)
        await this.pieces.setContentItemSendOrder(
          manager,
          scope,
          item.id,
          item.title,
          sendOrder,
        );
      if (facts.copyApproved)
        return { request: facts.copy.request!, changed: false };
      return this.approvals.sendInTransaction(
        manager,
        scope,
        actor,
        subject,
        afterCommit,
        { batchId, surface: 'planner' },
      );
    });
    for (const run of afterCommit) await run();
    return {
      changed: outcome.changed,
      approvalId: outcome.request.id,
      status: outcome.request.status,
    };
  }

  private async sendCreative(
    ctx: RequestContext,
    scope: CompanyAwareScope,
    actor: ApprovalActor,
    facts: ContentFacts,
    batchId: string | null,
  ): Promise<SentStep> {
    if (facts.creativeSource === 'creative_studio') {
      const sent = await this.production.sendSelectedForApproval(
        ctx,
        scope,
        facts.item.id,
      );
      const submitted = await this.approvals.submitExisting(
        scope,
        sent.approvalId,
        actor.userId,
        { batchId, surface: 'planner' },
      );
      return {
        changed: sent.changed || submitted.changed,
        approvalId: sent.approvalId,
        status: submitted.request.status,
      };
    }
    if (facts.creativeSource !== 'media_set')
      throw conflict(
        'approval_creative_not_ready',
        'Selecione ou envie um criativo antes de enviar para aprovação.',
      );
    const { item } = facts;
    // Resolved first: scope and media checks run outside the transaction.
    const [media, placements] = await Promise.all([
      this.pieceActions.mediaSet(scope, facts.media),
      destinationMediaPlacements(this.dataSource.manager, item.id),
    ]);
    const payload = {
      items: media.items.map((entry) => ({
        ...entry,
        placements: placements.get(entry.mediaAssetId) ?? [],
      })),
    };
    const afterCommit: ApprovalOperation['afterCommit'] = [];
    const outcome = await this.dataSource.transaction(async (manager) => {
      const step = await this.pieces.ensureContentItemStep(
        manager,
        scope,
        item.id,
        item.title,
        'creative',
      );
      return this.sendSnapshot(
        manager,
        scope,
        actor,
        step,
        'media_set',
        payload,
        item.title,
        afterCommit,
        batchId,
      );
    });
    for (const run of afterCommit) await run();
    await this.plannerStatus.reflectCreativeProduction(scope, {
      contentItemId: item.id,
      phase: 'in_approval',
      actorUserId: actor.userId,
    });
    return {
      changed: outcome.changed,
      approvalId: outcome.request.id,
      status: outcome.request.status,
    };
  }

  /**
   * D-19: one `batch_id`, one outcome per item. An item that cannot go does
   * not hold back the others, so each is reported instead of thrown.
   */
  async sendContentBatch(
    ctx: RequestContext,
    contentIds: readonly string[],
    mode: ContentApprovalMode,
  ) {
    const batchId = randomUUID();
    const results: Array<{
      contentId: string;
      ok: boolean;
      changed: boolean;
      code: string | null;
      message: string | null;
    }> = [];
    for (const contentId of new Set(contentIds)) {
      try {
        const sent = await this.sendContent(ctx, contentId, mode, batchId);
        results.push({
          contentId,
          ok: true,
          changed: sent.changed,
          code: null,
          message: null,
        });
      } catch (error) {
        results.push({
          contentId,
          ok: false,
          changed: false,
          ...this.failure(error),
        });
      }
    }
    return {
      batchId,
      sent: results.filter((result) => result.ok && result.changed).length,
      failed: results.filter((result) => !result.ok).length,
      results,
    };
  }

  private failure(error: unknown) {
    if (error instanceof HttpException) {
      const response = error.getResponse();
      return {
        code:
          typeof response === 'object' && 'code' in response
            ? String(response.code)
            : null,
        message: error.message,
      };
    }
    this.logger.error(
      `batch send failed: ${error instanceof Error ? error.message : String(error)}`,
    );
    return {
      code: 'internal_error',
      message: 'Não foi possível enviar este item.',
    };
  }
}
