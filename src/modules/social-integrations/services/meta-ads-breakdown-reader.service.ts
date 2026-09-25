import { Injectable } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';
import {
  BREAKDOWN_PARAMS,
  type NormalizedAdBreakdownDaily,
  type NormalizedAdBreakdownPage,
} from '../sync/meta-ads-breakdown.contract';
import { normalizeBreakdownRow } from '../sync/meta-ads-breakdown.normalizer';
import type { SocialAdInsightsLevel } from '../sync/meta-ads-insights.contract';
import type { InsightsWindow } from '../sync/insights-window';
import { MetaAdsGraphService } from './meta-ads-graph.service';

/**
 * Fields requested from the Insights edge for a breakdown pass.
 *
 * Shorter than the unsplit read's list, and shorter on purpose. `ads_insights`
 * is metered by CPU time on a shared business quota, and a breakdown multiplies
 * the row count by the size of the dimension — eight age/gender cells turn a
 * 90-day account window into 720 rows. Every column is paid for that many times.
 *
 * Absent by design, beyond the ratios the unsplit read already refuses:
 * `action_values`. Revenue split by device or age is not a question this
 * dashboard asks, and it is the heaviest field on the edge. `actions` stays,
 * because "results by age group" is asked, and it is where every result count
 * lives.
 */
const BREAKDOWN_FIELDS =
  'date_start,date_stop,spend,impressions,reach,clicks,inline_link_clicks,actions';

const CAMPAIGN_FIELDS = `${BREAKDOWN_FIELDS},campaign_id`;
const ADSET_FIELDS = `${BREAKDOWN_FIELDS},adset_id,campaign_id`;

const FIELDS_BY_LEVEL: Record<SocialAdInsightsLevel, string> = {
  account: BREAKDOWN_FIELDS,
  campaign: CAMPAIGN_FIELDS,
  adset: ADSET_FIELDS,
};

/**
 * Rows per page and pages per read.
 *
 * The same page size as the unsplit reader, and a higher page ceiling for the
 * reason above: a breakdown returns one row per object per day *per bucket*, so
 * the same window that fits comfortably in 60 pages unsplit needs more once it
 * is multiplied by a dimension. 500 × 120 is 60 000 rows — a 90-day account
 * window at every age/gender cell is 720, so the ceiling is generous at account
 * level and is really sized for a campaign-level pass.
 *
 * Hitting it still fails the pass rather than truncating it. A distribution
 * missing buckets is not a smaller distribution, it is a wrong one.
 */
const PAGE_SIZE = 500;
const MAX_PAGES = 120;

/**
 * Read-only reader for Meta Ads Insights with a `breakdowns` parameter.
 *
 * A sibling of `MetaAdsInsightsReaderService` rather than a mode on it. The two
 * differ in what they may ask for (no `action_values` here), what they store
 * (no promoted action columns), what identity a row has (no parent campaign),
 * and what a failed key means — and a single class with a nullable `breakdown`
 * argument would be one where each of those four rules is a branch somebody has
 * to remember to take.
 *
 * Like its sibling it takes a `ResolvedAdCredential` and never resolves one:
 * the sync service does that once, and a reader that could resolve its own
 * credential would be a second door into the internal System User path.
 */
@Injectable()
export class MetaAdsBreakdownReaderService {
  constructor(private readonly graphService: MetaAdsGraphService) {}

  /**
   * Reads one dimension of one level of a window as daily rows.
   *
   * The request carries the same measurement contract as the unsplit read —
   * `time_increment=1` for a daily grain, `use_account_attribution_setting=true`
   * so the numbers match the account owner's Ads Manager, an explicit `level` —
   * plus the one parameter that defines this pass:
   *
   * - `breakdowns` names the dimension. **One dimension per request**: the
   *   Marketing API rejects `age,gender` combined with `device_platform` or
   *   `publisher_platform`, so four dimensions are four requests and there is
   *   no cheaper shape available. `age,gender` is itself one request returning
   *   the cross of the two, which is what a grouped bar chart needs — two
   *   separate marginal distributions could not be recombined into it.
   *
   * ## The hourly dimension measures against a second clock
   *
   * Every other row this reader produces is cut entirely in the ad account's
   * timezone: `time_increment=1` gives days in that zone, and `metric_date`
   * stores them unconverted. An hourly row's *date* is still that day — but its
   * *daypart* is the hour in the **viewer's** timezone, because
   * `hourly_stats_aggregated_by_audience_time_zone` is the only hourly option
   * this edge offers.
   *
   * That is the right measurement for the question being asked — "when are the
   * people I am paying for actually awake" is about their clock, not the
   * agency's — but it means the 24 dayparts of one row's day do not partition
   * that day for an account whose audience spans zones. Impressions still sum
   * to the day's total (measured: 9 038 both ways over this account's 90 days,
   * exactly), because each impression is counted once under whatever hour its
   * viewer saw it. What does not hold is the boundary: an impression near
   * midnight can sit in a daypart belonging to the neighbouring calendar day.
   *
   * Nothing here corrects for that, and nothing should — the correction would
   * require a per-impression timezone Meta does not report. It is stated on the
   * chart instead.
   */
  async read(input: {
    credential: ResolvedAdCredential;
    level: SocialAdInsightsLevel;
    kind: SocialAdBreakdownKind;
    window: InsightsWindow;
    /** True only for a window that is the account's own, unfinished day. */
    isPartial: boolean;
    syncedAt: Date;
  }): Promise<NormalizedAdBreakdownPage> {
    const { credential, level, kind } = input;

    const page = await this.graphService.readEdge({
      accessToken: credential.accessToken,
      path: `${credential.externalAccountId}/insights`,
      fields: FIELDS_BY_LEVEL[level],
      limit: PAGE_SIZE,
      maxPages: MAX_PAGES,
      failureMessage: `Meta Ads ${level} ${kind} breakdown read failed.`,
      params: {
        level,
        breakdowns: BREAKDOWN_PARAMS[kind],
        time_increment: '1',
        time_range: JSON.stringify({
          since: input.window.since,
          until: input.window.until,
        }),
        use_account_attribution_setting: 'true',
      },
    });

    const rows: NormalizedAdBreakdownDaily[] = [];
    let skipped = 0;

    for (const candidate of page.rows) {
      const normalized = normalizeBreakdownRow(candidate, {
        tenantId: credential.tenantId,
        workspaceId: credential.workspaceId,
        agencyClientId: credential.agencyClientId,
        connectionId: credential.connectionId,
        provider: credential.provider,
        entityLevel: level,
        breakdownKind: kind,
        accountExternalId: credential.externalAccountId,
        // The connection's stored timezone, which the resolver already refused
        // to default: a day boundary guessed as UTC moves an evening's spend to
        // the following date, permanently and only near midnight.
        accountTimezone: credential.timezone,
        currency: credential.currency,
        isPartial: input.isPartial,
        syncedAt: input.syncedAt,
      });

      if (normalized) {
        rows.push(normalized);
      } else {
        // Counted rather than thrown, like the unsplit read. One unreadable row
        // is a provider oddity; failing the window over it would cost every
        // other bucket, and the count is what keeps it from being invisible.
        skipped += 1;
      }
    }

    return {
      rows,
      truncated: page.truncated,
      skipped,
      apiCalls: page.apiCalls,
    };
  }
}
