import type { ApprovalSubjectPreview } from '../subjects/approval-subject-resolver';
import type {
  SocialApprovalCommentEntity,
  SocialApprovalRequestEntity,
  SocialApprovalStageDecisionEntity,
  SocialApprovalStatus,
} from '../entities';

/**
 * AP3 — the Client Area projection of an approval.
 *
 * BUILT BY CONSTRUCTION, NEVER BY DELETION
 * ----------------------------------------
 * Every function here names each field it emits. There is no `{ ...approval }`
 * followed by `delete`, because that pattern fails open: a column added to the
 * entity later would silently start reaching customers. Adding a field to this
 * projection has to be a deliberate edit to a `return` literal, and
 * `client-approval.contract.spec.ts` fails the build if an internal key ever
 * appears in the output.
 *
 * What stays internal: `tenantId`, `workspaceId`, `agencyClientId`,
 * `subjectId`, `subjectRevisionId`, `sourceModule`, `requestedByUserId`,
 * `requestedAt`, the raw `status`, every `internal_*_viewed_*` field,
 * `clientViewedByUserId`, internal comments, internal decisions and storage
 * keys.
 */

/**
 * The customer-facing vocabulary (CA0 §AB). It is a projection of the domain
 * status, not a second state machine: nothing writes these values, and the
 * domain transitions are unchanged.
 */
export const CLIENT_APPROVAL_STATUSES = [
  'awaiting_your_review',
  'in_revision',
  'approved',
  'replaced',
  'withdrawn',
] as const;
export type ClientApprovalStatus = (typeof CLIENT_APPROVAL_STATUSES)[number];

export type ClientApprovalAuthor = {
  /** A display name, never a user id. */
  name: string;
  /** Which side of the conversation wrote it. */
  side: 'client' | 'agency';
};

export type ClientApprovalComment = {
  id: string;
  body: string;
  createdAt: string;
  author: ClientApprovalAuthor;
  /** True when the reader themself wrote it, so the UI can align the bubble. */
  mine: boolean;
};

export type ClientApprovalHistoryEntry = {
  id: string;
  kind:
    | 'sent'
    | 'viewed'
    | 'commented'
    | 'changes_requested'
    | 'approved'
    | 'replaced'
    | 'withdrawn';
  at: string;
  actorName: string | null;
};

export type ClientApprovalListItem = {
  id: string;
  title: string;
  displayType: string;
  status: ClientApprovalStatus;
  versionLabel: string;
  sentToClientAt: string;
  approvedAt: string | null;
  lastActivityAt: string;
  /** Drives the "what needs me?" ordering, computed server-side. */
  needsYou: boolean;
  /**
   * AP4 §17/§18 — present only on a `replaced` item, and only when
   * `resolveReplacementApproval` found a replacement that is itself
   * client-visible in this same Company. An **opaque navigation id**: the
   * client never learns `subjectId`/`subjectRevisionId`, only "the id to open
   * next." `undefined` (not present) when there is no safe replacement to
   * offer, so the UI falls back to the plain "replaced" message.
   */
  replacementApprovalId?: string;
};

export type ClientApprovalActions = {
  canComment: boolean;
  canDecide: boolean;
};

export type ClientApprovalDetail = ClientApprovalListItem & {
  preview: ClientApprovalPreview;
  comments: ClientApprovalComment[];
  history: ClientApprovalHistoryEntry[];
  actions: ClientApprovalActions;
};

/**
 * The preview of the immutable `subject_revision_id`. Media is addressed by an
 * opaque `mediaRef` resolved against *this approval* by the Client Area media
 * route — never a storage key, bucket, signed URL or Agency path.
 */
export type ClientApprovalPreview = {
  title: string;
  versionLabel: string;
  format: 'media' | 'text';
  text?: {
    copy: string | null;
    caption: string | null;
    script: string | null;
    cta: string | null;
    hashtags: string[];
    firstComment: string | null;
  };
  media?: {
    assetType: 'image' | 'video';
    contentRef: string;
    thumbnailRef: string | null;
  };
};

