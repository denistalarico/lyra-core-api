/**
 * How a LinkedIn Marketing API failure should be treated by the sync queue.
 *
 * Same four kinds as `GoogleAdsError`/`MetaGraphError`, in a class of its own so
 * the LinkedIn reader never imports another provider's error type. The queue
 * only needs the kind and a safe code.
 *
 * - `transient`    — nothing is wrong with us; try again later.
 * - `rate_limited` — quota (429). Back off for long.
 * - `auth`         — the token or the member's role cannot do this. A person acts.
 * - `permanent`    — the request is wrong. Retrying is pointless.
 *
 * `code` is the only thing that is ever logged, stored or returned. Provider
 * bodies are never attached: they echo URNs and request fragments.
 */
export type LinkedInAdsErrorKind =
  | 'transient'
  | 'rate_limited'
  | 'auth'
  | 'permanent';

export class LinkedInAdsError extends Error {
  constructor(
    public readonly kind: LinkedInAdsErrorKind,
    public readonly code: string,
    public readonly retryAfterMs: number | null = null,
    /** Requests that reached LinkedIn before this failure (quota is spent). */
    public readonly apiCalls: number = 0,
  ) {
    super(code);
    this.name = 'LinkedInAdsError';
  }
}
