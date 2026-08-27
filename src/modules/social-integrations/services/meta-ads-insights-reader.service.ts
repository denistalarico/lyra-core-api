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
 * Rows per page and pages per read.
 *
 * A daily row is small, so the page size is generous; the ceiling exists so a
 * looping response cannot hold a synchronous request open. 500 × 60 is 30 000
 * daily rows — a 90-day campaign-level read of an account with 300 active
 * campaigns. Beyond that the answer is Meta's async job API, not a bigger loop,
 * and hitting the ceiling fails the run rather than truncating it.
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
   * Reads one level of a closed window as daily rows.
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
   * - `level` is explicit at both levels, including `account`. Relying on the
   *   edge's default would make the account read depend on a value Meta could
   *   change without us noticing.
   */
  async read(input: {
    credential: ResolvedAdCredential;
    level: SocialAdInsightsLevel;
    window: InsightsWindow;
    syncedAt: Date;
  }): Promise<NormalizedAdMetricPage> {
    const { credential, level } = input;

    const page = await this.graphService.readEdge({
      accessToken: credential.accessToken,
      path: `${credential.externalAccountId}/insights`,
      fields: level === 'campaign' ? CAMPAIGN_FIELDS : INSIGHTS_FIELDS,
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
