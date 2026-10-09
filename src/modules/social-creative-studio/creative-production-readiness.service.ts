import {
  Injectable,
  Logger,
  NotFoundException,
  type OnModuleInit,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, IsNull, Repository } from 'typeorm';
import { MediaAssetEntity } from '../../common/media-assets';
import type { SocialApprovalStateProjection } from '../social-approvals/approval-state.projection';
import { SocialApprovalTransitionRegistry } from '../social-approvals/approval-transition.port';
import type { SocialApprovalRequestEntity } from '../social-approvals/entities';
import { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
} from '../social-planner/entities';
import {
  SocialContentProductionStatusService,
  type SocialContentCreativeProductionPhase,
} from '../social-planner/services/social-content-production-status.service';
import type { CreativeStudioScope } from './creative-studio.scope';
import {
  CreativeAssetEntity,
  CreativeAssetVersionEntity,
  CreativeProductionEntity,
  CreativeProductionEventEntity,
  type CreativeProductionEventType,
} from './entities';

/**
 * Approval vocabulary as the production projection reads it. Approvals has no
 * `rejected`: `cancelled` and `superseded` mean the selected version is not in
 * an approval any more, so they read as `not_sent` (the raw status is still
 * returned next to it).
 */
export type CreativeApprovalState =
  | 'not_required'
  | 'not_sent'
  | 'pending'
  | 'changes_requested'
  | 'approved';

export type CreativeReadinessState =
  | 'needs_creative'
  | 'needs_approval'
  | 'creative_ready'
  | 'changes_requested'
  | 'ready';

export type CreativeProductionBlocker =
  | 'no_creative_selected'
  | 'selected_version_unavailable'
  | 'approval_not_sent'
  | 'approval_pending'
  | 'changes_requested';

export type CreativeSelectionUnavailableReason =
  | 'asset_archived'
  | 'media_unavailable';

export type CreativeProductionSnapshot = {
  contentItem: SocialContentItemEntity;
  production: CreativeProductionEntity | null;
  selection: {
    asset: CreativeAssetEntity;
    version: CreativeAssetVersionEntity;
    unavailableReason: CreativeSelectionUnavailableReason | null;
  } | null;
  approval: {
    required: boolean;
    state: CreativeApprovalState;
    projection: SocialApprovalStateProjection | null;
  };
  readiness: {
    state: CreativeReadinessState;
    blockers: CreativeProductionBlocker[];
  };
};

const PENDING = new Set([
  'draft',
  'awaiting_internal_review',
  'awaiting_client',
]);

/**
 * CS5-B — "what remains before this Planner item is creatively ready?"
 *
 * Answered on every read from the authoritative owners, never persisted:
 *
 *   explicit selection (Studio) + approval of that EXACT version (Approvals)
 *   + approval requirement (structural, see `approvalRequired`).
 *
 * The same derivation drives the Planner reflection, so the projection the
 * operator reads and the Planner state the Studio asks for can never use two
 * different rules. Reconciliation is just "derive again and ask the Planner":
 * it repairs a missed approval transition, an archived asset or a legacy row
 * without trusting any stored conclusion.
 */
@Injectable()
export class CreativeProductionReadinessService implements OnModuleInit {
  private readonly logger = new Logger(CreativeProductionReadinessService.name);

  constructor(
    @InjectRepository(CreativeProductionEntity, 'agency')
    private readonly productions: Repository<CreativeProductionEntity>,
    @InjectRepository(CreativeProductionEventEntity, 'agency')
    private readonly events: Repository<CreativeProductionEventEntity>,
    @InjectRepository(CreativeAssetEntity, 'agency')
    private readonly assets: Repository<CreativeAssetEntity>,
    @InjectRepository(CreativeAssetVersionEntity, 'agency')
    private readonly versions: Repository<CreativeAssetVersionEntity>,
    @InjectRepository(MediaAssetEntity, 'agency')
    private readonly media: Repository<MediaAssetEntity>,
    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentItems: Repository<SocialContentItemEntity>,
    @InjectRepository(SocialPlanEntity, 'agency')
    private readonly plans: Repository<SocialPlanEntity>,
    private readonly approvals: SocialApprovalsService,
    private readonly plannerStatus: SocialContentProductionStatusService,
    private readonly transitions: SocialApprovalTransitionRegistry,
  ) {}

  onModuleInit(): void {
    this.transitions.register((approval) =>
      this.onApprovalTransition(approval),
    );
  }

