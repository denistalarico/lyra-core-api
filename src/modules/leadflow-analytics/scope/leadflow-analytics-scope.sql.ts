/**
 * What "this client's data" means in LeadFlow analytics, written once.
 *
 * LeadFlow binds a managed client through `metadata->>'clientId'` rather than a
 * column, so every scoped read carries the same JSONB predicate inline. Before
 * this file it appeared five times in `LeadFlowOperationalAnalyticsService`
 * alone, and the intelligence adapter would have made a sixth — at which point
 * "the numbers disagree between two screens" becomes a plausible bug with no
 * single place to fix it.
 *
 * The predicates are exported as SQL text rather than as a query builder because
 * that is what the callers are: hand-written `dataSource.query` strings with
 * positional parameters. A builder would have forced a rewrite of the very
 * services this is meant to leave alone.
 *
 * ## The parameter contract
 *
 * Every predicate here reads exactly two placeholders, and each caller must bind
 * them in these positions:
 *
 * - `$3` — the context type, `'client'` or `'agency'`
 * - `$4` — the client id, or `NULL` in agency context
 *
 * The pairing is what makes the predicate safe: in agency context the `$3`
 * comparison fails first and `$4` is never compared, so a null client id can
 * never widen the filter into "every client". `leadFlowScopeParameters` below
 * returns `$1`–`$4` as a fixed tuple, so a caller appending its own parameters
 * starts at `$5` and cannot shift these out from under the SQL.
 */

/**
 * The two shapes, and why they differ.
 *
 * `CHANNEL` is for rows reached *through* a channel — conversations and their
 * messages. Its agency branch has an extra arm, `conversation.channel_id IS
 * NULL`, because a conversation with no channel has no client binding to read
 * and belongs to the agency by default. It therefore requires a `conversation`
 * alias in scope alongside `channel`.
 *
 * `CHANNEL_ONLY` is the same rule for querying `inbox_channels` directly, where
 * there is no conversation to check.
 *
 * `OPPORTUNITY` is for rows that carry the binding themselves, and needs no such
 * arm.
 *
 * These three were extracted verbatim from the five inline copies in
 * `LeadFlowOperationalAnalyticsService`; the variation between those copies was
 * only ever which aliases were in scope, never a difference of intent.
 *
 * ## Known overlap: the contexts cover, they do not partition
 *
 * A channel carrying **both** `clientId` and `operatingMode: 'agency'` matches
 * the client branch *and* the agency branch, so its rows are counted under both
 * contexts. This is long-standing behaviour, not something the extraction
 * introduced, and it is asserted explicitly in
 * `leadflow-intelligence.postgres.spec` so a future change to it fails loudly
 * rather than silently moving numbers on the LeadFlow screens.
 *
 * Whether an agency-operated client channel should belong to one context or
 * both is a product question. Do not "fix" it here without deciding that: every
 * screen these predicates serve would change at once.
 */
export const LEADFLOW_SCOPE_SQL = {
  /** Requires aliases `conversation` and `channel`. */
  CHANNEL: `(
  ($3 = 'client' AND channel.metadata->>'clientId' = $4)
  OR
  ($3 = 'agency' AND (
    conversation.channel_id IS NULL
    OR channel.metadata->>'clientId' IS NULL
    OR channel.metadata->>'operatingMode' = 'agency'
  ))
)`,

  /** Requires alias `channel`. For querying `inbox_channels` directly. */
  CHANNEL_ONLY: `(
  ($3 = 'client' AND channel.metadata->>'clientId' = $4)
  OR
  ($3 = 'agency' AND (
    channel.metadata->>'clientId' IS NULL
    OR channel.metadata->>'operatingMode' = 'agency'
  ))
)`,

  /** Requires alias `opportunity`. */
  OPPORTUNITY: `(
  ($3 = 'client' AND opportunity.metadata->>'clientId' = $4)
  OR
  ($3 = 'agency' AND (
    opportunity.metadata->>'clientId' IS NULL
    OR opportunity.metadata->>'operatingMode' = 'agency'
  ))
)`,
} as const;

/** The resolved scope these predicates are parameterised by. */
export type LeadFlowAnalyticsScope = {
  tenantId: string;
  workspaceId: string;
  contextType: 'agency' | 'client';
  clientId: string | null;
};

/**
 * The first four positional parameters, in the order the predicates expect.
 *
 * Returned as a fixed four-tuple so a caller appending its own parameters starts
 * at `$5` and cannot accidentally shift `$3`/`$4` out from under the SQL.
 */
export function leadFlowScopeParameters(
  scope: LeadFlowAnalyticsScope,
): [string, string, string, string | null] {
  return [scope.tenantId, scope.workspaceId, scope.contextType, scope.clientId];
}
