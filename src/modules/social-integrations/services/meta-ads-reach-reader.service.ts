import { Injectable } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { parseCountText } from '../sync/metric-number';
import type { SocialAdReachPeriodWindow } from '../sync/social-ad-reach-period.contract';
import { MetaAdsGraphService } from './meta-ads-graph.service';

/**
 * The one field this read asks for.
 *
 * Not `spend`, not `impressions`, not `actions` — every one of those is already
 * in `social_ad_metrics_daily` at a grain that sums correctly, and asking for
 * them here would pay CPU quota to learn something stored. Reach is the only
 * metric a period-level request answers that a daily one cannot.
 */
const REACH_FIELDS = 'reach';

/**
 * A period read returns one row, so the pager has nothing to walk.
 *
 * `limit: 1` and `maxPages: 1` say that out loud. A `truncated` page here would
 * mean Meta offered a second page for a request with no `time_increment` and no
 * breakdown — which is not a shape it produces, and if it ever did, the extra
 * rows would not be additional days of the same measurement but a different
 * answer entirely. The caller refuses in that case rather than taking the first
 * row and hoping.
 */
const PAGE_SIZE = 1;
const MAX_PAGES = 1;

/** What one Graph measurement produced, before it is given a scope. */
export type MetaAdsReachMeasurement = {
  /** A digit string, or null when Meta reported no reach for the range. */
  reach: string | null;
  /** Graph requests this measurement actually cost. Always 1 in practice. */
  apiCalls: number;
  /** Meta offered more rows than a period read should ever have. */
  truncated: boolean;
};

/**
 * Reads the de-duplicated reach of one calendar range from Meta.
 *
 * ## The one parameter that defines this service: no `time_increment`
 *
 * `MetaAdsInsightsReaderService` sends `time_increment=1`, which makes Meta
 * return one row per day — and inside each of those rows, reach is de-duplicated
 * over that day only. No arithmetic over those rows recovers the range's reach,
 * because the information about who appeared on more than one day never left
 * Meta.
 *
 * Omitting `time_increment` asks the same edge, with the same token, for the
 * same range, and gets **one** row whose reach Meta de-duplicated across the
 * whole interval. That is the entire mechanism: the number is computed where the
 * identities are, and this service's only job is to ask for it and store the
 * answer.
 *
 * A sibling of the insights reader rather than a flag on it. The two differ in
 * what they ask for, how many rows they expect, what a second page means, and
 * what table the answer lands in — and a single class with a nullable
 * `timeIncrement` argument would be one where the mistake is a single omitted
 * parameter that silently turns a period measurement back into a daily one.
 *
 * Like its sibling it takes a `ResolvedAdCredential` and never resolves one:
 * a reader that could resolve its own credential would be a second door into
 * the internal System User path.
 */
@Injectable()
export class MetaAdsReachReaderService {
  constructor(private readonly graphService: MetaAdsGraphService) {}

  /**
   * One range, one request, one number.
   *
   * `use_account_attribution_setting=true` for the same reason every other read
   * in this module sends it: the figure has to be the one the account owner sees
   * in Ads Manager, or the dashboard loses the only comparison a client will
   * actually make.
   *
   * `level=account` is sent explicitly even though the path is the account's own
   * insights edge, because the edge's default level is a provider decision and
   * this measurement's grain is part of its identity in the cache.
   */
  async measure(input: {
    credential: ResolvedAdCredential;
    window: SocialAdReachPeriodWindow;
  }): Promise<MetaAdsReachMeasurement> {
    const { credential, window } = input;

    const page = await this.graphService.readEdge({
      accessToken: credential.accessToken,
      path: `${credential.externalAccountId}/insights`,
      fields: REACH_FIELDS,
      limit: PAGE_SIZE,
      maxPages: MAX_PAGES,
      failureMessage: 'Meta Ads period reach read failed.',
      params: {
        level: 'account',
        // No `time_increment`. See the class comment — this omission is the
        // whole point of the service, and adding it would return daily rows
        // whose reach cannot be combined into the period's.
        time_range: JSON.stringify({
          since: window.since,
          until: window.until,
        }),
        use_account_attribution_setting: 'true',
      },
    });

    return {
      // The first row and only the first: a period read has exactly one, and
      // `truncated` above is what reports the case where Meta disagreed.
      reach: readReach(page.rows[0]),
      apiCalls: page.apiCalls,
      truncated: page.truncated,
    };
  }
}

/**
 * The `reach` of one Graph row, or null.
 *
 * Null for every shape that is not a readable count: a missing field, a
 * malformed one, an empty array of rows. Never zero — Meta omits `reach` for
 * ranges it has nothing to report on, and an account that genuinely reached
 * nobody sends `"0"`. Coercing the first into the second would turn a missing
 * measurement into a confident claim, which is the one thing this whole slice
 * exists to avoid.
 */
function readReach(row: unknown): string | null {
  if (typeof row !== 'object' || row === null) return null;

  return parseCountText((row as { reach?: unknown }).reach);
}
