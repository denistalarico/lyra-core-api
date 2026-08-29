import type {
  IntelligenceDomain,
  IntelligenceFactSet,
  IntelligenceGrain,
} from './intelligence-fact';
import type { IntelligenceRatioDescriptor } from './intelligence-ratio';
import type { IntelligenceScope } from './intelligence-scope';
import type { IntelligenceWindow } from './intelligence-window';

/**
 * What a caller asks a fact source for.
 *
 * `scope` is already resolved — see `IntelligenceScope`. There is no field here
 * a caller could use to widen it, and no `tenantId` a query parameter could
 * reach: the surface that accepted the request decided the scope, and an adapter
 * receives the decision rather than the request.
 *
 * `subjectId` is optional because the two adapters answer differently about what
 * a subject is. Paid media needs one — facts belong to a specific ad account,
 * and there may be several in scope. LeadFlow's subject is the workspace itself,
 * which the scope already names.
 */
export type IntelligenceFactQuery = {
  scope: IntelligenceScope;
  window: IntelligenceWindow;
  grain: IntelligenceGrain;
  /** Required where the domain has more than one subject per scope. */
  subjectId?: string;
};

/**
 * The port every domain exposes its numbers through.
 *
 * The one idea this whole layer is built on: **the source of truth stays in the
 * domain that owns it.** No fact is copied into a universal table, no fact is
 * published onto an event bus, nothing is materialised. Each domain answers
 * questions about its own data, from its own storage, under a shape that makes
 * the answers comparable — and remains free to change how it stores them.
 *
 * That is why this is a read-time port and not a warehouse. A universal fact
 * table would need a writer per domain, a backfill per domain, and a reconciler
 * for when the copy and the original disagree; and the copy would be wrong every
 * time a domain restated a day, which paid media does every day for D0.
 *
 * ## Boundary
 *
 * This is a domain/service-layer port, and **authorization happens before it**.
 * There is no permission guard inside an adapter, deliberately: an adapter is
 * called from HTTP surfaces, from scheduled work, and eventually from the Client
 * Area, and a guard written for one of those is wrong for the others. What an
 * adapter does enforce is *scope* — every query it issues binds the tenant,
 * workspace and client it was given, and it will not answer without them. The
 * split is: the caller decides who may ask, the adapter guarantees what the
 * answer is about.
 */
export interface IntelligenceFactSource {
  /** The domain this source speaks for. */
  readonly domain: IntelligenceDomain;

  /**
   * Grains this source can answer at. A caller asking for anything else gets a
   * thrown error, not an empty set — an empty set reads as "no data".
   */
  readonly supportedGrains: readonly IntelligenceGrain[];

  /**
   * Ratios derivable from this source's metrics, as recipes.
   *
   * Empty where the domain publishes none. Never pre-computed into facts.
   */
  readonly ratios: readonly IntelligenceRatioDescriptor[];

  /**
   * The facts, or an empty fact set — never a partial answer presented as whole.
   *
   * An empty `facts` array with populated `freshness.coverage` is the honest
   * answer for a window the domain has no data for, and it is distinguishable
   * from a window the domain has not synced yet by `coverage.coveredDays`.
   */
  fetch(query: IntelligenceFactQuery): Promise<IntelligenceFactSet>;
}
