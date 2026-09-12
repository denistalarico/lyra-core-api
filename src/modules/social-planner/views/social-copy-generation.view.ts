import type {
  SocialCopyGenerationField,
  SocialCopyGenerationProposalEntity,
  SocialCopyGenerationProposalStatus,
  SocialCopyGenerationRunEntity,
  SocialCopyGenerationRunKind,
  SocialCopyGenerationRunStatus,
} from '../entities';

/**
 * The authorized projection of a generation run (Planner E8).
 *
 * The scope triple does not cross this boundary, for the reason every other
 * view in this module states: the caller knows its own scope and echoing
 * internal ids back is how cross-context leaks have started here before.
 *
 * PROVENANCE DOES CROSS IT, AND THAT IS THE POINT
 * -----------------------------------------------
 * `provider`, `model`, `promptVersion` and the token counts are what make a
 * generated revision auditable (§8.5). They describe our own call, not the
 * operator's data, and a UI that cannot say which model wrote a line cannot
 * honour the "recommend and explain" rule in §29.
 *
 * WHAT COST MEANS HERE
 * --------------------
 * `costCents` is an estimate derived from token usage and configured rates,
 * never a provider invoice. `costIsEstimated` travels with it so the UI can say
 * so — E8's own wording is to show cost "when the contract exposes reliable
 * cost", and the honest answer is to expose the number together with its
 * confidence instead of letting a derived figure look billed.
 *
 * `lastError` is a short closed-vocabulary code, not a message. The UI writes
 * the sentence; §3 forbids rendering backend or provider errors literally.
 */
export type SocialCopyGenerationRunView = {
  id: string;
  planId: string;
  /** NULL for `plan_grid` runs, which create content items rather than editing one. */
  contentItemId: string | null;
  runKind: SocialCopyGenerationRunKind;
  status: SocialCopyGenerationRunStatus;
  attempts: number;
  maxAttempts: number;
  lastError: string | null;
  provider: string | null;
  model: string | null;
  promptVersion: string | null;
  contextVersion: string | null;
  inputTokens: number | null;
  cachedInputTokens: number | null;
  outputTokens: number | null;
  costCents: number | null;
  costIsEstimated: boolean;
  latencyMs: number | null;
  requestedById: string | null;
  createdAt: string;
  startedAt: string | null;
  completedAt: string | null;
  updatedAt: string;
};

/**
 * One staged proposal.
 *
 * `baseValue` crosses the boundary because the operator is being asked to
 * approve a replacement, and a diff needs both sides. It is the content's own
 * prior text, which the same caller could already read from the content item.
 */
export type SocialCopyGenerationProposalView = {
  id: string;
  runId: string;
  contentItemId: string;
  field: SocialCopyGenerationField;
  value: string | string[];
  baseValue: string | string[] | null;
  rationale: string | null;
  status: SocialCopyGenerationProposalStatus;
  appliedRevisionId: string | null;
  decidedById: string | null;
  decidedAt: string | null;
  createdAt: string;
};

export function toSocialCopyGenerationRunView(
  run: SocialCopyGenerationRunEntity,
): SocialCopyGenerationRunView {
  return {
    id: run.id,
    planId: run.planId,
    contentItemId: run.contentItemId,
    runKind: run.runKind,
    status: run.status,
    attempts: run.attempts,
    maxAttempts: run.maxAttempts,
    lastError: run.lastError,
    provider: run.provider,
    model: run.model,
    promptVersion: run.promptVersion,
    contextVersion: run.contextVersion,
    inputTokens: run.inputTokens,
    cachedInputTokens: run.cachedInputTokens,
    outputTokens: run.outputTokens,
    costCents: run.costCents,
    costIsEstimated: run.costIsEstimated,
    latencyMs: run.latencyMs,
    requestedById: run.requestedById,
    createdAt: run.createdAt.toISOString(),
    startedAt: run.startedAt ? run.startedAt.toISOString() : null,
    completedAt: run.completedAt ? run.completedAt.toISOString() : null,
    updatedAt: run.updatedAt.toISOString(),
  };
}

export function toSocialCopyGenerationProposalView(
  proposal: SocialCopyGenerationProposalEntity,
): SocialCopyGenerationProposalView {
  return {
    id: proposal.id,
    runId: proposal.runId,
    contentItemId: proposal.contentItemId,
    field: fromColumnField(proposal.field),
    value: normalizeStoredValue(proposal.value) ?? '',
    baseValue: normalizeStoredValue(proposal.baseValue),
    rationale: proposal.rationale,
    status: proposal.status,
    appliedRevisionId: proposal.appliedRevisionId,
    decidedById: proposal.decidedById,
    decidedAt: proposal.decidedAt ? proposal.decidedAt.toISOString() : null,
    createdAt: proposal.createdAt.toISOString(),
  };
}

/**
 * The column keeps the database's snake_case vocabulary (`first_comment`) while
 * the contract uses the camelCase name the rest of the Planner API already
 * exposes on content items and revisions. Mapping in one place keeps the two
 * vocabularies from leaking into each other the way `reels`/`reel` did in E4.
 */
export function toColumnField(field: SocialCopyGenerationField): string {
  return field === 'firstComment' ? 'first_comment' : field;
}

export function fromColumnField(column: string): SocialCopyGenerationField {
  return (
    column === 'first_comment' ? 'firstComment' : column
  ) as SocialCopyGenerationField;
}

/**
 * jsonb comes back as `unknown`. Anything that is not a string or a string array
 * is reported as absent rather than cast — a malformed row must not become a
 * value the operator can accept onto their content.
 */
function normalizeStoredValue(value: unknown): string | string[] | null {
  if (typeof value === 'string') return value;
  if (Array.isArray(value))
    return value.filter((entry): entry is string => typeof entry === 'string');
  return null;
}
