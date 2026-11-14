/**
 * How a Google Ads API failure should be treated by the sync queue.
 *
 * Same four kinds as `MetaGraphError` on purpose, in a class of its own so the
 * Google reader never imports the Graph one (G2 §8). The queue only needs the
 * kind and a safe code.
 *
 * - `transient`    — nothing is wrong with us; try again later.
 * - `rate_limited` — quota. Back off for long; includes the local daily budget.
 * - `auth`         — the credential or the project cannot do this. A person acts.
 * - `permanent`    — the request is wrong. Retrying is pointless.
 *
 * `code` is the only thing that is ever logged, stored or returned. Provider
 * bodies are never attached: they echo customer ids and request fragments.
 */
export type GoogleAdsErrorKind =
  | 'transient'
  | 'rate_limited'
  | 'auth'
  | 'permanent';

export class GoogleAdsError extends Error {
  constructor(
    public readonly kind: GoogleAdsErrorKind,
    public readonly code: string,
    public readonly retryAfterMs: number | null = null,
  ) {
    super(code);
    this.name = 'GoogleAdsError';
  }
}
