/**
 * CCOM1 — Client Conversation domain contracts.
 *
 * A conversation between the agency and a real client person, scoped to one
 * Company Context. Deliberately a domain of its own rather than a widening of
 * `agency_chat_*` (CCOM0 §33): the Agency chat tables cannot express
 * `company_context_id`, carry no CHECK constraints, and their permission keys
 * (`agency.chat.*`) would end up governing client access.
 *
 * The two surfaces that can hold a seat here are named explicitly and never
 * inferred from a user id — the same person may legitimately be an Agency
 * operator in one tenant and a client member in another, and the id space is
 * shared (`user_security_settings`), so the surface is part of the
 * participant's identity (CCOM1 §6/§54).
 */

/** Which door a participant came through. Never derived from the user id. */
export const CLIENT_CONVERSATION_SURFACES = ['agency', 'client_area'] as const;
export type ClientConversationSurface =
  (typeof CLIENT_CONVERSATION_SURFACES)[number];

export const CLIENT_CONVERSATION_STATUSES = ['active', 'archived'] as const;
export type ClientConversationStatus =
  (typeof CLIENT_CONVERSATION_STATUSES)[number];

/**
 * V1 holds a single default channel per company, but the row has its own id so
 * a second channel later is a new row, not a schema change (CCOM0 §5). The
 * uniqueness that enforces "one" is a partial index, not the primary key.
 */
export const CLIENT_CONVERSATION_KINDS = ['default'] as const;
export type ClientConversationKind = (typeof CLIENT_CONVERSATION_KINDS)[number];

/**
 * Participant role inside a conversation. Separate from the Client Area role
 * preset and from Agency roles: it describes the seat, while what a person may
 * *do* is re-resolved per request from their own surface's authorization.
 */
export const CLIENT_CONVERSATION_PARTICIPANT_ROLES = [
  'member',
  'owner',
] as const;
export type ClientConversationParticipantRole =
  (typeof CLIENT_CONVERSATION_PARTICIPANT_ROLES)[number];

/**
 * V1 message kinds (CCOM1 §11). `text` is the whole product case; `attachment`
 * carries a file; `system` is the platform speaking.
 *
 * CCOM2 §5 — the approval card is **not** a fourth kind. It is
 * `kind='system'` plus `metadata.card`, which is what the existing
 * `CK_client_conversation_messages_kind` already accepts, so the card needs no
 * migration. The alternative — adding `approval_card` to the enum — would have
 * cost a CHECK migration to express something the kind does not actually
 * decide: `system` already means "the platform is speaking, there is no human
 * author", which is exactly the card's nature, and the renderer discriminates
 * on `metadata.card.kind` rather than on the column. A second card type later
 * is another `metadata.card.kind` value, still with no schema change.
 */
export const CLIENT_CONVERSATION_MESSAGE_KINDS = [
  'text',
  'attachment',
  'system',
] as const;
export type ClientConversationMessageKind =
  (typeof CLIENT_CONVERSATION_MESSAGE_KINDS)[number];

export const CLIENT_CONVERSATION_ATTACHMENT_KINDS = [
  'image',
  'video',
  'audio',
  'document',
] as const;
export type ClientConversationAttachmentKind =
  (typeof CLIENT_CONVERSATION_ATTACHMENT_KINDS)[number];

/**
 * CCOM2 §3/§4 — the persisted approval card.
 *
 * A **reference plus the immutable minimum**, never a snapshot (CCOM0 §10).
 * `title` and `version` are safe to persist because they describe *that
 * revision at that moment* — legitimate history, not a cache. Everything that
 * ages is deliberately absent and resolved on read:
 *
 *   status            an approval walks awaiting_client → approved → replaced;
 *                     a stored status would lie in the conversation's history
 *   actionsPermitted  authorization has exactly one source, the per-request
 *                     guard chain; freezing it here would be a second one
 *   preview/media     media is bytes behind an authenticated route, never a
 *                     URL, so there is nothing to store that would still work
 *
 * The same discipline AP4 already proved with `replacementApprovalId`, which is
 * resolved by the projection and has no column.
 */
export const CLIENT_CONVERSATION_CARD_KINDS = ['approval_card'] as const;
export type ClientConversationCardKind =
  (typeof CLIENT_CONVERSATION_CARD_KINDS)[number];

export interface ClientConversationApprovalCard {
  kind: 'approval_card';
  /** The same opaque id AP3 already exposes to the client. */
  approvalId: string;
  title: string;
  version: string;
  /**
   * The card is stored in a `jsonb` column typed `Record<string, unknown>`, so
   * the shape has to be assignable to it. The four fields above are the whole
   * contract; this only makes the type usable as the column's value.
   */
  [key: string]: unknown;
}

/**
 * Message metadata. `card` is written only by the platform, through
 * `ClientConversationCardService` — never from a surface DTO, which has no
 * `metadata` field at all (CCOM2 §50).
 */
export interface ClientConversationMessageMetadata {
  card?: Record<string, unknown>;
  /** Makes a retried platform publication land once (CCOM2 §9). */
  dedupeKey?: string;
  [key: string]: unknown;
}

/**
 * Reads `metadata.card` as an approval card, or `null`.
 *
 * Validates shape rather than trusting it: this metadata is persisted JSON, and
 * a row written by an older or buggier path must degrade to "not a card"
 * instead of reaching the resolver with an undefined `approvalId` (which would
 * then query by `undefined` and match nothing silently — the failure mode
 * CCOM1 §6 already refused once).
 */
