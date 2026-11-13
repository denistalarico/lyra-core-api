import type {
  SocialApprovalBoardColumn,
  SocialApprovalPieceSourceState,
  SocialApprovalSendOrder,
  SocialApprovalStatus,
} from './entities';

/** Where one step stands. `finished` belongs to the piece, never to a step. */
export type ApprovalStepPhase = Exclude<SocialApprovalBoardColumn, 'finished'>;

export type ProjectedStepInput = {
  id: string;
  position: number;
  isStale: boolean;
  /** Status of `current_request_id`; null when nothing was ever requested. */
  status: SocialApprovalStatus | null;
};

export type PieceProjectionInput = {
  finishedAt: Date | null;
  sourceState: SocialApprovalPieceSourceState;
  sendOrder: SocialApprovalSendOrder;
  steps: readonly ProjectedStepInput[];
};

export type PieceProjection = {
  boardColumn: SocialApprovalBoardColumn;
  activeStepId: string | null;
};

/** How far behind a phase is; the lowest rank is the most delayed (D-13). */
const PHASE_RANK: Record<ApprovalStepPhase, number> = {
  preparation: 0,
  changes: 1,
  internal_review: 2,
  awaiting_client: 3,
  approved: 4,
};

export function approvalStepPhase(
  status: SocialApprovalStatus | null,
  isStale: boolean,
): ApprovalStepPhase {
  switch (status) {
    case 'awaiting_internal_review':
      return 'internal_review';
    case 'awaiting_client':
      return 'awaiting_client';
    case 'changes_requested':
      return 'changes';
    case 'approved':
      // D-20: an approval of a revision that is no longer current does not count.
      return isStale ? 'preparation' : 'approved';
    default:
      return 'preparation';
  }
}

/**
 * D-13. The single implementation of the board rule: live transitions, the
 * sync and the reconciliation all go through here.
 */
export function projectApprovalPiece(
  input: PieceProjectionInput,
): PieceProjection {
  const steps = [...input.steps]
    .sort((a, b) => a.position - b.position)
    .map((step) => ({
      id: step.id,
      phase: approvalStepPhase(step.status, step.isStale),
    }));
  const lastStepId = steps.at(-1)?.id ?? null;

  if (input.finishedAt || input.sourceState === 'posted')
    return { boardColumn: 'finished', activeStepId: lastStepId };

  const inChanges = steps.find((step) => step.phase === 'changes');
  if (inChanges) return { boardColumn: 'changes', activeStepId: inChanges.id };

  const pending = steps.filter((step) => step.phase !== 'approved');
  if (steps.length > 0 && pending.length === 0)
    return { boardColumn: 'approved', activeStepId: lastStepId };
  if (pending.length === 0)
    return { boardColumn: 'preparation', activeStepId: null };

  const active =
    input.sendOrder === 'together'
      ? pending.reduce((late, step) =>
          PHASE_RANK[step.phase] < PHASE_RANK[late.phase] ? step : late,
        )
      : // A later step can already be under review while an earlier one was
        // never sent: the Creative Studio sends without the copy, and legacy
        // pieces exist in that state. Showing the untouched step would hide
        // something waiting on a person.
        ((pending[0].phase === 'preparation'
          ? pending.find((step) => step.phase !== 'preparation')
          : undefined) ?? pending[0]);

  return { boardColumn: active.phase, activeStepId: active.id };
}

export type PieceVersionRequest = {
  id: string;
  stepId: string | null;
  subjectRevisionId: string;
  status: SocialApprovalStatus;
  createdAt: Date;
};

export type ApprovalPieceVersion = {
  number: number;
  createdAt: string;
  isCurrent: boolean;
  /** Every step that was already sent, as it stood in this version. */
  parts: Array<{ stepId: string; approvalId: string; changed: boolean }>;
};

/** Sends of one action (copy then creative) land seconds apart, never more. */
const SAME_SEND_MS = 2 * 60 * 1000;

/**
 * E3: one version per send that changed something. Resending the same
 * revision (after a withdrawal, say) is still that version; a copy and a
 * creative sent together are one version, not two.
 */
export function approvalPieceVersions(
  requests: readonly PieceVersionRequest[],
): ApprovalPieceVersion[] {
  const sent = requests
    .filter((request) => request.stepId && request.status !== 'draft')
    .sort(
      (a, b) =>
        a.createdAt.getTime() - b.createdAt.getTime() ||
        a.id.localeCompare(b.id),
    );
  const latest = new Map<string, { approvalId: string; revisionId: string }>();
  type Parts = Map<string, { approvalId: string; changed: boolean }>;
  const versions: Array<{ startedAt: number; createdAt: Date; parts: Parts }> =
    [];
  for (const request of sent) {
    const stepId = request.stepId!;
    const previous = latest.get(stepId);
    latest.set(stepId, {
      approvalId: request.id,
      revisionId: request.subjectRevisionId,
    });
    const last = versions.at(-1);
    if (previous?.revisionId === request.subjectRevisionId) {
      // Same content again: the version only points at the newer request.
      const part = last?.parts.get(stepId);
      if (part) part.approvalId = request.id;
      continue;
    }
    if (
      last &&
      request.createdAt.getTime() - last.startedAt <= SAME_SEND_MS &&
      !last.parts.get(stepId)?.changed
    ) {
      last.parts.set(stepId, { approvalId: request.id, changed: true });
      continue;
    }
    const parts: Parts = new Map();
    for (const [id, part] of last?.parts ?? [])
      parts.set(id, { approvalId: part.approvalId, changed: false });
    parts.set(stepId, { approvalId: request.id, changed: true });
    versions.push({
      startedAt: request.createdAt.getTime(),
      createdAt: request.createdAt,
      parts,
    });
  }
  return versions.map((version, index) => ({
    number: index + 1,
    createdAt: version.createdAt.toISOString(),
    isCurrent: index === versions.length - 1,
    parts: [...version.parts].map(([stepId, part]) => ({ stepId, ...part })),
  }));
}
