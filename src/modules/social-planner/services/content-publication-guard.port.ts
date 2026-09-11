/**
 * How the Planner asks whether a content item still has live publications
 * before it removes it (Planner E6).
 *
 * ## Why the Planner declares this instead of calling publications directly
 *
 * The arrow across this pair points one way and has to keep pointing that way:
 * `social-organic` imports Planner entities and `SocialPublicationService`
 * resolves Planner destinations, while nothing in `social-planner` imports
 * `social-organic`. Etapa 5 already respected it by putting
 * `DestinationCreativeService` on the Organic side, because choosing a creative
 * is genuinely a provider-capability decision.
 *
 * Deleting a content item is not. It is Planner logic almost end to end —
 * scope, ownership, archive state, restore — with exactly one question that the
 * Planner cannot answer alone: does an execution record exist that this
 * deletion would strand? So the Planner declares the question, Organic answers
 * it, and the arrow is unchanged.
 *
 * ## Why a registry and not an injection token
 *
 * Nest resolves a token only for a module that imports the module providing it.
 * A token bound by `social-organic` and consumed by `social-planner` would
 * require the Planner to import Organic, which is the inversion this file
 * exists to avoid. `TelemetryContributionRegistry` in `leadflow-privacy`
 * settled the same problem the same way: the upstream module owns the registry
 * class, the downstream module registers into it on init.
 *
 * ## The default is the opposite of the telemetry registry's, on purpose
 *
 * An empty telemetry registry means "contribute nothing", which is the safe
 * direction there. An empty registry here would mean "no publication was
 * found", and a caller reading that as permission to delete would be trusting
 * an answer nobody gave. So `SocialContentPublicationGuard` reports
 * `unavailable` when no source is registered, and the delete path refuses.
 * Losing the ability to check is never the same as passing the check.
 */

export type SocialContentPublicationBlocker = {
  /** The item that cannot be removed. */
  contentItemId: string;
  /**
   * The publication statuses standing in the way, deduplicated.
   *
   * Statuses, not publication ids: the operator needs to know *why* the action
   * is refused and what to do about it (cancel a `scheduled` one; nothing can
   * be done about a `published` one). Ids would be execution evidence leaking
   * into an editorial error message without making the message more useful.
   */
  statuses: string[];
};

/**
 * The statuses that make a content item undeletable (E6).
 *
 * `draft` and `cancelled` are absent because neither reserves anything: a
 * cancelled publication already ended and a draft never entered the queue.
 * `failed` is absent for the same reason — it is terminal, and the evidence row
 * survives the soft delete regardless.
 */
export const SOCIAL_CONTENT_BLOCKING_PUBLICATION_STATUSES = [
  'scheduled',
  'queued',
  'processing',
  'published',
] as const;

export interface SocialContentPublicationSource {
  /** Stable name for the answering domain, used in diagnostics. */
  readonly publicationSourceKey: string;

  /**
   * The blocking publications for the given content items, within the caller's
   * own scope.
   *
   * Implementations must filter by the full scope triple, and must return an
   * entry only for items that are actually blocked — an item absent from the
   * result is an item free to be removed.
   */
  findBlockingPublications(input: {
    scope: {
      tenantId: string;
      workspaceId: string;
      agencyClientId: string | null;
    };
    contentItemIds: string[];
  }): Promise<SocialContentPublicationBlocker[]>;
}

export type SocialContentPublicationCheck =
  | { available: true; blockers: Map<string, SocialContentPublicationBlocker> }
  | { available: false };

/**
 * The set of domains that can report live publications for Planner content.
 *
 * Append-only, idempotent by source key, and it never removes a source: a
 * registered guard that could be withdrawn at runtime would be a way to turn
 * the delete check off without changing any code.
 */
export class SocialContentPublicationGuard {
  private readonly sources: SocialContentPublicationSource[] = [];

  register(source: SocialContentPublicationSource): void {
    if (
      this.sources.some(
        (existing) =>
          existing.publicationSourceKey === source.publicationSourceKey,
      )
    ) {
      // A test harness that rebuilds the graph must not register twice.
      return;
    }

    this.sources.push(source);
  }

  get isAvailable(): boolean {
    return this.sources.length > 0;
  }

  /**
   * Asks every registered source and merges their answers.
   *
   * Returns `{ available: false }` when nothing is registered so the caller has
   * to decide explicitly what an unanswerable question means, rather than
   * receiving an empty map that looks exactly like "nothing blocks this".
   */
  async check(input: {
    scope: {
      tenantId: string;
      workspaceId: string;
      agencyClientId: string | null;
    };
    contentItemIds: string[];
  }): Promise<SocialContentPublicationCheck> {
    if (this.sources.length === 0) {
      return { available: false };
    }

    const blockers = new Map<string, SocialContentPublicationBlocker>();

    if (input.contentItemIds.length === 0) {
      return { available: true, blockers };
    }

    for (const source of this.sources) {
      const found = await source.findBlockingPublications(input);

      for (const blocker of found) {
        const existing = blockers.get(blocker.contentItemId);

        if (!existing) {
          blockers.set(blocker.contentItemId, {
            contentItemId: blocker.contentItemId,
            statuses: [...new Set(blocker.statuses)].sort(),
          });
          continue;
        }

        existing.statuses = [
          ...new Set([...existing.statuses, ...blocker.statuses]),
        ].sort();
      }
    }

    return { available: true, blockers };
  }
}
