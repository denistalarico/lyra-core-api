/**
 * How a TikTok API for Business failure should be treated by the sync queue.
 *
 * Same four kinds as `GoogleAdsError`/`LinkedInAdsError`, in a class of its own
 * so the TikTok reader never imports another provider's error type.
 *
 * - `transient`    — nothing is wrong with us; try again later.
 * - `rate_limited` — quota. Back off for long.
 * - `auth`         — the token or the advertiser grant cannot do this. A person acts.
 * - `permanent`    — the request is wrong. Retrying is pointless.
 *
 * `code` is the only thing that is ever logged, stored or returned. TikTok's
 * `message` is never attached: it can echo advertiser ids and parameters.
 */
export type TikTokAdsErrorKind =
  | 'transient'
  | 'rate_limited'
  | 'auth'
  | 'permanent';

export class TikTokAdsError extends Error {
  constructor(
    public readonly kind: TikTokAdsErrorKind,
    public readonly code: string,
    public readonly retryAfterMs: number | null = null,
    /** Requests that reached TikTok before this failure (quota is spent). */
    public readonly apiCalls: number = 0,
  ) {
    super(code);
    this.name = 'TikTokAdsError';
  }
}