/** The media refs the client media route accepts. Opaque and enumerable. */
export const CLIENT_APPROVAL_MEDIA_REFS = ['content', 'thumbnail'] as const;
export type ClientApprovalMediaRef =
  (typeof CLIENT_APPROVAL_MEDIA_REFS)[number];

export function isClientApprovalMediaRef(
  value: unknown,
): value is ClientApprovalMediaRef {
  return (
    typeof value === 'string' &&
    (CLIENT_APPROVAL_MEDIA_REFS as readonly string[]).includes(value)
  );
}

/**
 * CA0 §AB. `changes_requested` and a return to internal review are the same
 * thing to a customer — the agency is working on it — so both project to
 * `in_revision` and neither exposes the internal machine.
 *
 * `draft` and `awaiting_internal_review` are unreachable here: the visibility
 * rule only ever selects rows with `sent_to_client_at IS NOT NULL`. A request
 * that was sent and bounced back to internal review lands on `in_revision`,
 * which is why that status maps rather than throwing.
 */
export function toClientApprovalStatus(
  status: SocialApprovalStatus,
): ClientApprovalStatus {
  switch (status) {
    case 'awaiting_client':
      return 'awaiting_your_review';
    case 'approved':
      return 'approved';
    case 'superseded':
      return 'replaced';
    case 'cancelled':
      return 'withdrawn';
    case 'changes_requested':
    case 'awaiting_internal_review':
    case 'draft':
    default:
      return 'in_revision';
  }
}

function iso(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  return value instanceof Date
    ? value.toISOString()
    : new Date(value).toISOString();
}

/** Last moment anything the client can perceive happened. */
function lastActivityAt(
  approval: SocialApprovalRequestEntity,
  comments: readonly SocialApprovalCommentEntity[],
): string {
  const candidates = [
    iso(approval.sentToClientAt),
    iso(approval.approvedAt),
    iso(approval.cancelledAt),
    iso(approval.supersededAt),
    iso(approval.clientLastViewedAt),
    ...comments.map((comment) => iso(comment.createdAt)),
  ].filter((value): value is string => Boolean(value));

  return candidates.sort().at(-1) ?? iso(approval.createdAt)!;
}

export function buildClientApprovalListItem(
  approval: SocialApprovalRequestEntity,
  comments: readonly SocialApprovalCommentEntity[] = [],
  /**
   * AP4 — the id of the client-visible replacement, already proven safe by
   * `resolveReplacementApproval` (same scope, same root, later, sent to the
   * client). Omitted entirely unless the caller found one; this function
   * never resolves it itself; it only decides whether to surface what it was
   * handed.
   */
  replacementApprovalId?: string | null,
): ClientApprovalListItem {
  const status = toClientApprovalStatus(approval.status);
  return {
    id: approval.id,
    title: approval.title,
    displayType: approval.displayType,
    status,
    versionLabel: approval.subjectVersionLabel,
    // Non-null by the visibility rule: unsent approvals are never projected.
    sentToClientAt: iso(approval.sentToClientAt)!,
    approvedAt: iso(approval.approvedAt),
    lastActivityAt: lastActivityAt(approval, comments),
    needsYou: status === 'awaiting_your_review',
    ...(status === 'replaced' && replacementApprovalId
      ? { replacementApprovalId }
      : {}),
  };
}

export function buildClientApprovalComment(
  comment: SocialApprovalCommentEntity,
  author: ClientApprovalAuthor,
  readerUserId: string,
): ClientApprovalComment {
  return {
    id: comment.id,
    body: comment.body,
    createdAt: iso(comment.createdAt)!,
    author,
    mine: comment.actorUserId === readerUserId,
  };
}

/**
 * Client-visible history (§54): the events a customer took part in or can
 * perceive. Internal decisions never appear — the decisions passed in are
 * already filtered to `stage='client'` by the caller.
 */
