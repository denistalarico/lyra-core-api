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
  /**
   * CC2G.1 — the Company Context, when the caller can supply one.
   *
   * Optional and additive on purpose: `LeadFlowAnalyticsScope` is also built by
   * the cross-domain `intelligence-analytics` composition (Social + LeadFlow),
   * whose own `IntelligenceScope` has no company concept yet — widening that
   * shared contract is Social work, out of scope here. Every caller that *can*
   * resolve a Company Context (operational analytics, overview, commercial
   * journey — all LeadFlow-only) must set this field and use the `_COMPANY`
   * predicates below instead of `LEADFLOW_SCOPE_SQL`. A caller that leaves it
   * `null`/`undefined` keeps reading the legacy `metadata->>'clientId'`
   * predicate, unchanged.
   */
  companyContextId?: string | null;
};

/**
 * The first four positional parameters, in the order `LEADFLOW_SCOPE_SQL`
 * expects.
 *
 * Returned as a fixed four-tuple so a caller appending its own parameters starts
 * at `$5` and cannot accidentally shift `$3`/`$4` out from under the SQL.
 */
export function leadFlowScopeParameters(
  scope: LeadFlowAnalyticsScope,
): [string, string, string, string | null] {
  return [scope.tenantId, scope.workspaceId, scope.contextType, scope.clientId];
}

/**
 * CC2G.1 — the company-aware predicates.
 *
 * These read the persisted `agency_client_id`/`company_context_id` columns
 * CC2E/CC2F added to the operational roots, instead of the legacy
 * `metadata->>'clientId'` JSONB stamp `LEADFLOW_SCOPE_SQL` reads. They exist
 * beside the legacy predicates rather than replacing them, because not every
 * caller of `LEADFLOW_SCOPE_SQL` can supply a `companyContextId` yet (see
 * `LeadFlowAnalyticsScope.companyContextId`).
 *
 * ## Behaviour difference from `LEADFLOW_SCOPE_SQL`, documented rather than
 * silently fixed
 *
 * The legacy predicate's "known overlap" (a channel with both a `clientId` and
 * `operatingMode: 'agency'` matches both contexts) does not exist here. These
 * predicates test persisted columns with a database CHECK constraint behind
 * them (`scope_kind` is exactly one of `agency`/`company`/`legacy_unassigned`,
 * enforced at the schema level by the CC2E/CC2F migrations), so a row matches
 * exactly one context — agency, or exactly one company — never both, and a
 * `legacy_unassigned` row (no company recorded) matches neither a client-mode
 * nor an agency-mode read under these predicates once `AND scope_kind =
 * 'company'` — see below — narrows the row set further. This is intentional:
 * §4 of the CC2G.1 brief requires legacy rows to be invisible to every company,
 * and re-deriving the old overlap here would reintroduce exactly the client-wide
 * blindness this phase exists to remove.
 *
 * ## The parameter contract
 *
 * `$3` is still the context type, `$4` still the client id (or NULL in agency
 * context) — unchanged from `LEADFLOW_SCOPE_SQL`, so a caller migrating from one
 * to the other does not have to renumber its own predicates. The only addition
 * is `$5`, the Company Context id (NULL in agency context). A caller appending
 * its own parameters after a `_COMPANY` predicate starts at `$6`.
 */
export const LEADFLOW_SCOPE_SQL_COMPANY = {
  /** Requires aliases `conversation` and `channel`. */
  CHANNEL: `(
  ($3 = 'client' AND channel.agency_client_id = $4::uuid AND channel.company_context_id = $5::uuid)
  OR
  ($3 = 'agency' AND (
    conversation.channel_id IS NULL
    OR channel.agency_client_id IS NULL
  ))
)`,

  /** Requires alias `channel`. For querying `inbox_channels` directly. */
  CHANNEL_ONLY: `(
  ($3 = 'client' AND channel.agency_client_id = $4::uuid AND channel.company_context_id = $5::uuid)
  OR
  ($3 = 'agency' AND channel.agency_client_id IS NULL)
)`,

  /** Requires alias `opportunity`. */
  OPPORTUNITY: `(
  ($3 = 'client' AND opportunity.agency_client_id = $4::uuid AND opportunity.company_context_id = $5::uuid)
  OR
  ($3 = 'agency' AND opportunity.agency_client_id IS NULL)
)`,
} as const;

/**
 * The first five positional parameters, in the order `LEADFLOW_SCOPE_SQL_COMPANY`
 * expects.
 *
 * Throws rather than binding a NULL when a client-mode scope carries no
 * `companyContextId` — the whole reason this tuple exists is to keep a company
 * predicate from ever silently degrading to a client-wide one. Callers resolve
 * the scope through `resolveCompanyAwareScope`, which already refuses that
 * shape before a query is ever built; this is a second, cheaper guard for
 * anything that constructs a `LeadFlowAnalyticsScope` by hand (tests, mostly).
 */
export function leadFlowCompanyScopeParameters(
  scope: LeadFlowAnalyticsScope,
): [string, string, string, string | null, string | null] {
  if (scope.contextType === 'client' && !scope.companyContextId) {
    throw new Error(
      'leadFlowCompanyScopeParameters requires a companyContextId in client context.',
    );
  }
  return [
    scope.tenantId,
    scope.workspaceId,
    scope.contextType,
    scope.clientId,
    scope.companyContextId ?? null,
  ];
}
