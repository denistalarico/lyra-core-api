import { CrmStageEntity } from '../entities/crm-stage.entity';
import { CrmStageTransitionActor } from '../entities/crm-stage-transition-policy.entity';

/**
 * The default movements a pipeline admits before anyone configures anything.
 *
 * A governed pipeline is fail-closed: `assertTransitionAllowedWithinTransaction`
 * refuses any move without a published policy for that exact pair of stages. So
 * a freshly created CRM — seven stages, zero policies — rejects every drag until
 * an operator hand-authors and publishes each edge. For the default pipeline
 * that is 26 policies before the first card moves, which is not a configuration
 * cost a non-technical user can be asked to pay.
 *
 * The plan below is what an operator would have written by hand anyway: the
 * board moves freely, and governance becomes something you *add* (required
 * fields, narrower actors) rather than something you must author to get started.
 * Every restriction the runtime enforces is still enforced — this only decides
 * which edges start out open.
 */

/**
 * Reason codes the product itself emits when something moves a card: the board's
 * drag (`manual_stage_move`), the drawer's status edit (`manual_status_change`)
 * and an approved agent proposal (`approved_agent_decision`). A policy that
 * omitted these would be published and still block every real movement.
 */
export const DEFAULT_TRANSITION_REASON_CODES = [
  'manual_stage_move',
  'manual_status_change',
  'approved_agent_decision',
  'automatic_stage_advance',
];

const ALL_ACTORS: CrmStageTransitionActor[] = [
  'human',
  'ai',
  'automation',
  'system',
];

export type PlannedTransition = {
  fromStageId: string;
  toStageId: string;
  allowedActors: CrmStageTransitionActor[];
  reasonCodes: string[];
};

export type PlannableStage = Pick<
  CrmStageEntity,
  | 'id'
  | 'type'
  | 'role'
  | 'sortOrder'
  | 'isWonStage'
  | 'isLostStage'
  | 'isInitialStage'
  | 'operationMode'
>;

function isTerminal(stage: PlannableStage): boolean {
  return (
    stage.type === 'won' ||
    stage.type === 'lost' ||
    stage.isWonStage ||
    stage.isLostStage
  );
}

function isEntry(stage: PlannableStage): boolean {
  return stage.isInitialStage || stage.role === 'entry';
}

/**
 * Who may drive a movement into `stage` by default.
 *
 * Terminal destinations are human-only because `publish` refuses any other actor
 * on them, and a human-managed stage is human-only because the runtime would
 * block the rest at execution time — a policy promising otherwise would be a
 * published lie.
 */
function actorsFor(stage: PlannableStage): CrmStageTransitionActor[] {
  if (isTerminal(stage) || stage.operationMode === 'human_managed') {
    return ['human'];
  }
  return [...ALL_ACTORS];
}

/**
 * Every movement that is structurally legal in this pipeline.
 *
 * Forward and backward between open stages, plus won/lost from anywhere: a CRM
 * where a card can only advance one step, or never come back, does not match how
 * deals actually behave. The two exclusions are the ones the backend itself
 * imposes — a terminal stage has no exit, and the entry stage is chosen when the
 * opportunity is created rather than moved into.
 */
export function buildDefaultTransitionPlan(
  stages: PlannableStage[],
): PlannedTransition[] {
  const ordered = [...stages].sort((a, b) => a.sortOrder - b.sortOrder);
  const sources = ordered.filter((stage) => !isTerminal(stage));
  const destinations = ordered.filter((stage) => !isEntry(stage));

  const plan: PlannedTransition[] = [];
  for (const from of sources) {
    for (const to of destinations) {
      if (from.id === to.id) continue;
      plan.push({
        fromStageId: from.id,
        toStageId: to.id,
        allowedActors: actorsFor(to),
        reasonCodes: [...DEFAULT_TRANSITION_REASON_CODES],
      });
    }
  }
  return plan;
}
