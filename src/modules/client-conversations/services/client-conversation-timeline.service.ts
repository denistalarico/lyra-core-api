import { Injectable } from '@nestjs/common';
import {
  ClientConversationApprovalsRegistry,
  type ConversationApprovalCardState,
  type ConversationApprovalCommentItem,
} from '../client-conversation-approvals.port';
import {
  decodeConversationCursor,
  readApprovalCard,
} from '../client-conversation.types';
import type { ClientConversationScope } from './client-conversation-access';
import {
  isBeforeCursor,
  mergeTimelinePage,
} from './client-conversation-timeline';
import {
  ClientConversationsService,
  type ConversationMessageView,
} from './client-conversations.service';

/** Max rows a single timeline page may return, whatever the caller asks. */
const MAX_PAGE_SIZE = 100;
const DEFAULT_PAGE_SIZE = 50;

/** What a card renders as, once resolved against the live approval (§12/§13). */
export type ConversationCardView = {
  kind: 'approval_card';
  approvalId: string;
  /** Historical, from `metadata.card` — the revision as it was announced. */
  announced: { title: string; version: string };
  /**
   * The current client-safe state, or `null` when the approval does not
   * resolve for this reader (§15: forged ref, internal-only, another company).
   * `null` is a degraded card, never an error and never an action.
   */
  state: ConversationApprovalCardState | null;
  actions: { canComment: boolean; canDecide: boolean; canOpenPreview: boolean };
};

export type ConversationTimelineMessageItem = ConversationMessageView & {
  /** Present only on a card message; a plain message carries `null`. */
  card: ConversationCardView | null;
};

export type ConversationTimelineCommentItem = {
  source: 'approval_comment';
  id: string;
  createdAt: Date;
  approvalId: string;
  body: string;
  authorName: string;
  authorSide: 'client' | 'agency';
  /** §41 — "Sobre: {title} ({version})", resolved client-safe. */
  about: { title: string; version: string };
  /** True when the reader wrote it, so the UI can align the bubble. */
  mine: boolean;
};

export type ConversationTimelineItem =
  | ConversationTimelineMessageItem
  | ConversationTimelineCommentItem;

export type ConversationTimelinePage = {
  items: ConversationTimelineItem[];
  nextCursor: string | null;
};

/**
 * The reader a timeline page is built for.
 *
 * Carries no scope: the scope is proven by the caller's own boundary and passed
 * separately. `permissions` are the reader's *live* approval permissions —
 * resolved per request by the guard chain (§13) — and an Agency reader or the
 * preview passes both false, which is what turns their card informational
 * without a second renderer.
 */
export type ConversationTimelineReader = {
  userId: string | null;
  approvalsModuleEnabled: boolean;
  permissions: { comment: boolean; decide: boolean };
};

/**
 * CCOM2 §18 — the cross-source timeline.
 *
 * Reads two canonical stores and emits one ordered page:
 *
 *   client_conversation_messages   canonical here (CCOM1), cards included as
 *                                  `kind='system'` rows with `metadata.card`
 *   social_approval_comments       canonical there, projected and never copied
 *                                  (CCOM0 §13)
 *
 * The approvals side arrives through `ClientConversationApprovalsPort`, so this
 * service never queries `social_approval_*` and never builds a second
 * client-safe projection of an approval (§11). When the port is unbound the
 * timeline degrades exactly to CCOM1's message list, which is the correct
 * behaviour for a deployment without the approvals surface.
 */
@Injectable()
export class ClientConversationTimelineService {
  constructor(
    private readonly conversations: ClientConversationsService,
    private readonly registry: ClientConversationApprovalsRegistry,
  ) {}

  /** The approvals port, or `null` when the join module is not wired. */
  private get approvals() {
    return this.registry.get();
  }

