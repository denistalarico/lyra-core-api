/**
 * CCOM2 §19–§24 — the cross-source timeline merge.
 *
 * Pure functions, no repositories and no identity. The two sources are fetched
 * by whoever owns them (the conversations service for messages, the approvals
 * port for comments) and merged here, so the ordering rule exists exactly once
 * and can be tested without a database.
 *
 * WHY A MERGE AND NOT A TABLE (CCOM0 §13)
 * ---------------------------------------
 * `social_approval_comments` stays canonical where it is: it carries three
 * CHECK constraints, a `visibility` that defaults to `internal` so a writer who
 * forgets cannot leak, and the id that AP4 uses as a notification
 * `source_event_id`. Copying the text into `client_conversation_messages` would
 * trade all of that for a simpler read, and would mean the conversation's
 * permission (`...conversations.send`) started governing approval comments.
 *
 * THE COST, PAID HERE
 * -------------------
 * Keyset pagination over two sources is harder than `LessThan(createdAt)` on
 * one table. The three rules that make it correct:
 *
 *   1. the sort key is `(created_at, source, id)` and it is *total* — `id` is
 *      unique only within its own table, so without `source` two rows from
 *      different tables with one timestamp can compare equal, and a page
 *      boundary then repeats or skips one (§23);
 *   2. each source is asked for `limit + 1` rows strictly older than the
 *      cursor, so the merged window always contains at least the `limit`
 *      globally-oldest rows available (§22);
 *   3. the response is truncated to `limit` *after* the merge, so `limit` is
 *      the size of the timeline and not of each source (§24).
 */

import {
  compareTimelinePositions,
  encodeConversationCursor,
  type ClientConversationCursor,
  type ClientConversationTimelineSource,
} from '../client-conversation.types';

/** The minimum any timeline row must expose to be ordered. */
export type TimelinePosition = {
  createdAt: Date;
  source: ClientConversationTimelineSource;
  id: string;
};

/**
 * True when `row` is strictly older than `cursor` under the total order.
 *
 * Used to filter the approval-comment side in memory (its rows come from
 * another module's query, which cannot see this cursor's shape) while the
 * message side filters in SQL. Both must agree, which is why both route
 * through `compareTimelinePositions`.
 */
export function isBeforeCursor(
  row: TimelinePosition,
  cursor: ClientConversationCursor | null,
): boolean {
  if (!cursor) return true;
  return compareTimelinePositions(row, cursor) < 0;
}

/**
 * Merges the sources into one descending window and cuts one page out of it.
 *
 * Returns the page oldest-first (what a conversation renders) plus the cursor
 * of the page's own oldest row — paging walks backwards, so the next request
 * continues from there.
 *
 * `hasMore` is decided from the merged window, not from either source: a window
 * that held more than `limit` rows means something older is still unread, even
 * when one of the two sources was exhausted.
 */
export function mergeTimelinePage<T extends TimelinePosition>(
  sources: readonly T[][],
  limit: number,
): { items: T[]; nextCursor: string | null } {
  const merged = sources
    .flat()
    // Descending, so "the oldest `limit` rows of the newest window" is a
    // prefix and the cut below cannot drop a row that belongs on this page.
    .sort((left, right) => compareTimelinePositions(right, left));

  const page = merged.slice(0, limit);
  const oldest = page[page.length - 1];

  return {
    items: page.slice().reverse(),
    nextCursor:
      merged.length > page.length && oldest
        ? encodeConversationCursor({
            createdAt: oldest.createdAt,
            source: oldest.source,
            id: oldest.id,
          })
        : null,
  };
}
