import { Inject, Injectable, Optional } from '@nestjs/common';
import { linkedInCmaBudgetEnabled } from './linkedin-organic-oauth.support';

/** Community Management API, Development tier: 500 calls/app/24 h (§5.1). */
export const LINKEDIN_CMA_DAILY_CALL_LIMIT = 500;
/** Optional override (specs). Without the token Nest would try to inject `limit`. */
export const LINKEDIN_CALL_LIMIT = Symbol('LINKEDIN_CALL_LIMIT');

/**
 * Per-process daily counter of Community Management API calls (molde: the
 * YouTube upload quota). Active while `SOCIAL_LINKEDIN_CMA_TIER` is not
 * `standard`. The day is UTC (the portal does not document the reset hour).
 * A restart or a second API process keeps its own count, so a provider 429
 * is still mapped to `rate_limited`. The 100 calls/member/24 h limit is not
 * tracked here.
 */
@Injectable()
export class LinkedInCallBudget {
  private day = '';
  private used = 0;

  private readonly limit: number;

  constructor(@Optional() @Inject(LINKEDIN_CALL_LIMIT) limit?: number) {
    this.limit = limit ?? LINKEDIN_CMA_DAILY_CALL_LIMIT;
  }

  /** True (and counted) when a call may be made; false when today is spent. */
  tryConsume(now: Date = new Date()): boolean {
    if (!linkedInCmaBudgetEnabled()) return true;
    const day = now.toISOString().slice(0, 10);
    if (day !== this.day) {
      this.day = day;
      this.used = 0;
    }
    if (this.used >= this.limit) return false;
    this.used += 1;
    return true;
  }
}