  /**
   * One page for a caller whose conversation access is already proven.
   *
   * `provision` is what separates the live surfaces from the preview: the
   * surfaces seat the actor and may create the conversation on first touch,
   * while the preview must do neither (§38). Both read through the same page
   * builder, so the preview cannot see more than the client would.
   */
  async page(
    scope: ClientConversationScope,
    conversationId: string,
    reader: ConversationTimelineReader,
    query: { limit?: unknown; before?: unknown } = {},
  ): Promise<ConversationTimelinePage> {
    const limit = resolveLimit(query.limit);
    const cursor = decodeConversationCursor(query.before);

    /**
     * Each source is asked for `limit + 1` rows strictly older than the cursor
     * (§22/§24). Asking each for the full limit — rather than splitting it — is
     * what makes the merge correct when one source holds the whole page; the
     * result is truncated to `limit` after merging, so the response never
     * returns `limit × sources` rows.
     */
    const [messages, comments] = await Promise.all([
      this.conversations.readMessageWindow(conversationId, limit, cursor),
      this.approvals
        ? this.approvals.listClientVisibleComments(scope, {
            before: cursor?.createdAt ?? null,
            limit: limit + 1,
            readerUserId: reader.userId,
          })
        : Promise.resolve([]),
    ]);

    /**
     * The comment source filters in memory against the full key.
     *
     * Its query can only narrow by timestamp — the approvals module neither
     * knows nor should know this cursor's shape — so a comment sharing the
     * cursor's exact timestamp comes back and is cut here, by the same
     * comparison the merge and the message SQL use. Over-fetching by a few rows
     * and filtering is correct; filtering only by timestamp would skip rows.
     */
    const commentWindow = comments
      .map((comment) => ({
        createdAt: comment.createdAt,
        source: 'approval_comment' as const,
        id: comment.id,
        comment,
      }))
      .filter((row) => isBeforeCursor(row, cursor));

    const merged = mergeTimelinePage<
      | {
          createdAt: Date;
          source: 'conversation_message';
          id: string;
          message: ConversationMessageView;
        }
      | {
          createdAt: Date;
          source: 'approval_comment';
          id: string;
          comment: (typeof comments)[number];
        }
    >(
      [
        messages.map((message) => ({
          createdAt: message.createdAt,
          source: 'conversation_message' as const,
          id: message.id,
          message,
        })),
        commentWindow,
      ],
      limit,
    );

    const cards = await this.resolveCards(
      scope,
      merged.items.flatMap((item) =>
        item.source === 'conversation_message'
          ? (readApprovalCard(item.message.metadata)?.approvalId ?? [])
          : [],
      ),
    );

    return {
      items: merged.items.map((item) =>
        item.source === 'conversation_message'
          ? this.toMessageItem(item.message, cards, reader)
          : toCommentItem(item.comment),
      ),
      nextCursor: merged.nextCursor,
    };
  }

  private async resolveCards(
    scope: ClientConversationScope,
    approvalIds: readonly string[],
  ): Promise<Map<string, ConversationApprovalCardState>> {
    const unique = [...new Set(approvalIds)];
    if (unique.length === 0 || !this.approvals) {
      return new Map<string, ConversationApprovalCardState>();
    }
    return this.approvals.resolveCards(scope, unique);
  }

  private toMessageItem(
    message: ConversationMessageView,
    cards: Map<string, ConversationApprovalCardState>,
    reader: ConversationTimelineReader,
  ): ConversationTimelineMessageItem {
    const card = readApprovalCard(message.metadata);
    if (!card) return { ...message, card: null };

    const state = cards.get(card.approvalId) ?? null;

    /**
     * §13/§14 — actions are resolved here, every read, from the reader's live
     * permissions and the module's availability. An approval that did not
     * resolve gets no actions at all, which is what makes §15 structural: a
     * forged `approvalId` in metadata widens nothing, because the only thing it
     * could have produced was a state this reader is allowed to see.
     */
    const actions =
      state && this.approvals
        ? this.approvals.resolveActions({
            state,
            approvalsModuleEnabled: reader.approvalsModuleEnabled,
            permissions: reader.permissions,
          })
        : { canComment: false, canDecide: false, canOpenPreview: false };

    return {
      ...message,
      card: {
        kind: 'approval_card',
        approvalId: card.approvalId,
        announced: { title: card.title, version: card.version },
        state,
        actions,
      },
    };
  }
}

/**
 * Projects one comment into a timeline item.
 *
 * A free function because it holds no dependency: `mine` and the author name
 * were both decided by the approvals projection, which is the only side that
 * ever sees `actor_user_id`. Nothing here can accidentally reach for an id
 * that is not in its input.
 */
function toCommentItem(
  comment: ConversationApprovalCommentItem,
): ConversationTimelineCommentItem {
  return {
    source: 'approval_comment',
    id: comment.id,
    createdAt: comment.createdAt,
    approvalId: comment.approvalId,
    body: comment.body,
    authorName: comment.authorName,
    authorSide: comment.authorSide,
    about: { title: comment.approvalTitle, version: comment.approvalVersion },
    mine: comment.mine,
  };
}

function resolveLimit(value: unknown): number {
  const parsed = Number(value ?? DEFAULT_PAGE_SIZE);
  if (!Number.isFinite(parsed)) return DEFAULT_PAGE_SIZE;
  return Math.min(Math.max(Math.trunc(parsed), 1), MAX_PAGE_SIZE);
}
