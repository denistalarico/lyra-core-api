import type { ApprovalPiecePost } from '../approval-piece-post';
import type {
  SocialApprovalBoardColumn,
  SocialApprovalPieceEntity,
  SocialApprovalPieceKind,
  SocialApprovalRequestEntity,
  SocialApprovalStepEntity,
  SocialApprovalStepKind,
} from '../entities';
import {
  toClientApprovalStatus,
  type ClientApprovalDetail,
  type ClientApprovalStatus,
} from './client-approval.view';

/**
 * AR1 — the Client Area board (D-13). Same rule as `client-approval.view.ts`:
 * built field by field, so a column added to an entity cannot reach a client,
 * and `client-approval.contract.spec.ts` fails on any internal key.
 */
export const CLIENT_BOARD_COLUMNS = [
  'awaiting_you',
  'with_agency',
  'approved',
  'finished',
] as const;
export type ClientBoardColumn = (typeof CLIENT_BOARD_COLUMNS)[number];

export function toClientBoardColumn(
  column: SocialApprovalBoardColumn,
): ClientBoardColumn {
  switch (column) {
    case 'awaiting_client':
      return 'awaiting_you';
    case 'approved':
      return 'approved';
    case 'finished':
      return 'finished';
    default:
      return 'with_agency';
  }
}

export function agencyColumnsFor(
  column: ClientBoardColumn,
): SocialApprovalBoardColumn[] {
  switch (column) {
    case 'awaiting_you':
      return ['awaiting_client'];
    case 'approved':
      return ['approved'];
    case 'finished':
      return ['finished'];
    default:
      return ['preparation', 'internal_review', 'changes'];
  }
}

export type ClientBoardStep = {
  id: string;
  kind: SocialApprovalStepKind;
  title: string;
  position: number;
  /** `pending`: this step was never sent to the client. */
  status: ClientApprovalStatus | 'pending';
  approvedByAgency: boolean;
  approvalId: string | null;
};

export type ClientBoardSource =
  | 'standalone'
  | 'planning'
  | 'project'
  | 'campaign';

export type ClientBoardCard = {
  id: string;
  kind: SocialApprovalPieceKind;
  title: string;
  /** The card's tag, derived here so the internal `origin` stays internal. */
  source: ClientBoardSource;
  /** Opaque slot on an approval the reader can already see. */
  thumbnail: { approvalId: string; ref: string } | null;
  column: ClientBoardColumn;
  needsYou: boolean;
  activeStep: { kind: SocialApprovalStepKind; title: string } | null;
  steps: ClientBoardStep[];
  lastActivityAt: string;
  finishedAt: string | null;
};

export type ClientPieceDetail = ClientBoardCard & {
  description: string | null;
  post: ApprovalPiecePost | null;
  steps: Array<ClientBoardStep & { approval: ClientApprovalDetail | null }>;
};

/** A stale approval counts as not approved (D-20), for the client too. */
export function buildClientBoardStep(
  step: SocialApprovalStepEntity,
  latestSent: SocialApprovalRequestEntity | undefined,
): ClientBoardStep {
  const status = latestSent ? toClientApprovalStatus(latestSent.status) : null;
  return {
    id: step.id,
    kind: step.kind,
    title: step.title,
    position: step.position,
    status:
      status === null
        ? 'pending'
        : status === 'approved' && step.isStale
          ? 'in_revision'
          : status,
    approvedByAgency: latestSent?.resolution === 'agency_override',
    approvalId: latestSent?.id ?? null,
  };
}

export function buildClientBoardCard(
  piece: SocialApprovalPieceEntity,
  steps: readonly SocialApprovalStepEntity[],
  latestSentByStep: ReadonlyMap<string, SocialApprovalRequestEntity>,
  extras: {
    inCampaign?: boolean;
    thumbnail?: ClientBoardCard['thumbnail'];
  } = {},
): ClientBoardCard {
  const column = toClientBoardColumn(piece.boardColumn);
  const active = steps.find((step) => step.id === piece.activeStepId);
  return {
    id: piece.id,
    kind: piece.kind,
    title: piece.title,
    source:
      piece.origin === 'projects'
        ? 'project'
        : piece.kind === 'standalone'
          ? 'standalone'
          : piece.kind === 'campaign_table' || extras.inCampaign
            ? 'campaign'
            : 'planning',
    thumbnail: extras.thumbnail ?? null,
    column,
    needsYou: column === 'awaiting_you',
    activeStep: active ? { kind: active.kind, title: active.title } : null,
    steps: steps.map((step) =>
      buildClientBoardStep(step, latestSentByStep.get(step.id)),
    ),
    lastActivityAt: piece.updatedAt.toISOString(),
    finishedAt: piece.finishedAt?.toISOString() ?? null,
  };
}

/** Requests this reader can act on, read off the projection they were given. */
export function clientFeedbackTargets(piece: ClientPieceDetail) {
  const decide: string[] = [];
  const comment: string[] = [];
  for (const step of piece.steps) {
    if (step.approval?.actions.canDecide) decide.push(step.approval.id);
    if (step.approval?.actions.canComment) comment.push(step.approval.id);
  }
  return { decide, comment };
}
