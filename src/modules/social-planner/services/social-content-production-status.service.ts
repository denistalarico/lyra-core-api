import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { type EntityManager, In, IsNull, Repository } from 'typeorm';
import {
  SocialContentItemEntity,
  SocialPlanEntity,
  type SocialContentPlanningStatus,
} from '../entities';
import type { SocialPlannerScope } from './social-planner.service';

/**
 * The two Planner states an external creative producer may reflect (CS2B.4).
 *
 * They are the Planner's own values, not a Creative Studio vocabulary: the
 * Studio says which Planner state its work justifies, and the Planner decides
 * whether the content item may move there.
 */
export type SocialContentCreativeStatus = Extract<
  SocialContentPlanningStatus,
  'creative_in_progress' | 'creative_ready'
>;

/**
 * The only states each creative status may be entered from.
 *
 * `planningStatus` is a linear editorial pipeline — the Planner cockpit counts
 * the copy step as complete for every state from `copy_ready` on. So:
 *
 * - `idea`, `planned` and `copy_in_progress` are absent: moving them into the
 *   creative segment would declare the copy finished, and copy belongs to the
 *   Planner. Creative work may start early; the Planner just does not claim it
 *   until its own copy stage is done.
 * - `creative_ready` and `ready` are absent from both lists: a new creative
 *   version never walks a later state back. Regressing on a revision is a rule
 *   of its own (`REVISION_FROM`), not a side effect of uploading a file.
 * - Each target is absent from its own list, which makes a repeated call a
 *   no-op rather than a rewrite.
 */
const REFLECTABLE_FROM: Record<
  SocialContentCreativeStatus,
  readonly SocialContentPlanningStatus[]
> = {
  creative_in_progress: ['copy_ready'],
  creative_ready: ['copy_ready', 'creative_in_progress'],
};

/**
 * CS2B.6 — the only regression the Planner accepts from a creative producer.
 *
 * A revision answers a client's request for changes: the creative handed to
 * approval (`creative_ready`, "Em aprovação") is back in production. It is the
 * normal start rule plus `creative_ready`, nothing else:
 *
 * - `ready` stays absent. It is the operator's sign-off on the whole item —
 *   copy included — and no contract says a creative revision withdraws it.
 * - pre-copy states stay absent for the same reason as `REFLECTABLE_FROM`.
 */
const REVISION_FROM: readonly SocialContentPlanningStatus[] = [
  'copy_ready',
  'creative_ready',
];

/**
 * CS5-B — what the creative production of an item amounts to, as reported by
 * the Creative Studio after reading its owners (the explicit selection in the
 * Studio and the approval of that exact version in Approvals).
 *
 * - `in_production`: a version is selected but not handed to approval (never
 *   sent, cancelled, superseded, or sent back with `changes_requested`).
 * - `in_approval`: the selected version is in an active approval.
 * - `final`: the selected version was approved, or no approval applies.
 *
 * "Nothing selected" is not a phase: with no selection the Studio claims
 * nothing, and the Planner keeps whatever it has.
 */
export type SocialContentCreativeProductionPhase =
  | 'in_production'
  | 'in_approval'
  | 'final';

/**
 * CS5-B — the consolidated reflection, decided here by the Planner.
 *
 * Planner vocabulary: `creative_ready` is "Em aprovação" and `ready` is
 * "Aprovado" (the cockpit's only persisted signal that approval concluded).
 *
 * - Pre-copy states are never moved: copy is the Planner's own prerequisite
 *   for `ready` and for entering the creative segment (CS2B.4).
 * - Since CS5, `ready` means "the CURRENTLY SELECTED Creative Version is
 *   final". It therefore follows the selection: when a different version is
 *   selected (not sent, sent back with changes, or pending), `ready` regresses
 *   to `creative_in_progress` / `creative_ready`. This replaces, for items with
 *   an explicit selection only, CS2B.6's "ready never regresses"; the legacy
 *   CS2B paths (`reflectCreativeStatus`, `reflectCreativeRevisionStarted`)
 *   keep their own tables unchanged. Approvals of earlier versions stay intact
 *   in Approvals — only the Planner reading of the item moves.
 * - `creative_ready → creative_in_progress` is allowed for `in_production`:
 *   the evidence is the owners' own state — the selected version is not in an
 *   approval — which generalizes CS2B.6's `changes_requested` rule to an
 *   explicit re-selection.
 */
const PRODUCTION_REFLECTION: Record<
  SocialContentCreativeProductionPhase,
  {
    target: SocialContentPlanningStatus;
    from: readonly SocialContentPlanningStatus[];
  }