  /**
   * Approval is required exactly where it can exist. Approvals is
   * company-bound by CHECK (`CK_social_approval_requests_scope`): agency scope
   * cannot hold a request at all, and every company scope routes client work
   * through Approvals (the Planner's own vocabulary puts approval inside the
   * pipeline: `creative_ready` "Em aprovação", `ready` "Aprovado"). No setting
   * expresses anything finer today — Planner milestones are deadline alerts and
   * Client Area `approvals_enabled` is a surface switch — so none is invented.
   */
  approvalRequired(scope: CreativeStudioScope): boolean {
    return scope.agencyClientId !== null && scope.companyContextId !== null;
  }

  /** Content item in the full Company Context of its plan; 404 otherwise. */
  async requireContentItem(
    scope: CreativeStudioScope,
    contentItemId: string,
  ): Promise<SocialContentItemEntity> {
    const item = await this.contentItems.findOne({
      where: {
        id: contentItemId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        deletedAt: IsNull(),
      },
    });
    const planInScope =
      item &&
      (await this.plans.exists({
        where: {
          id: item.planId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          agencyClientId:
            scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
          companyContextId:
            scope.companyContextId === null ? IsNull() : scope.companyContextId,
          deletedAt: IsNull(),
        },
      }));
    if (!item || !planInScope)
      throw new NotFoundException('Conteúdo não encontrado.');
    return item;
  }

  async findProduction(
    scope: CreativeStudioScope,
    contentItemId: string,
  ): Promise<CreativeProductionEntity | null> {
    return this.productions.findOne({
      where: { ...this.scopeWhere(scope), contentItemId },
    });
  }

  async snapshot(
    scope: CreativeStudioScope,
    contentItemId: string,
  ): Promise<CreativeProductionSnapshot> {
    const contentItem = await this.requireContentItem(scope, contentItemId);
    const production = await this.findProduction(scope, contentItem.id);
    const selection = await this.resolveSelection(scope, production);
    const required = this.approvalRequired(scope);
    // The approval of the EXACT selected version — never the asset's latest,
    // so approving v1 can never make v2 look approved.
    const projection =
      required && selection
        ? await this.approvals.findStateForSubjectRevision(scope, {
            subjectType: 'creative_version',
            subjectId: selection.asset.id,
            subjectRevisionId: selection.version.id,
          })
        : null;
    const state: CreativeApprovalState = !required
      ? 'not_required'
      : !projection
        ? 'not_sent'
        : projection.status === 'approved'
          ? 'approved'
          : projection.status === 'changes_requested'
            ? 'changes_requested'
            : PENDING.has(projection.status)
              ? 'pending'
              : 'not_sent';
    return {
      contentItem,
      production,
      selection,
      approval: { required, state, projection },
      readiness: this.deriveReadiness(selection, state),
    };
  }

  /**
   * Re-derives and asks the Planner to reflect it. Returns the Planner
   * transition it caused, if any, and records it in the production history.
   */
  async reflectPlanner(
    scope: CreativeStudioScope,
    contentItemId: string,
    actorUserId: string | null,
  ) {
    const snapshot = await this.snapshot(scope, contentItemId);
    const phase = this.phaseFor(snapshot);
    if (!phase) return null;
    const moved = await this.plannerStatus.reflectCreativeProduction(scope, {
      contentItemId: snapshot.contentItem.id,
      phase,
      actorUserId,
    });
    if (moved)
      await this.recordEvent(
        this.events.manager,
        scope,
        snapshot.contentItem.id,
        'social.creative.planner.reflected',
        snapshot.selection?.version.id ?? null,
        actorUserId,
        { from: moved.from, to: moved.to, readiness: snapshot.readiness.state },
      );
    return moved;
  }

  /**
   * CS2B.4 hand-off reflection, consolidated: with an explicit selection the
   * production rule decides (so sending a non-selected version never claims
   * "Em aprovação" for the item); without one, the CS2B.4 rule is unchanged.
   *
   * Runs after Approvals committed, so it keeps CS2B.4's contract: a content
   * item that was deleted or left the scope is a silent no-op, never an error
   * on an approval that already exists.
   */
  async reflectAfterApprovalHandoff(
    scope: CreativeStudioScope,
    contentItemId: string,
    actorUserId: string | null,
  ): Promise<void> {
    const production = await this.findProduction(scope, contentItemId);
    if (production?.selectedVersionId) {
      try {
        await this.reflectPlanner(scope, contentItemId, actorUserId);
      } catch (error) {
        if (!(error instanceof NotFoundException)) throw error;
      }
      return;
    }
    await this.plannerStatus.reflectCreativeStatus(scope, {
      contentItemId,
      status: 'creative_ready',
      actorUserId,
    });
  }

