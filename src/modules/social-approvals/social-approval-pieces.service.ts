import { createHash } from 'node:crypto';
import { Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, type EntityManager, In } from 'typeorm';
import type { CompanyAwareScope } from '../../common/context/company-aware-scope';
import { AgencyUserProfileEntity } from '../agency/entities/agency-settings.entities';
import {
  CreativeAssetEntity,
  CreativeProductionEntity,
} from '../social-creative-studio/entities';
import {
  SocialContentItemEntity,
  SocialContentRevisionEntity,
} from '../social-planner/entities';
import { isTextEditableApproval } from './approval-content-snapshots';
import { projectApprovalPiece } from './approval-piece.projection';
import { approvalScopeWhere } from './approval-scope';
import {
  SocialApprovalEventEntity,
  SocialApprovalPieceEntity,
  SocialApprovalRequestEntity,
  SocialApprovalSnapshotEntity,
  SocialApprovalStepEntity,
  type SocialApprovalActorType,
  type ApprovalSnapshotPayload,
  type SocialApprovalEventType,
  type ApprovalTextSnapshotPayload,
  type SocialApprovalPieceKind,
  type SocialApprovalPieceOrigin,
  type SocialApprovalSendOrder,
  type SocialApprovalSnapshotKind,
  type SocialApprovalStepKind,
  type SocialApprovalSurface,
} from './entities';
import type { ResolvedApprovalSubject } from './subjects/approval-subject-resolver';

export type ApprovalEventActor = {
  type: SocialApprovalActorType;
  userId: string | null;
};

const SYSTEM_ACTOR: ApprovalEventActor = { type: 'system', userId: null };
const RECOMPUTE_CHUNK = 500;

/** Same value as `md5(text)::uuid` in the backfill migration. */
function deterministicUuid(value: string): string {
  const hex = createHash('md5').update(value).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (value && typeof value === 'object')
    return `{${Object.entries(value)
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([key, item]) => `${JSON.stringify(key)}:${canonicalJson(item)}`)
      .join(',')}}`;
  return JSON.stringify(value);
}

/** The `content_hash` of a payload, also what a live table is compared with. */
export function hashSnapshotPayload(payload: ApprovalSnapshotPayload): string {
  return createHash('sha256').update(canonicalJson(payload)).digest('hex');
}

export type ApprovalTextVersion = {
  approvalId: string;
  label: string;
  createdAt: string;
  origin: 'agency' | 'client';
  editedBy: string | null;
  isCurrent: boolean;
  fields: {
    copy: string | null;
    caption: string | null;
    script: string | null;
    cta: string | null;
    hashtags: string[];
    firstComment: string | null;
  };
};

/**
 * The persistence side of Piece, Step and Snapshot. Every method takes the
 * caller's manager so a transition, its event and its projection commit or
 * fail together (RK-1).
 */