> = {
  in_production: {
    target: 'creative_in_progress',
    from: ['copy_ready', 'creative_ready', 'ready'],
  },
  in_approval: {
    target: 'creative_ready',
    from: ['copy_ready', 'creative_in_progress', 'ready'],
  },
  final: {
    target: 'ready',
    from: ['copy_ready', 'creative_in_progress', 'creative_ready'],
  },
};

/**
 * How another module reports creative production on a Planner content item.
 *
 * The Planner owns `planningStatus`; callers never touch the content
 * repository. This service resolves the item within the caller's full scope —
 * including the Company Context of its parent plan, since content items carry
 * none of their own — and applies the move only when `REFLECTABLE_FROM` allows
 * it. Anything else is a silent no-op: an asset whose content item was deleted,
 * belongs to another company, or sits in a state the move does not apply to
 * must not fail the producer's own operation.
 *
 * The write is a compare-and-set on the state that was read, so a concurrent
 * operator edit is never overwritten with an older decision.
 */
@Injectable()
export class SocialContentProductionStatusService {
  constructor(
    @InjectRepository(SocialContentItemEntity, 'agency')
    private readonly contentRepository: Repository<SocialContentItemEntity>,

    @InjectRepository(SocialPlanEntity, 'agency')
    private readonly plansRepository: Repository<SocialPlanEntity>,
  ) {}

  /**
   * Returns whether the content item changed state.
   *
   * `manager` lets a caller make the reflection part of its own transaction,
   * so the creative record and the Planner state commit or roll back together.
   */
  async reflectCreativeStatus(
    scope: SocialPlannerScope,
    input: {
      contentItemId: string;
      status: SocialContentCreativeStatus;
      actorUserId: string | null;
    },
    manager?: EntityManager,
  ): Promise<boolean> {
    const moved = await this.move(
      scope,
      input.contentItemId,
      input.status,
      REFLECTABLE_FROM[input.status],
      input.actorUserId,
      manager,
    );
    return moved !== null;
  }

  /**
   * CS5-B — recalculates the Planner state of an item from its creative
   * production phase (see `PRODUCTION_REFLECTION`). Same scope, silent no-op
   * and compare-and-set contract as `reflectCreativeStatus`; returns the
   * transition it applied, or null.
   */
  async reflectCreativeProduction(
    scope: SocialPlannerScope,
    input: {
      contentItemId: string;
      phase: SocialContentCreativeProductionPhase;
      actorUserId: string | null;
    },
    manager?: EntityManager,
  ): Promise<{
    from: SocialContentPlanningStatus;
    to: SocialContentPlanningStatus;
  } | null> {
    const rule = PRODUCTION_REFLECTION[input.phase];
    const from = await this.move(
      scope,
      input.contentItemId,
      rule.target,
      rule.from,
      input.actorUserId,
      manager,
    );
    return from === null ? null : { from, to: rule.target };
  }

  /**
   * CS2B.6: the caller has proven that a creative revision started because the
   * client requested changes. Only then may `creative_ready` return to
   * `creative_in_progress`; see `REVISION_FROM`. Same scope, no-op and
   * compare-and-set contract as `reflectCreativeStatus`.
   */
  async reflectCreativeRevisionStarted(
    scope: SocialPlannerScope,
    input: { contentItemId: string; actorUserId: string | null },
    manager?: EntityManager,
  ): Promise<boolean> {
    const moved = await this.move(
      scope,
      input.contentItemId,
      'creative_in_progress',
      REVISION_FROM,
      input.actorUserId,
      manager,
    );
    return moved !== null;
  }

  /** Returns the state it moved from, or null when nothing changed. */
  private async move(
    scope: SocialPlannerScope,
    contentItemId: string,
    target: SocialContentPlanningStatus,
    from: readonly SocialContentPlanningStatus[],
    actorUserId: string | null,
    manager?: EntityManager,
  ): Promise<SocialContentPlanningStatus | null> {
    const contents = manager
      ? manager.getRepository(SocialContentItemEntity)
      : this.contentRepository;
    const plans = manager
      ? manager.getRepository(SocialPlanEntity)
      : this.plansRepository;

    const item = await contents.findOne({
      where: {
        id: contentItemId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        agencyClientId:
          scope.agencyClientId === null ? IsNull() : scope.agencyClientId,
        deletedAt: IsNull(),
      },
      select: { id: true, planId: true, planningStatus: true },
    });

    if (!item || !from.includes(item.planningStatus)) {
      return null;
    }

    const planInScope = await plans.exists({
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
    });

    if (!planInScope) {
      return null;
    }

    const result = await contents.update(
      { id: item.id, planningStatus: In([...from]) },
      { planningStatus: target, updatedById: actorUserId },
    );

    return (result.affected ?? 0) > 0 ? item.planningStatus : null;
  }
}
