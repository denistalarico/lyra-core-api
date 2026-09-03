import { Injectable } from '@nestjs/common';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type {
  NormalizedAdMetricDaily,
  NormalizedAdMetricPage,
  SocialAdInsightsLevel,
} from '../sync/meta-ads-insights.contract';
import { normalizeMetricRow } from '../sync/meta-ads-insights.normalizer';
import type { InsightsWindow } from '../sync/insights-window';
import { MetaAdsGraphService } from './meta-ads-graph.service';

/**
 * Fields requested from the Insights edge.
 *
 * Short on purpose, and short in a way the ad hierarchy's field list is not:
 * `ads_insights` is metered by CPU time on a shared business quota, so an
 * unnecessary column is not merely bytes — it is time this account's other
 * reads no longer have.
 *
 * Absent by design: `ctr`, `cpc`, `cpm`, `frequency`, `cost_per_action_type`.
 * Every one of them is a quotient of two columns already here, and asking Meta
 * to compute them would also mean storing them — where they become wrong the
 * moment two rows are summed, because a ratio of sums is not a sum of ratios.
 * They are derived on read, from summed numerators and denominators.
 *
 * Also absent: the video breakdown fields. `video_view` arrives inside
 * `actions`, which is already requested, so `video_views` costs nothing extra.
 */
const INSIGHTS_FIELDS =
  'date_start,date_stop,spend,impressions,reach,clicks,inline_link_clicks,' +
  'actions,action_values';

/** Campaign rows need the id they belong to; the name would be a stored lie. */
const CAMPAIGN_FIELDS = `${INSIGHTS_FIELDS},campaign_id`;

/**
 * Ad set rows carry both ids: their own, and the campaign they roll up into.
 *
 * `adset_name` and `campaign_name` are deliberately absent, here as everywhere
 * else in this module. A name is mutable on Meta's side and would be a copy
 * going stale from the moment it was stored; the mirror in `social_ad_entities`
 * is where a display name comes from, keyed on the id that does not change.
 */
const ADSET_FIELDS = `${INSIGHTS_FIELDS},adset_id,campaign_id`;

/** The field list each level needs, by that level. */
const FIELDS_BY_LEVEL: Record<SocialAdInsightsLevel, string> = {
  account: INSIGHTS_FIELDS,
  campaign: CAMPAIGN_FIELDS,
  adset: ADSET_FIELDS,
};

/**
 * Rows per page and pages per read.
 *
 * A daily row is small, so the page size is generous; the ceiling exists so a
 * looping response cannot hold a synchronous request open. 500 × 60 is 30 000
 * daily rows — at the backfill's 7-day chunk that is 4 200 delivering ad sets
 * in one week, and at a 90-day window still 333. Beyond that the answer is
 * Meta's async job API, not a bigger loop, and hitting the ceiling fails the
 * run rather than truncating it.
 *
 * Ad set is the level that will reach this first, and the arithmetic is why the
 * ceiling was left alone rather than raised in advance: Meta returns no row for
 * an object with no delivery on a day, so the count follows *active* ad sets,
 * not the mirror's total.
 */
const PAGE_SIZE = 500;
const MAX_PAGES = 60;

/**
 * Read-only reader for Meta Ads Insights.
 *
 * Like the hierarchy reader, it takes a `ResolvedAdCredential` and cannot tell
 * how the connection was authorized. It also never resolves one: the sync
 * service does that once, and a reader that could resolve its own credential
 * would be a second place where the internal System User path is reachable.
 */
@Injectable()
export class MetaAdsInsightsReaderService {
  constructor(private readonly graphService: MetaAdsGraphService) {}

  /**
   * Reads one level of a window as daily rows.
   *
   * The request is identical whether the window is closed or is today: Meta
   * answers for the days it was asked about, and an unfinished day comes back
   * as the numbers so far. Nothing here decides which it is — `isPartial`
   * arrives from the caller and is carried to the row unchanged, because the
   * only component that knows whether the day is still running is the one that
   * chose the window.
   *
   * Three request parameters carry the whole measurement contract:
   *
   * - `time_increment=1` is what makes a row a *day* rather than a total for
   *   the range. Without it Meta answers one aggregated row and the daily grain
   *   this table is built on would silently become a range total.
   * - `use_account_attribution_setting=true` measures with whatever window the
   *   account owner configured, which is what makes our numbers match the ones
   *   they see in Ads Manager. It is why every row is stored under
   *   `attribution_setting = 'account_default'` — a name for their setting, not
   *   a copy of it.
   * - `level` is explicit at every level, including `account`. Relying on the
   *   edge's default would make the account read depend on a value Meta could
   *   change without us noticing.
   *
   * One request per level per window, at every level. Ad set insights are read
   * from the *account's* `/insights` edge with `level=adset` — not by walking
   * ad sets — so adding the level costs one more paginated read, not one read
   * per ad set. A per-object loop over this account's 126 ad sets would be 126
   * requests against a CPU-metered business quota to learn what one request
   * already returns.
   */
  async read(input: {
    credential: ResolvedAdCredential;
    level: SocialAdInsightsLevel;
    window: InsightsWindow;
    /** True only for a window that is the account's own, unfinished day. */
    isPartial: boolean;
    syncedAt: Date;
  }): Promise<NormalizedAdMetricPage> {
    const { credential, level } = input;

    const page = await this.graphService.readEdge({
      accessToken: credential.accessToken,
      path: `${credential.externalAccountId}/insights`,
      fields: FIELDS_BY_LEVEL[level],
      limit: PAGE_SIZE,
      maxPages: MAX_PAGES,
      failureMessage: `Meta Ads ${level} insights read failed.`,
      params: {
        level,
        time_increment: '1',
        // Sent as Meta's own JSON object, and built here from an already
        // validated window — the two dates reached this point as `YYYY-MM-DD`
        // and nothing between the request and this line reinterpreted them.
        time_range: JSON.stringify({
          since: input.window.since,
          until: input.window.until,
        }),
        use_account_attribution_setting: 'true',
      },
    });

    const rows: NormalizedAdMetricDaily[] = [];
    let skipped = 0;

    for (const candidate of page.rows) {
      const normalized = normalizeMetricRow(candidate, {
        tenantId: credential.tenantId,
        workspaceId: credential.workspaceId,
        agencyClientId: credential.agencyClientId,
        connectionId: credential.connectionId,
        provider: credential.provider,
        source: 'paid',
        attributionSetting: 'account_default',
        entityLevel: level,
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
        // Counted rather than thrown. One unreadable row out of a 90-day window
        // is a provider oddity; failing the window over it would cost the other
        // eighty-nine days, and the count is what keeps it from being invisible.
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