@Injectable()
export class SocialApprovalPiecesService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  private async ensurePiece(
    manager: EntityManager,
    scope: CompanyAwareScope,
    kind: SocialApprovalPieceKind,
    sourceId: string,
    title: string,
    origin: SocialApprovalPieceOrigin,
  ) {
    await manager.query(
      `INSERT INTO "social_approval_pieces"
         ("tenant_id","workspace_id","agency_client_id","company_context_id","kind","source_id","origin","title")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT ("kind","source_id") WHERE "source_id" IS NOT NULL DO NOTHING`,
      [
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
        kind,
        sourceId,
        origin,
        title.slice(0, 255),
      ],
    );
    const piece = await manager
      .getRepository(SocialApprovalPieceEntity)
      .findOne({ where: { ...approvalScopeWhere(scope), kind, sourceId } });
    if (!piece)
      throw new NotFoundException('Peça não encontrada no contexto atual.');
    return piece;
  }

  private async ensureStep(
    manager: EntityManager,
    piece: SocialApprovalPieceEntity,
    kind: SocialApprovalStepKind,
    position: number,
    title: string,
  ) {
    await manager.query(
      `INSERT INTO "social_approval_steps"
         ("tenant_id","workspace_id","agency_client_id","company_context_id","piece_id","kind","position","title")
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
       ON CONFLICT ("piece_id","kind") WHERE "kind" IN ('table','copy','creative') DO NOTHING`,
      [
        piece.tenantId,
        piece.workspaceId,
        piece.agencyClientId,
        piece.companyContextId,
        piece.id,
        kind,
        position,
        title,
      ],
    );
    return manager
      .getRepository(SocialApprovalStepEntity)
      .findOneOrFail({ where: { pieceId: piece.id, kind } });
  }

  /** AR3: the single step of a plan or campaign table, created on demand. */
  async ensureTableStep(
    manager: EntityManager,
    scope: CompanyAwareScope,
    kind: 'plan_table' | 'campaign_table',
    sourceId: string,
    title: string,
  ) {
    const piece = await this.ensurePiece(
      manager,
      scope,
      kind,
      sourceId,
      title,
      'social_planner',
    );
    return this.ensureStep(manager, piece, 'table', 0, 'Tabela');
  }

  /** D-21: only an explicit send mode changes the order of a piece. */
  async setContentItemSendOrder(
    manager: EntityManager,
    scope: CompanyAwareScope,
    contentItemId: string,
    title: string,
    sendOrder: SocialApprovalSendOrder,
  ): Promise<void> {
    await this.ensureContentItemStep(
      manager,
      scope,
      contentItemId,
      title,
      'copy',
    );
    const piece = await this.ensurePiece(
      manager,
      scope,
      'content_item',
      contentItemId,
      title,
      'social_planner',
    );
    if (piece.sendOrder === sendOrder) return;
    await manager.update(SocialApprovalPieceEntity, piece.id, { sendOrder });
    await this.recompute(manager, piece.id);
  }

  async ensureContentItemStep(
    manager: EntityManager,
    scope: CompanyAwareScope,
    contentItemId: string,
    title: string,
    kind: 'copy' | 'creative',
  ) {
    const piece = await this.ensurePiece(
      manager,
      scope,
      'content_item',
      contentItemId,
      title,
      'social_planner',
    );
    const copy = await this.ensureStep(manager, piece, 'copy', 0, 'Copy');
    const creative = await this.ensureStep(
      manager,
      piece,
      'creative',
      1,
      'Criativo',
    );
    return kind === 'copy' ? copy : creative;
  }

  /** The step a new request of this subject belongs to, created on demand. */
  async resolveStep(
    manager: EntityManager,
    scope: CompanyAwareScope,
    subject: ResolvedApprovalSubject,
  ): Promise<SocialApprovalStepEntity> {
    if (subject.subjectType === 'approval_snapshot') {
      const step = await manager
        .getRepository(SocialApprovalStepEntity)
        .findOne({
          where: { ...approvalScopeWhere(scope), id: subject.subjectId },
        });
      if (!step)
        throw new NotFoundException('Etapa não encontrada no contexto atual.');
      return step;
    }
    if (subject.subjectType === 'planner_content_revision')
      return this.ensureContentItemStep(
        manager,
        scope,
        subject.subjectId,
        subject.title,
        'copy',
      );

    const asset = await manager
      .getRepository(CreativeAssetEntity)
      .findOne({ where: { id: subject.subjectId } });
    if (asset?.contentItemId) {
      const item = await manager
        .getRepository(SocialContentItemEntity)
        .findOne({ where: { id: asset.contentItemId } });
      if (item)
        return this.ensureContentItemStep(
          manager,
          scope,
          item.id,
          item.title,
          'creative',
        );
    }
    // A creative outside the Planner is an avulsa piece of its own. The id
    // is derived so every version of the asset lands on the same card, the
    // same way the backfill groups them.
    const pieceId = deterministicUuid(
      `approval-backfill:${subject.subjectType}:${subject.subjectId}`,
    );
    await manager.query(
      `INSERT INTO "social_approval_pieces"
         ("id","tenant_id","workspace_id","agency_client_id","company_context_id","kind","source_id","origin","title")
       VALUES ($1,$2,$3,$4,$5,'standalone',NULL,'approvals',$6)
       ON CONFLICT ("id") DO NOTHING`,
      [
        pieceId,
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
        subject.title.slice(0, 255),
      ],
    );
    const piece = await manager
      .getRepository(SocialApprovalPieceEntity)
      .findOne({ where: { ...approvalScopeWhere(scope), id: pieceId } });
    if (!piece)
      throw new NotFoundException('Peça não encontrada no contexto atual.');
    return this.ensureStep(manager, piece, 'creative', 0, 'Criativo');
  }

  async attachRequest(
    manager: EntityManager,
    step: SocialApprovalStepEntity,
    request: SocialApprovalRequestEntity,
  ): Promise<void> {
    await manager.update(SocialApprovalStepEntity, step.id, {
      currentRequestId: request.id,
      isStale: false,
    });
    await this.recompute(manager, step.pieceId);
  }

  async createStandalone(
    manager: EntityManager,
    scope: CompanyAwareScope,
    input: {
      title: string;
      stepKind: SocialApprovalStepKind;
      origin: SocialApprovalPieceOrigin;
      /** AR4: the subtask that sent it (R-18). */
      work?: {
        projectId: string | null;
        taskId: string;
        subtaskId: string;
      };
    },
  ) {
    const pieces = manager.getRepository(SocialApprovalPieceEntity);
    const steps = manager.getRepository(SocialApprovalStepEntity);
    const piece = await pieces.save(
      pieces.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        kind: 'standalone',
        sourceId: null,
        origin: input.origin,
        title: input.title,
      }),
    );
    const step = await steps.save(
      steps.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        pieceId: piece.id,
        kind: input.stepKind,
        position: 0,
        title: input.title,
        workProjectId: input.work?.projectId ?? null,
        workTaskId: input.work?.taskId ?? null,
        workSubtaskId: input.work?.subtaskId ?? null,
      }),
    );
    return { piece, step };
  }

  /** Immutable: a resend is a new `revision_number`, never an edit. */
  async createSnapshot(
    manager: EntityManager,
    step: SocialApprovalStepEntity,
    kind: SocialApprovalSnapshotKind,
    payload: ApprovalSnapshotPayload,
    actor: ApprovalEventActor,
    surface: SocialApprovalSurface,
  ) {
    await manager.getRepository(SocialApprovalStepEntity).findOneOrFail({
      where: { id: step.id },
      lock: { mode: 'pessimistic_write' },
    });
    const repository = manager.getRepository(SocialApprovalSnapshotEntity);
    const latest = await repository.findOne({
      where: { stepId: step.id },
      order: { revisionNumber: 'DESC' },
    });
    return repository.save(
      repository.create({
        tenantId: step.tenantId,
        workspaceId: step.workspaceId,
        agencyClientId: step.agencyClientId,
        companyContextId: step.companyContextId,
        stepId: step.id,
        revisionNumber: (latest?.revisionNumber ?? 0) + 1,
        kind,
        payload,
        contentHash: hashSnapshotPayload(payload),
        createdByUserId: actor.userId,
        createdBySurface: surface,
      }),
    );
  }

  private async actorName(
    manager: EntityManager,
    tenantId: string,
    actor: ApprovalEventActor,
  ): Promise<string | null> {
    if (!actor.userId) return null;
    const profile = await manager
      .getRepository(AgencyUserProfileEntity)
      .findOne({ where: { tenantId, userId: actor.userId } });
    return profile?.displayName?.trim().slice(0, 160) || null;
  }

  /** D-16: the name is captured now so the history survives the person. */
  async recordEvent(
    manager: EntityManager,
    target: {
      tenantId: string;
      workspaceId: string;
      agencyClientId: string | null;
      companyContextId: string | null;
      pieceId: string;
      stepId: string | null;
      requestId: string | null;
    },
    type: SocialApprovalEventType,
    actor: ApprovalEventActor = SYSTEM_ACTOR,
    surface: SocialApprovalSurface = 'system',
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await manager.getRepository(SocialApprovalEventEntity).insert({
      ...target,
      type,
      actorType: actor.type,
      actorUserId: actor.userId,
      actorName: await this.actorName(manager, target.tenantId, actor),
      surface,
      metadata: metadata as never,
    });
  }

  /** No step means a row the backfill has not reached yet: nothing to narrate. */
  async recordRequestEvent(
    manager: EntityManager,
    request: SocialApprovalRequestEntity,
    type: SocialApprovalEventType,
    actor: ApprovalEventActor,
    surface: SocialApprovalSurface,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    if (!request.stepId) return;
    const step = await manager
      .getRepository(SocialApprovalStepEntity)
      .findOne({ where: { id: request.stepId } });
    if (!step) return;
    await this.recordEvent(
      manager,
      {
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        agencyClientId: request.agencyClientId,
        companyContextId: request.companyContextId,
        pieceId: step.pieceId,
        stepId: step.id,
        requestId: request.id,
      },
      type,
      actor,
      surface,
      metadata,
    );
  }

  /** Recalculates the card, inside the same transaction as the transition. */
  async afterTransition(
    manager: EntityManager,
    request: SocialApprovalRequestEntity,
  ): Promise<void> {
    if (!request.stepId) return;
    const step = await manager
      .getRepository(SocialApprovalStepEntity)
      .findOne({ where: { id: request.stepId } });
    if (step) await this.recompute(manager, step.pieceId);
  }

  /**
   * D-20: the item's revision or selected creative just changed. The caller's
   * manager keeps the projection in its transaction; without one it runs on
   * its own, for writes that have already committed.
   */
  async recomputeContentItem(
    manager: EntityManager | undefined,
    contentItemId: string,
  ): Promise<void> {
    const run = async (current: EntityManager) => {
      const piece = await current
        .getRepository(SocialApprovalPieceEntity)
        .findOne({
          where: { kind: 'content_item', sourceId: contentItemId },
          select: { id: true },
        });
      if (piece) await this.recompute(current, piece.id);
    };
    if (manager) return run(manager);
    return this.dataSource.transaction(run);
  }

  /** Locks the piece, so concurrent transitions on its steps serialize. */
  async recompute(manager: EntityManager, pieceId: string): Promise<void> {
    const piece = await manager
      .getRepository(SocialApprovalPieceEntity)
      .findOne({
        where: { id: pieceId },
        lock: { mode: 'pessimistic_write' },
      });
    if (piece) await this.applyProjection(manager, [piece], true);
  }

  /**
   * Batch projection for the sync and the reconciliation. `SKIP LOCKED`
   * leaves a piece mid-transition to that transition, which recomputes it
   * itself. Returns how many pieces were processed.
   */
  async recomputeMany(ids: readonly string[]): Promise<number> {
    let processed = 0;
    for (let start = 0; start < ids.length; start += RECOMPUTE_CHUNK) {
      const chunk = ids.slice(start, start + RECOMPUTE_CHUNK);
      processed += await this.dataSource.transaction(async (manager) => {
        const pieces = await manager
          .getRepository(SocialApprovalPieceEntity)
          .createQueryBuilder('piece')
          .setLock('pessimistic_write')
          .setOnLocked('skip_locked')
          .where('piece.id IN (:...chunk)', { chunk })
          .getMany();
        await this.applyProjection(manager, pieces, false);
        return pieces.length;
      });
    }
    return processed;
  }

  /** Loads what the projection reads in one query per table, for any size. */
  private async applyProjection(
    manager: EntityManager,
    pieces: readonly SocialApprovalPieceEntity[],
    touch: boolean,
  ): Promise<void> {
    if (pieces.length === 0) return;
    const steps = await manager
      .getRepository(SocialApprovalStepEntity)
      .find({ where: { pieceId: In(pieces.map((piece) => piece.id)) } });
    const requestIds = steps
      .map((step) => step.currentRequestId)
      .filter((id): id is string => Boolean(id));
    const requests = requestIds.length
      ? await manager
          .getRepository(SocialApprovalRequestEntity)
          .find({ where: { id: In(requestIds) } })
      : [];
    const requestById = new Map(requests.map((item) => [item.id, item]));

    const stale = await this.staleSteps(manager, pieces, steps, requestById);
    for (const step of steps) {
      const isStale = stale.has(step.id);
      if (isStale !== step.isStale) {
        await manager.update(SocialApprovalStepEntity, step.id, { isStale });
        step.isStale = isStale;
        if (isStale)
          await this.recordEvent(
            manager,
            {
              tenantId: step.tenantId,
              workspaceId: step.workspaceId,
              agencyClientId: step.agencyClientId,
              companyContextId: step.companyContextId,
              pieceId: step.pieceId,
              stepId: step.id,
              requestId: step.currentRequestId,
            },
            'reopened_stale',
          );
      }
    }

    for (const piece of pieces) {
      const next = projectApprovalPiece({
        finishedAt: piece.finishedAt,
        sourceState: piece.sourceState,
        sendOrder: piece.sendOrder,
        steps: steps
          .filter((step) => step.pieceId === piece.id)
          .map((step) => ({
            id: step.id,
            position: step.position,
            isStale: step.isStale,
            status: step.currentRequestId
              ? (requestById.get(step.currentRequestId)?.status ?? null)
              : null,
          })),
      });
      if (
        touch ||
        next.boardColumn !== piece.boardColumn ||
        next.activeStepId !== piece.activeStepId
      ) {
        await manager.update(SocialApprovalPieceEntity, piece.id, next);
        Object.assign(piece, next);
      }
    }
  }

  /**
   * D-20 for content items: an approved copy or creative that is no longer
   * what the item carries. A selected Studio version decides for the creative
   * (CS5: approving v1 never makes v2 approved). Hash-tracked snapshots keep
   * the flag the sync computed, since nothing here can re-read them.
   */
  private async staleSteps(
    manager: EntityManager,
    pieces: readonly SocialApprovalPieceEntity[],
    steps: readonly SocialApprovalStepEntity[],
    requestById: ReadonlyMap<string, SocialApprovalRequestEntity>,
  ): Promise<Set<string>> {
    const approvedOf = (step: SocialApprovalStepEntity) => {
      const request = step.currentRequestId
        ? requestById.get(step.currentRequestId)
        : undefined;
      return request?.status === 'approved' ? request : undefined;
    };
    const stale = new Set(
      steps
        .filter(
          (step) =>
            step.isStale &&
            (step.kind === 'table' ||
              approvedOf(step)?.subjectType === 'approval_snapshot'),
        )
        .map((step) => step.id),
    );

    const itemIds = pieces
      .filter((piece) => piece.kind === 'content_item' && piece.sourceId)
      .map((piece) => piece.sourceId as string);
    const items = itemIds.length
      ? await manager
          .getRepository(SocialContentItemEntity)
          .find({ where: { id: In(itemIds) } })
      : [];
    const pieceById = new Map(pieces.map((piece) => [piece.id, piece]));
    const itemById = new Map(items.map((item) => [item.id, item]));

    const approvedCreatives = steps.filter(
      (step) => step.kind === 'creative' && approvedOf(step),
    );
    const creativeAssetIds = approvedCreatives
      .map((step) => approvedOf(step)?.subjectId)
      .filter((id): id is string => Boolean(id));
    const assets = creativeAssetIds.length
      ? await manager
          .getRepository(CreativeAssetEntity)
          .find({ where: { id: In(creativeAssetIds) } })
      : [];
    const assetById = new Map(assets.map((asset) => [asset.id, asset]));
    const productionItemIds = approvedCreatives
      .map((step) => pieceById.get(step.pieceId))
      .filter((piece) => piece?.kind === 'content_item')
      .map((piece) => piece?.sourceId as string);
    const productions = productionItemIds.length
      ? await manager
          .getRepository(CreativeProductionEntity)
          .find({ where: { contentItemId: In(productionItemIds) } })
      : [];
    const selectedByItem = new Map(
      productions.map((row) => [row.contentItemId, row.selectedVersionId]),
    );

    for (const step of steps) {
      const approved = approvedOf(step);
      if (!approved) continue;
      const piece = pieceById.get(step.pieceId);
      if (step.kind === 'copy') {
        const current = piece?.sourceId
          ? itemById.get(piece.sourceId)?.currentRevisionId
          : null;
        if (current && current !== approved.subjectRevisionId)
          stale.add(step.id);
      } else if (step.kind === 'creative') {
        const selected =
          piece?.kind === 'content_item' && piece.sourceId
            ? selectedByItem.get(piece.sourceId)
            : null;
        const current =
          selected ?? assetById.get(approved.subjectId)?.currentVersionId;
        if (current && current !== approved.subjectRevisionId)
          stale.add(step.id);
      }
    }
    return stale;
  }

  /**
   * R-08: every version of the text a reader may compare, oldest first. A
   * client only gets what was actually put in front of them, so an internal
   * draft of the agency never shows up in their history.
   */
  async textVersions(
    scope: CompanyAwareScope,
    request: SocialApprovalRequestEntity,
    audience: 'agency' | 'client',
  ): Promise<{ versions: ApprovalTextVersion[] }> {
    if (!isTextEditableApproval(request) || !request.stepId)
      return { versions: [] };
    const manager = this.dataSource.manager;
    const history = await manager
      .getRepository(SocialApprovalRequestEntity)
      .find({
        where: { ...approvalScopeWhere(scope), stepId: request.stepId },
        order: { createdAt: 'ASC', id: 'ASC' },
      });
    const byRevision = new Map(
      history
        .filter(
          (row) =>
            isTextEditableApproval(row) &&
            (audience === 'client'
              ? row.sentToClientAt !== null
              : row.status !== 'draft'),
        )
        .map((row) => [row.subjectRevisionId, row]),
    );
    const rows = [...byRevision.values()];
    if (rows.length === 0) return { versions: [] };
    const ids = rows.map((row) => row.subjectRevisionId);
    const [revisions, snapshots, edits] = await Promise.all([
      manager.getRepository(SocialContentRevisionEntity).find({
        where: {
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          id: In(ids),
        },
      }),
      manager.getRepository(SocialApprovalSnapshotEntity).find({
        where: { ...approvalScopeWhere(scope), id: In(ids) },
      }),
      manager.getRepository(SocialApprovalEventEntity).find({
        where: {
          requestId: In(rows.map((row) => row.id)),
          type: 'edited',
        },
      }),
    ]);
    const revisionById = new Map(revisions.map((row) => [row.id, row]));
    const snapshotById = new Map(snapshots.map((row) => [row.id, row]));
    const editByRequest = new Map(edits.map((row) => [row.requestId, row]));

    const fieldsOf = (id: string): ApprovalTextVersion['fields'] | null => {
      const revision = revisionById.get(id);
      if (revision)
        return {
          copy: revision.copy,
          caption: revision.caption,
          script: revision.script,
          cta: revision.cta,
          hashtags: revision.hashtags,
          firstComment: revision.firstComment,
        };
      const snapshot = snapshotById.get(id);
      return snapshot
        ? {
            copy: (snapshot.payload as ApprovalTextSnapshotPayload).body,
            caption: null,
            script: null,
            cta: null,
            hashtags: [],
            firstComment: null,
          }
        : null;
    };
    const versions = rows.flatMap((row) => {
      const fields = fieldsOf(row.subjectRevisionId);
      if (!fields) return [];
      const edit = editByRequest.get(row.id);
      return [
        {
          approvalId: row.id,
          label: row.subjectVersionLabel,
          createdAt: row.createdAt.toISOString(),
          origin: edit ? ('client' as const) : ('agency' as const),
          editedBy: edit ? (edit.actorName ?? 'Cliente') : null,
          isCurrent: false,
          fields,
        },
      ];
    });
    if (versions.length) versions[versions.length - 1].isCurrent = true;
    return { versions };
  }

  /** Where the bytes of a snapshot slot live. Never returned to a caller. */
  async snapshotForMedia(
    scope: CompanyAwareScope,
    where: { snapshotId: string; stepId?: string },
  ) {
    const snapshot = await this.dataSource
      .getRepository(SocialApprovalSnapshotEntity)
      .findOne({
        where: {
          ...approvalScopeWhere(scope),
          id: where.snapshotId,
          ...(where.stepId ? { stepId: where.stepId } : {}),
        },
      });
    if (!snapshot) throw new NotFoundException('Mídia não encontrada.');
    return snapshot;
  }
}
