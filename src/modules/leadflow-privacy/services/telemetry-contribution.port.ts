/**
 * How the consent owner asks a domain for a context's candidate contributions.
 *
 * ## Why the privacy module declares this and not the other way round
 *
 * The dependency arrow is the whole point. `leadflow-privacy` owns the gate, the
 * notice, the consent, the pseudonym, retention, revocation and erasure — and it
 * imports nothing but `permissions`. If it imported `intelligence-analytics` to
 * reach the paid-media builder it would acquire, transitively, Social and
 * LeadFlow analytics; the module that decides whether *anything* may be
 * collected would then be unable to start without the modules it polices.
 *
 * So privacy declares the shape it needs, Intelligence implements it, and
 * `app.module` binds the two. Adding a second contributing domain later means
 * one more provider in that array and no change here.
 *
 * ## Why a port rather than a direct call in the other direction
 *
 * A domain that could write facts itself would be a second collection path
 * outside the module enforcing consent — §2's explicit prohibition. This
 * interface is deliberately powerless: it returns rows and cannot persist them,
 * cannot read consent, cannot create a pseudonym and never learns whether its
 * output was used. `PaidMediaContributionService` is already built that way; the
 * port is what makes it structural rather than a property of today's caller.
 *
 * ## Contract for implementers
 *
 * - **Fail closed by returning nothing.** A domain unable to build its rows
 *   returns `[]`. It must not throw the collection of other domains away.
 * - **Read local facts only.** No provider call, no credential, no identifier
 *   that could re-link a row to the context it came from.
 * - **Return complete days only.** The window handed in already excludes today;
 *   an implementation must not widen it.
 */
import type { TelemetryContributionScope } from '../types/leadflow-telemetry.types';

/**
 * One privacy-safe daily fact, in the shape the fact table stores.
 *
 * There is no scope, no tenant and no pseudonym here, and there is nowhere to
 * put one: the collector attaches the pseudonym after consent has been checked.
 * An implementation physically cannot return an identified row.
 */
export type TelemetryContribution = {
  /** The completed day this fact describes, `YYYY-MM-DD`. */
  observedOn: string;
  /** A metric key from a closed, versioned vocabulary. */
  metricKey: string;
  /** A serialized cohort key from a closed vocabulary; `'all'` when undimensioned. */
  dimensionKey: string;
  /** An exact integer, as text, because the column is `bigint`. */
  metricValue: string;
};

export interface TelemetryContributionSource {
  /**
   * A stable name for this contributor, used in the audit trail so an operator
   * can see which domains produced a snapshot.
   */
  readonly contributionSourceKey: string;

  /**
   * The rows this domain would contribute for a scope and completed-day range.
   *
   * Called only after the gate, the notice and the consent have all passed, so
   * an implementation neither needs nor receives a way to check them.
   */
  buildContributions(input: {
    scope: TelemetryContributionScope;
    since: string;
    until: string;
  }): Promise<TelemetryContribution[]>;
}

/**
 * The set of domains that contribute to a snapshot.
 *
 * ## Why a registry and not a multi-provider token
 *
 * Nest resolves an injection token only for a module that imports the module
 * providing it. A token bound by Intelligence and consumed by privacy therefore
 * requires `leadflow-privacy` to import `intelligence-analytics` — the exact
 * arrow that would make the module enforcing consent depend on the modules it
 * polices, and that would put Social and LeadFlow analytics in the boot path of
 * every consent check.
 *
 * A registry inverts it. Privacy owns and provides this class; Intelligence
 * imports privacy — which is the direction that was always safe — and registers
 * itself on init. The collector reads whatever is registered. Neither half
 * imports upward, and a deployment without Intelligence simply has an empty
 * registry and collects exactly what it collected before I6.1.
 *
 * ## It is append-only and holds no state beyond the list
 *
 * There is no deregistration and no ordering guarantee, because a contributor
 * that could remove another would be a way to silently suppress a domain's
 * facts, and order cannot matter when every row is keyed independently.
 */
export class TelemetryContributionRegistry {
  private readonly sources: TelemetryContributionSource[] = [];

  register(source: TelemetryContributionSource): void {
    if (
      this.sources.some(
        (existing) =>
          existing.contributionSourceKey === source.contributionSourceKey,
      )
    ) {
      // Idempotent: a module initialised twice (as in a test harness that
      // rebuilds the graph) must not double every fact it contributes.
      return;
    }

    this.sources.push(source);
  }

  all(): readonly TelemetryContributionSource[] {
    return this.sources;
  }
}