export function buildClientApprovalHistory(
  approval: SocialApprovalRequestEntity,
  clientDecisions: readonly SocialApprovalStageDecisionEntity[],
  clientComments: readonly SocialApprovalCommentEntity[],
  nameFor: (userId: string | null) => string | null,
): ClientApprovalHistoryEntry[] {
  const entries: ClientApprovalHistoryEntry[] = [];

  const sentAt = iso(approval.sentToClientAt);
  if (sentAt) {
    entries.push({
      id: `${approval.id}:sent`,
      kind: 'sent',
      at: sentAt,
      actorName: null,
    });
  }

  const firstViewedAt = iso(approval.clientFirstViewedAt);
  if (firstViewedAt) {
    entries.push({
      id: `${approval.id}:viewed`,
      kind: 'viewed',
      at: firstViewedAt,
      actorName: nameFor(approval.clientViewedByUserId),
    });
  }

  // A request-changes reason is already a comment row; the decision below
  // carries the same moment, so comments that anchor a decision are skipped
  // here to avoid narrating the same event twice.
  const decisionCommentIds = new Set(
    clientDecisions.map((decision) => decision.commentId).filter(Boolean),
  );
  for (const comment of clientComments) {
    if (decisionCommentIds.has(comment.id)) continue;
    entries.push({
      id: `comment:${comment.id}`,
      kind: 'commented',
      at: iso(comment.createdAt)!,
      actorName: nameFor(comment.actorUserId),
    });
  }

  for (const decision of clientDecisions) {
    entries.push({
      id: `decision:${decision.id}`,
      kind: decision.decision === 'approved' ? 'approved' : 'changes_requested',
      at: iso(decision.createdAt)!,
      actorName: nameFor(decision.actorUserId),
    });
  }

  const supersededAt = iso(approval.supersededAt);
  if (supersededAt) {
    entries.push({
      id: `${approval.id}:replaced`,
      kind: 'replaced',
      at: supersededAt,
      actorName: null,
    });
  }

  const cancelledAt = iso(approval.cancelledAt);
  if (cancelledAt) {
    entries.push({
      id: `${approval.id}:withdrawn`,
      kind: 'withdrawn',
      at: cancelledAt,
      actorName: null,
    });
  }

  return entries.sort((a, b) => a.at.localeCompare(b.at));
}

/**
 * Rewrites the resolver preview into client terms: Agency asset paths become
 * opaque refs the Client Area media route resolves against this approval
 * (§25/§26). No id of the underlying asset or revision survives.
 */
export function buildClientApprovalPreview(
  preview: ApprovalSubjectPreview,
): ClientApprovalPreview {
  if (preview.format === 'media' && preview.media) {
    return {
      title: preview.title,
      versionLabel: preview.versionLabel,
      format: 'media',
      media: {
        assetType: preview.media.assetType,
        contentRef: 'content',
        thumbnailRef: preview.media.thumbnailPath ? 'thumbnail' : null,
      },
    };
  }

  return {
    title: preview.title,
    versionLabel: preview.versionLabel,
    format: 'text',
    text: {
      copy: preview.text?.copy ?? null,
      caption: preview.text?.caption ?? null,
      script: preview.text?.script ?? null,
      cta: preview.text?.cta ?? null,
      hashtags: preview.text?.hashtags ?? [],
      firstComment: preview.text?.firstComment ?? null,
    },
  };
}

/**
 * What the reader may do right now: the intersection of their permissions and
 * what the domain would accept. The domain re-checks both on every mutation —
 * this only keeps the UI from offering an action that would 409.
 */
export function buildClientApprovalActions(
  approval: SocialApprovalRequestEntity,
  permissions: { comment: boolean; decide: boolean },
): ClientApprovalActions {
  const open = approval.status === 'awaiting_client';
  return {
    canComment: open && permissions.comment,
    canDecide: open && permissions.decide,
  };
}
