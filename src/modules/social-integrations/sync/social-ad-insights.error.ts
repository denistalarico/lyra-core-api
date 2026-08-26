import type { SocialAdInsightsLevel } from './meta-ads-insights.contract';

/**
 * The provider had more rows than one read may walk.
 *
 * A separate failure from anything Meta reports, because Meta reported nothing
 * wrong: the response was a valid prefix of the answer, and only this client
 * knows it stopped early. Treating it as success is the dangerous option — the
 * days past the ceiling would simply be missing from the window, and a missing
 * day is indistinguishable from a day with no spend.
 *
 * It carries the level so the caller learns which read to narrow, and nothing
 * else. The repair is a smaller window, which is why this becomes a 409 rather
 * than a provider error.
 */
export class SocialAdInsightsTruncatedError extends Error {
  constructor(readonly level: SocialAdInsightsLevel) {
    super(
      `Meta Ads ${level} insights returned more rows than one read allows.`,
    );
    this.name = 'SocialAdInsightsTruncatedError';
  }
}

/**
 * The requested window reaches into a day the ad account has not finished.
 *
 * Refused rather than trimmed. Silently shortening `until` would answer a
 * different question than the one asked, and the caller would have no way to
 * tell that the last day of their report is missing — which is the same failure
 * as storing the open day, arriving from the other direction.
 *
 * It carries the latest settled day and the zone that decided it, because that
 * is what makes the refusal actionable: a caller in São Paulo asking about an
 * Auckland account has no way to guess that boundary otherwise.
 */
export class SocialAdInsightsWindowNotClosedError extends Error {
  constructor(
    readonly maxUntil: string,
    readonly timezone: string,
  ) {
    super(`The ad account has not finished any day after ${maxUntil}.`);
    this.name = 'SocialAdInsightsWindowNotClosedError';
  }
}