export function readApprovalCard(
  metadata: ClientConversationMessageMetadata | null | undefined,
): ClientConversationApprovalCard | null {
  const card = metadata?.card;
  if (!card || typeof card !== 'object') return null;

  const candidate = card;
  if (candidate.kind !== 'approval_card') return null;
  if (!isUuid(candidate.approvalId)) return null;

  return {
    kind: 'approval_card',
    approvalId: candidate.approvalId,
    title: typeof candidate.title === 'string' ? candidate.title : '',
    version: typeof candidate.version === 'string' ? candidate.version : '',
  };
}

/** The textual fallback body of a card (CCOM2 §3). */
export function approvalCardBody(title: string, version: string): string {
  return `Nova aprovação disponível: ${title} (${version})`;
}

/** Stable, machine-readable error codes of this domain. */
export const CLIENT_CONVERSATION_ERROR_CODES = {
  conversationNotFound: 'client_conversation_not_found',
  notAParticipant: 'client_conversation_not_a_participant',
  attachmentNotFound: 'client_conversation_attachment_not_found',
  conversationArchived: 'client_conversation_archived',
  messageEmpty: 'client_conversation_message_empty',
} as const;

/**
 * CCOM2 §18/§20 — which stream a timeline row came from.
 *
 * Part of the sort key, not decoration. Two sources can legitimately produce
 * rows with the *same* `created_at`, and `id` is only unique within its own
 * table, so `(created_at, id)` alone is not a total order across them: two
 * different rows could compare equal and a page boundary would then either
 * repeat or skip one. Ordering `source` between the timestamp and the id gives
 * a total order over the union with no coordination between the tables.
 *
 * The names are persisted inside cursors, so they are a contract: renaming one
 * invalidates every cursor in flight.
 */
export const CLIENT_CONVERSATION_TIMELINE_SOURCES = [
  'conversation_message',
  'approval_comment',
] as const;
export type ClientConversationTimelineSource =
  (typeof CLIENT_CONVERSATION_TIMELINE_SOURCES)[number];

/** Deterministic rank of a source, for the tie-break. */
export function timelineSourceRank(
  source: ClientConversationTimelineSource,
): number {
  return CLIENT_CONVERSATION_TIMELINE_SOURCES.indexOf(source);
}

export function isTimelineSource(
  value: unknown,
): value is ClientConversationTimelineSource {
  return (
    typeof value === 'string' &&
    (CLIENT_CONVERSATION_TIMELINE_SOURCES as readonly string[]).includes(value)
  );
}

/**
 * Keyset page cursor (CCOM1 §46, extended by CCOM2 §20).
 *
 * `(created_at, source, id)`. CCOM1 used `(created_at, id)` because
 * `created_at` alone is not unique and offset paging drifts when rows arrive
 * mid-read. With two sources merged on read, `source` is what keeps the order
 * *total* — see the note on the source list above.
 */
export interface ClientConversationCursor {
  createdAt: Date;
  source: ClientConversationTimelineSource;
  id: string;
}

/**
 * Compares two timeline positions by the full key. Negative when `left` is
 * older. The single definition both the merge and the cursor filter use, so
 * the in-memory sort cannot disagree with the SQL that produced the rows.
 */
export function compareTimelinePositions(
  left: {
    createdAt: Date;
    source: ClientConversationTimelineSource;
    id: string;
  },
  right: {
    createdAt: Date;
    source: ClientConversationTimelineSource;
    id: string;
  },
): number {
  const byTime = left.createdAt.getTime() - right.createdAt.getTime();
  if (byTime !== 0) return byTime;

  const bySource =
    timelineSourceRank(left.source) - timelineSourceRank(right.source);
  if (bySource !== 0) return bySource;

  return left.id.localeCompare(right.id);
}

export function encodeConversationCursor(
  cursor: ClientConversationCursor,
): string {
  return Buffer.from(
    `${cursor.createdAt.toISOString()}|${cursor.source}|${cursor.id}`,
    'utf8',
  ).toString('base64url');
}

/**
 * Decodes a cursor, or `null` for anything malformed (CCOM2 §21/§54).
 *
 * Accepts both shapes:
 *
 *   `{iso}|{source}|{uuid}`   CCOM2
 *   `{iso}|{uuid}`            CCOM1, still held by any open client
 *
 * A CCOM1 cursor is adapted deterministically to the oldest source rank, which
 * is `conversation_message` — the only source those cursors could ever have
 * pointed at, since no approval comment was in the timeline when they were
 * issued. Reading it as the *lowest* rank is also the conservative direction:
 * the next page starts strictly before that message, so an approval comment
 * sharing its exact timestamp is re-read rather than skipped.
 *
 * A bad cursor must never silently widen a page to "everything": callers treat
 * `null` as "first page", and it is never an error (§21).
 */
export function decodeConversationCursor(
  value: unknown,
): ClientConversationCursor | null {
  if (typeof value !== 'string' || !value.trim()) return null;

  try {
    const raw = Buffer.from(value, 'base64url').toString('utf8');
    const parts = raw.split('|');
    if (parts.length !== 2 && parts.length !== 3) return null;

    const createdAt = new Date(parts[0]);
    const source = parts.length === 3 ? parts[1] : 'conversation_message';
    const id = parts[parts.length - 1];

    if (Number.isNaN(createdAt.getTime())) return null;
    if (!isTimelineSource(source)) return null;
    if (!isUuid(id)) return null;

    return { createdAt, source, id };
  } catch {
    return null;
  }
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

export function isClientConversationSurface(
  value: unknown,
): value is ClientConversationSurface {
  return (
    typeof value === 'string' &&
    (CLIENT_CONVERSATION_SURFACES as readonly string[]).includes(value)
  );
}
