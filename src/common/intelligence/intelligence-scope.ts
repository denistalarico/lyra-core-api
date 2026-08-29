/**
 * The context a fact belongs to.
 *
 * Deliberately *not* `RequestContext`. That interface carries `userId`,
 * `sessionId`, `role` and a `productKey` — everything an HTTP request happens to
 * know — and a fact source has no business seeing any of it. Passing the request
 * context down would also make the port unusable from the places it must
 * eventually serve: a scheduled job, a Client Area render, a report generated
 * hours after the session that asked for it ended.
 *
 * So this is the *resolved* scope and nothing else: three identifiers, already
 * decided by whoever was allowed to decide them.
 *
 * `agencyClientId` is nullable and the null means something specific — the
 * agency's own context, not "any client". Every adapter must translate it into
 * an `IS NULL` predicate rather than dropping the filter; the two look identical
 * in TypeORM's `where` and differ by every managed client's data.
 */
export type IntelligenceScope = {
  tenantId: string;
  workspaceId: string;
  /** NULL means the agency's own context — never "unfiltered". */
  agencyClientId: string | null;
};

/**
 * Narrows a request-shaped object to a scope, refusing anything incomplete.
 *
 * Exists so the translation from "what the request said" to "what the adapter
 * receives" happens once, in the consuming surface, under a name that makes the
 * boundary visible in a stack trace. An adapter never calls this: by the time it
 * has a scope, the decision is already made.
 *
 * Throws rather than defaulting. A missing workspace is not a request for every
 * workspace, and the historical way multi-tenant data leaks is a filter that
 * quietly became optional.
 */
export function requireIntelligenceScope(input: {
  tenantId?: string | null;
  workspaceId?: string | null;
  agencyClientId?: string | null;
}): IntelligenceScope {
  if (!input.tenantId) {
    throw new Error('IntelligenceScope requires a tenantId.');
  }

  if (!input.workspaceId) {
    throw new Error('IntelligenceScope requires a workspaceId.');
  }

  return {
    tenantId: input.tenantId,
    workspaceId: input.workspaceId,
    agencyClientId: input.agencyClientId ?? null,
  };
}
