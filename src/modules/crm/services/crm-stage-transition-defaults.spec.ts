import {
  buildDefaultTransitionPlan,
  DEFAULT_TRANSITION_REASON_CODES,
  PlannableStage,
} from './crm-stage-transition-defaults';

function stage(
  id: string,
  sortOrder: number,
  overrides: Partial<PlannableStage> = {},
): PlannableStage {
  return {
    id,
    sortOrder,
    type: 'open',
    role: 'custom',
    isWonStage: false,
    isLostStage: false,
    isInitialStage: false,
    operationMode: 'hybrid',
    ...overrides,
  } as PlannableStage;
}

/** The pipeline `ensureDefaultPipeline` creates for every new workspace. */
const defaultPipeline: PlannableStage[] = [
  stage('entry', 10, { isInitialStage: true }),
  stage('qualified', 20),
  stage('meeting', 30),
  stage('proposal', 40),
  stage('negotiation', 50),
  stage('won', 60, { type: 'won', isWonStage: true }),
  stage('lost', 70, { type: 'lost', isLostStage: true }),
];

function edge(plan: ReturnType<typeof buildDefaultTransitionPlan>, from: string, to: string) {
  return plan.find((item) => item.fromStageId === from && item.toStageId === to);
}

describe('buildDefaultTransitionPlan', () => {
  it('opens every structurally legal movement of the default pipeline', () => {
    const plan = buildDefaultTransitionPlan(defaultPipeline);

    // 5 open sources × (4 non-entry open + won + lost), minus each source's own id.
    expect(plan).toHaveLength(26);
    expect(edge(plan, 'entry', 'qualified')).toBeDefined();
    // Skipping ahead is a normal sales motion, not a misconfiguration.
    expect(edge(plan, 'entry', 'negotiation')).toBeDefined();
    // So is going back when a deal cools off.
    expect(edge(plan, 'negotiation', 'qualified')).toBeDefined();
  });

  it('never contradicts the edges the backend refuses to publish', () => {
    const plan = buildDefaultTransitionPlan(defaultPipeline);

    // Terminal stages have no exit, and the entry stage is chosen at creation.
    expect(plan.some((item) => item.fromStageId === 'won')).toBe(false);
    expect(plan.some((item) => item.fromStageId === 'lost')).toBe(false);
    expect(plan.some((item) => item.toStageId === 'entry')).toBe(false);
    expect(plan.some((item) => item.fromStageId === item.toStageId)).toBe(false);
  });

  it('keeps closing a deal a human decision', () => {
    const plan = buildDefaultTransitionPlan(defaultPipeline);

    // `publish` rejects any non-human actor on a terminal destination, so a plan
    // that promised more would fail to publish.
    expect(edge(plan, 'proposal', 'won')?.allowedActors).toEqual(['human']);
    expect(edge(plan, 'proposal', 'lost')?.allowedActors).toEqual(['human']);
    expect(edge(plan, 'proposal', 'negotiation')?.allowedActors).toEqual([
      'human',
      'ai',
      'automation',
      'system',
    ]);
  });

  it('does not promise automatic movement into a human-managed stage', () => {
    const plan = buildDefaultTransitionPlan([
      stage('entry', 10, { isInitialStage: true }),
      stage('review', 20, { operationMode: 'human_managed' }),
    ]);

    expect(edge(plan, 'entry', 'review')?.allowedActors).toEqual(['human']);
  });

  it('carries the reason codes the product actually sends', () => {
    const plan = buildDefaultTransitionPlan(defaultPipeline);

    // The board drags with `manual_stage_move`; a policy without it would be
    // published and still block every movement.
    expect(edge(plan, 'entry', 'qualified')?.reasonCodes).toEqual(
      DEFAULT_TRANSITION_REASON_CODES,
    );
  });

  it('treats a pipeline without terminal stages as still movable', () => {
    const plan = buildDefaultTransitionPlan([
      stage('entry', 10, { isInitialStage: true }),
      stage('doing', 20),
      stage('review', 30),
    ]);

    expect(plan).toHaveLength(4);
    expect(edge(plan, 'doing', 'review')).toBeDefined();
    expect(edge(plan, 'review', 'doing')).toBeDefined();
  });

  it('has nothing to open in a pipeline of one stage', () => {
    expect(
      buildDefaultTransitionPlan([stage('only', 10, { isInitialStage: true })]),
    ).toEqual([]);
  });
});
