import type {
  BusinessModeDimension,
  IntelligenceScope,
} from '../../../common/intelligence';

/**
 * How a projector asks for a context's business mode.
 *
 * ## Why a port at all, when the value is one column
 *
 * Not for polymorphism — there is one implementation and no second one planned.
 * It exists to keep the dependency arrow pointing the right way. Business Mode
 * is stored by LeadFlow; `intelligence-analytics` is forbidden by its own
 * boundary spec from naming LeadFlow tables or holding a repository, and
 * `common/intelligence` is forbidden from importing any domain module at all.
 * Without a port, the only ways to get the value into a response are for the
 * projector to query `leadflow_client_settings` directly (breaking the first
 * rule) or for the contract to import a LeadFlow service (breaking the second).
 *
 * The interface is one method returning one label. Anything richer would be
 * inventing an abstraction for a problem that does not have one yet.
 *
 * ## Why not `IntelligenceFactSource`
 *
 * That contract is about measurements over a window at a grain, and every part
 * of its shape assumes it. A business mode has no window, no grain, cannot be
 * summed and has no `lastSyncedAt`. Implementing it here would mean fabricating
 * a day dimension so that a string could be returned through a series — the
 * abstraction would be carried by the caller rather than paid for by it.
 */
export interface BusinessModeDimensionPort {
  /**
   * The mode configured for exactly this scope, right now.
   *
   * ## Never throws for a missing context
   *
   * A context with no LeadFlow settings row is the Social-only case, and it is
   * ordinary rather than exceptional — the tenant may hold a Social entitlement
   * and no LeadFlow one, in which case no row will ever exist. Resolving to
   * `unconfigured` is what lets such a tenant read its own paid-media analytics
   * without a product it does not own deciding the request fails.
   *
   * ## The scope is the whole authorization
   *
   * `IntelligenceScope` arrives already resolved by the surface that was
   * allowed to resolve it, and carries the `agencyClientId` whose null means
   * "the agency's own context" and never "any client". The implementation must
   * translate that null into an `IS NULL` predicate: dropping the filter would
   * return whichever managed client's row happened to be found first.
   */
  businessMode(scope: IntelligenceScope): Promise<BusinessModeDimension>;
}