  async recordEvent(
    manager: EntityManager,
    scope: CreativeStudioScope,
    contentItemId: string,
    eventType: CreativeProductionEventType,
    creativeVersionId: string | null,
    actorUserId: string | null,
    payload: Record<string, unknown> = {},
  ): Promise<void> {
    const repository = manager.getRepository(CreativeProductionEventEntity);
    await repository.save(
      repository.create({
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId: scope.agencyClientId,
        companyContextId: scope.companyContextId,
        contentItemId,
        eventType,
        creativeVersionId,
        actorUserId,
        payload,
      }),
    );
  }

  /**
   * An approval changed status: every production whose selected version is
   * that request's revision is re-derived. The request row only names what to
   * re-read; its status is not trusted (it may already be stale).
   */
  private async onApprovalTransition(
    approval: SocialApprovalRequestEntity,
  ): Promise<void> {
    if (approval.subjectType !== 'creative_version') return;
    const scope: CreativeStudioScope = {
      tenantId: approval.tenantId,
      workspaceId: approval.workspaceId,
      agencyClientId: approval.agencyClientId,
      companyContextId: approval.companyContextId,
    };
    const affected = await this.productions.find({
      where: {
        ...this.scopeWhere(scope),
        selectedVersionId: approval.subjectRevisionId,
      },
      select: { id: true, contentItemId: true },
    });
    for (const production of affected)
      try {
        await this.reflectPlanner(scope, production.contentItemId, null);
      } catch (error) {
        // Deleted content, a plan moved away: reconciliation repairs it.
        this.logger.warn(
          `production reflection skipped for ${production.contentItemId}: ${
            error instanceof Error ? error.message : String(error)
          }`,
        );
      }
  }

  private async resolveSelection(
    scope: CreativeStudioScope,
    production: CreativeProductionEntity | null,
  ): Promise<CreativeProductionSnapshot['selection']> {
    if (!production?.selectedVersionId || !production.selectedCreativeAssetId)
      return null;
    const asset = await this.assets.findOne({
      where: {
        ...this.scopeWhere(scope),
        id: production.selectedCreativeAssetId,
      },
    });
    const version =
      asset &&
      (await this.versions.findOne({
        where: {
          id: production.selectedVersionId,
          creativeAssetId: asset.id,
        },
      }));
    // The database keeps these consistent; reaching here means a legacy or
    // manually edited row, which reads as "nothing selected".
    if (!asset || !version) return null;
    const mediaAlive =
      asset.status !== 'archived' &&
      (await this.media.exists({ where: { id: version.mediaAssetId } }));
    return {
      asset,
      version,
      unavailableReason:
        asset.status === 'archived' || asset.archivedAt
          ? 'asset_archived'
          : mediaAlive
            ? null
            : 'media_unavailable',
    };
  }

  private deriveReadiness(
    selection: CreativeProductionSnapshot['selection'],
    approval: CreativeApprovalState,
  ): CreativeProductionSnapshot['readiness'] {
    if (!selection)
      return { state: 'needs_creative', blockers: ['no_creative_selected'] };
    if (selection.unavailableReason)
      return {
        state: 'needs_creative',
        blockers: ['selected_version_unavailable'],
      };
    switch (approval) {
      case 'not_required':
      case 'approved':
        return { state: 'ready', blockers: [] };
      case 'pending':
        return { state: 'creative_ready', blockers: ['approval_pending'] };
      case 'changes_requested':
        return {
          state: 'changes_requested',
          blockers: ['changes_requested'],
        };
      case 'not_sent':
        return { state: 'needs_approval', blockers: ['approval_not_sent'] };
    }
  }

  /** Nothing selected (or selection unusable) claims nothing in the Planner. */
  private phaseFor(
    snapshot: CreativeProductionSnapshot,
  ): SocialContentCreativeProductionPhase | null {
    switch (snapshot.readiness.state) {
      case 'needs_creative':
        return null;
      case 'needs_approval':
      case 'changes_requested':
        return 'in_production';
      case 'creative_ready':
        return 'in_approval';
      case 'ready':
        return 'final';
    }
  }

  private scopeWhere(scope: CreativeStudioScope) {
    return {
      tenantId: scope.tenantId,
      workspaceId: scope.workspaceId,
      agencyClientId:
        scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
      companyContextId:
        scope.companyContextId === null ? IsNull() : scope.companyContextId,
    };
  }
}
