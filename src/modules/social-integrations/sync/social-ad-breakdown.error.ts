import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';
import type { SocialAdInsightsLevel } from './meta-ads-insights.contract';

/**
 * The provider had more breakdown rows than one read may walk.
 *
 * A sibling of `SocialAdInsightsTruncatedError`, and fatal for a sharper reason
 * than that one. A truncated unsplit window is a date range missing some of its
 * days; a truncated breakdown is a *distribution* missing some of its buckets,
 * and there is nothing on the remaining rows that could say so. A pie chart
 * drawn from a prefix looks exactly like a pie chart drawn from the whole, and
 * its slices still add to 100%.
 *
 * It carries the level and the dimension so the caller learns which read to
 * narrow. The repair is a smaller window, which is why this becomes a 409
 * rather than a provider error.
 */
export class SocialAdBreakdownTruncatedError extends Error {
  constructor(
    readonly level: SocialAdInsightsLevel,
    readonly kind: SocialAdBreakdownKind,
  ) {
    super(
      `Meta Ads ${level} ${kind} breakdown returned more rows than one read allows.`,
    );
    this.name = 'SocialAdBreakdownTruncatedError';
  }
}

/**
 * Breakdown ingestion is switched off for this deployment.
 *
 * Distinct from a failure: nothing went wrong, the capability is simply not
 * enabled. It exists as an error rather than a silent no-op so that a manual
 * request gets a stated reason instead of a summary reporting zero rows
 * written, which is indistinguishable from an account with no delivery.
 */
export class SocialAdBreakdownDisabledError extends Error {
  constructor() {
    super('Meta Ads breakdown ingestion is disabled for this deployment.');
    this.name = 'SocialAdBreakdownDisabledError';
  }
}
