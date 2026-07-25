/**
 * The decision at the heart of lead distribution: given the eligible assignees
 * and the configured rule, who gets the new opportunity.
 *
 * Kept as a pure function on purpose. Choosing an assignee must be reproducible
 * and testable without a database: the command service gathers the inputs (the
 * eligible pool, current loads, the rotation cursor) and this decides. Nothing
 * here writes, reads, or has an opinion about whether the opportunity may be
 * assigned at all — that gate lives in the command that owns the deal.
 */

export type LeadDistributionStrategy =
  /** Fewest open opportunities in the pipeline wins. Balances load. */
  | 'least_volume'
  /** Rotate through the pool in order, resuming after the last assigned. */
  | 'round_robin'
  /** Route by the opportunity's source channel, falling back when unmapped. */
  | 'by_channel';

export interface LeadDistributionInput {
  strategy: LeadDistributionStrategy;
  /**
   * Eligible assignees in a stable order (pipeline participants and owner). The
   * order is meaningful: it is the tie-break for `least_volume` and the ring for
   * `round_robin`, so the caller must pass it deterministically.
   */
  eligible: string[];
  /** Open-opportunity count per user, for `least_volume`. Missing means zero. */
  loads?: Record<string, number>;
  /** The last user assigned in this pipeline, for `round_robin` rotation. */
  cursorUserId?: string | null;
  /** Source-channel → user, for `by_channel`. */
  channelMap?: Record<string, string>;
  /** The opportunity's source/channel, for `by_channel`. */
  source?: string | null;
  /** Preferred assignee when a strategy cannot resolve one; must be eligible. */
  fallbackUserId?: string | null;
}

export interface LeadDistributionChoice {
  userId: string;
  /** Why this user was chosen: the strategy that resolved it, or `fallback`. */
  reasonCode: LeadDistributionStrategy | 'fallback';
}

/**
 * Chooses the assignee, or `null` when the eligible pool is empty — the one
 * case a rule cannot paper over, and the caller must treat as "no one to assign
 * to" rather than inventing a target.
 */
export function chooseAssignee(
  input: LeadDistributionInput,
): LeadDistributionChoice | null {
  // De-duplicate while keeping order and dropping empties: the pool comes from
  // two sources (participants and owner) that may overlap.
  const eligible = input.eligible.filter(
    (id, index) => Boolean(id) && input.eligible.indexOf(id) === index,
  );
  if (eligible.length === 0) return null;

  if (input.strategy === 'least_volume') {
    return { userId: leastLoaded(eligible, input.loads ?? {}), reasonCode: 'least_volume' };
  }

  if (input.strategy === 'round_robin') {
    return {
      userId: nextInRotation(eligible, input.cursorUserId ?? null),
      reasonCode: 'round_robin',
    };
  }

  // by_channel
  const mapped = input.source ? input.channelMap?.[input.source] : undefined;
  if (mapped && eligible.includes(mapped)) {
    return { userId: mapped, reasonCode: 'by_channel' };
  }
  return {
    userId: resolveFallback(eligible, input.fallbackUserId ?? null),
    reasonCode: 'fallback',
  };
}

/** Fewest open opportunities; ties resolved by the pool's given order. */
function leastLoaded(eligible: string[], loads: Record<string, number>): string {
  let best = eligible[0];
  let bestLoad = loads[best] ?? 0;
  for (const id of eligible.slice(1)) {
    const load = loads[id] ?? 0;
    if (load < bestLoad) {
      best = id;
      bestLoad = load;
    }
  }
  return best;
}

/** Next after the cursor, wrapping; an absent or unknown cursor starts over. */
function nextInRotation(eligible: string[], cursor: string | null): string {
  if (!cursor) return eligible[0];
  const index = eligible.indexOf(cursor);
  if (index === -1) return eligible[0];
  return eligible[(index + 1) % eligible.length];
}

/** The configured fallback when it is eligible, otherwise the first in the pool. */
function resolveFallback(eligible: string[], fallback: string | null): string {
  if (fallback && eligible.includes(fallback)) return fallback;
  return eligible[0];
}
