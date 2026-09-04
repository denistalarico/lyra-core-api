import type { CanonicalPaidMediaDestination } from '../sync/paid-media-destination';

/**
 * What the destination evidence says about one ad set at one instant.
 *
 * The point-in-time counterpart to I3.2a's interval timeline. That one answers
 * "what did each day of this window look like across the whole connection",
 * which is a reporting question and is cut into the ad account's calendar days.
 * This answers "what had we last seen for this ad set when this specific
 * message arrived", which is an individual question and must not be truncated
 * to a day at all — a conversation that began at 09:00 and an ad set observed
 * at 21:00 the same day are the same calendar day and the wrong answer.
 */
export type SocialAdDestinationAtResolution =
  /** An observation exists at or before the instant asked about. */
  | 'observed_destination'
  /**
   * Evidence for this ad set begins *after* the instant asked about.
   *
   * Not an error and not a missing ad: the observation table starts when the
   * destination observer was deployed, so every message that arrived before
   * that is legitimately unresolvable. Retro-projecting the earliest known
   * destination backwards would be exactly the current-state-as-history error
   * the observations table exists to remove.
   */
  | 'unavailable_before_first_observation';

/** One ad set's destination as of one instant. */
export type SocialAdDestinationAt = {
  value: CanonicalPaidMediaDestination;
  resolution: SocialAdDestinationAtResolution;
  /**
   * When the winning observation was made — never when the destination
   * changed. Null when nothing was resolved.
   */
  observedAt: string | null;
  /**
   * The provider's own string, preserved.
   *
   * This is what separates I4.1 §7's two causes of `unknown`. A row with
   * `raw: 'UNDEFINED'` means Meta was asked and answered "no destination
   * configured"; a null raw under `unavailable_before_first_observation` means
   * nobody had looked yet. Both render as `unknown`, and only this field says
   * which.
   */
  raw: string | null;
};

export const DESTINATION_AT_PROVENANCE =
  'social_ad_destination_observations' as const;

/**
 * The answer when no observation precedes the instant.
 *
 * A shared constant rather than an object literal at each call site: the three
 * fields have to agree — `unknown` with a null instant and a null raw — and
 * two hand-written copies is how one of them ends up claiming an `observedAt`
 * for an observation that was never used.
 */
export const DESTINATION_UNAVAILABLE: SocialAdDestinationAt = {
  value: 'unknown',
  resolution: 'unavailable_before_first_observation',
  observedAt: null,
  raw: null,
};
