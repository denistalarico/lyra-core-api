import { Injectable } from '@nestjs/common';
import {
  PAID_MEDIA_RATIOS,
  countWindowDays,
  type IntelligenceDimensions,
  type IntelligenceDomain,
  type IntelligenceFact,
  type IntelligenceFactQuery,
  type IntelligenceFactSet,
  type IntelligenceFactSource,
  type IntelligenceFreshness,
  type IntelligenceGrain,
  type IntelligenceProvenance,
  type IntelligenceRatioDescriptor,
} from '../../../common/intelligence';
import { SocialAnalyticsReadService } from '../services/social-analytics-read.service';
import type { SocialAdAnalyticsTotals } from '../views/social-ad-analytics-overview.view';
import type { SocialAdSeriesPoint } from '../views/social-ad-analytics-series.view';
import { PAID_MEDIA_METRICS } from './social-paid-media-metrics';

/**
 * Paid media, as facts.
 *
 * Named for what it measures rather than for Meta, because the provider is a
 * dimension here and not an identity. When Google Ads is ingested into the same
 * read model, this adapter serves it too — the only thing that changes is the
 * `provider` dimension's value. A `MetaAdsIntelligenceAdapter` would have had to
 * be joined by a second, near-identical class whose facts a consumer would then
 * have to merge.
 *
 * ## Why it delegates rather than queries
 *
 * Every number comes through `SocialAnalyticsReadService`, and the adapter
 * issues no SQL of its own. That is deliberate and it is the most important
 * decision in this file. Four rules decide whether these numbers are right:
 *
 * - `entity_level = 'account'`, without which account and campaign rows are
 *   summed together and every figure doubles;
 * - `source = 'paid'`;
 * - `attribution_setting = 'account_default'`, without which two measurements of
 *   the same delivery under different attribution windows are added;
 * - reach is never summed.
 *
 * A second implementation of those four would work on the day it was written and
 * drift on some later day, in a slice of code nobody was editing — and the
 * failure would be a plausible-looking number, not an error. So there is one
 * implementation, and this adapter is a translation of its output into the
 * shared shape.
 *
 * ## What it cannot reach
 *
 * No Graph service, no credential resolver, no token — asserted by
 * `social-paid-media-intelligence.boundary.spec`. It inherits that property from
 * the read service, which was built under the same rule, and inherits the
 * consequence too: a disconnected account's stored history stays readable,
 * because it is still true and still the client's.
 */
@Injectable()
export class SocialPaidMediaIntelligenceAdapter implements IntelligenceFactSource {
  readonly domain: IntelligenceDomain = 'paid_media';

  readonly supportedGrains: readonly IntelligenceGrain[] = ['day', 'period'];

  readonly ratios: readonly IntelligenceRatioDescriptor[] = PAID_MEDIA_RATIOS;

  constructor(private readonly reads: SocialAnalyticsReadService) {}

  async fetch(query: IntelligenceFactQuery): Promise<IntelligenceFactSet> {
    const connectionId = query.subjectId;

    if (!connectionId) {
      // Not an empty fact set: paid media has one subject per ad account and
      // several may be in scope, so "which one?" has no default. An empty answer
      // would read as "this account had no delivery".
      throw new Error(
        'SocialPaidMediaIntelligenceAdapter requires a subjectId (connection id).',
      );
    }

    if (!this.supportedGrains.includes(query.grain)) {
      throw new Error(`Unsupported grain: ${query.grain}.`);
    }

    // Scope travels into the read service unchanged, and it resolves the
    // connection under all three identifiers. A connection belonging to another
    // tenant, workspace or managed client is "not found" — the same answer as an
    // id that never existed, so the port cannot be used to discover which
    // clients run ads.
    const scope = {
      tenantId: query.scope.tenantId,
      workspaceId: query.scope.workspaceId,
      agencyClientId: query.scope.agencyClientId,
    };

    const freshness = await this.reads.freshness({ ...scope, connectionId });

    const { facts, currency } =
      query.grain === 'day'
        ? await this.dayFacts(scope, connectionId, query)
        : await this.periodFacts(scope, connectionId, query);

    return {
      domain: this.domain,
      subject: { type: 'ad_account', id: connectionId },
      grain: query.grain,
      window: { since: query.window.since, until: query.window.until },
      currency,
      // Always null here, and that is the contract rather than a gap: business
      // mode is LeadFlow configuration, and a tenant using Social standalone has
      // none. Reading one would make ad spend unreadable without a second
      // product installed.
      businessMode: null,
      descriptors: [...PAID_MEDIA_METRICS],
      facts,
      provenance: this.provenance(freshness.metrics.latestMetricsSyncedAt),
      freshness: this.freshness(query, freshness),
    };
  }

  /**
   * One fact per metric per day, for every day in the window.
   *
   * `timeseries` returns a continuous series — a day the read model never
   * observed comes back with `hasData: false` and nulls rather than zeros — and
   * that distinction is carried through rather than flattened. A day with no
   * delivery reports `"0"`; a day that was never synced reports `null`. Emitting
   * zeros for both would state the stronger of the two as fact.
   *
   * Reach *is* emitted at this grain, and it is the only grain where it may be:
   * one day is the grain Meta de-duplicated it at, so the stored figure is the
   * true one.
   */
  private async dayFacts(
    scope: {
      tenantId: string;
      workspaceId: string;
      agencyClientId: string | null;
    },
    connectionId: string,
    query: IntelligenceFactQuery,
  ): Promise<{ facts: IntelligenceFact[]; currency: string | null }> {
    const series = await this.reads.timeseries({
      ...scope,
      connectionId,
      since: query.window.since,
      until: query.window.until,
    });

    const facts: IntelligenceFact[] = [];

    for (const point of series.points) {
      const dimensions = this.dimensions({ date: point.date });

      for (const metric of PAID_MEDIA_METRICS) {
        facts.push({
          metricKey: metric.key,
          value: readSeriesValue(point, metric.key),
          dimensions,
        });
      }
    }

    return { facts, currency: series.currency };
  }

  /**
   * One fact per metric for the whole window.
   *
   * `overview` also computes the previous period and its deltas; neither is
   * emitted. A change is a comparison of two fact sets, and producing it here
   * would put a second, undeclared window inside a fact set that names one — a
   * consumer aggregating these facts would silently include a period it never
   * asked for.
   *
   * Reach arrives from `overview` already refused for any multi-day window: the
   * read service returns it only when exactly one day contributed. The null that
   * comes back for a 30-day window is the honest answer, and it matches this
   * metric's `non_additive` descriptor rather than contradicting it.
   */
  private async periodFacts(
    scope: {
      tenantId: string;
      workspaceId: string;
      agencyClientId: string | null;
    },
    connectionId: string,
    query: IntelligenceFactQuery,
  ): Promise<{ facts: IntelligenceFact[]; currency: string | null }> {
    const overview = await this.reads.overview({
      ...scope,
      connectionId,
      since: query.window.since,
      until: query.window.until,
    });

    const dimensions = this.dimensions({});
    const facts = PAID_MEDIA_METRICS.map((metric) => ({
      metricKey: metric.key,
      value: readTotalsValue(overview.current, metric.key),
      dimensions,
    }));

    return { facts, currency: overview.currency };
  }

  /**
   * The dimensions every paid-media fact carries.
   *
   * Three constants and, at day grain, the date. They are constants because the
   * read service pins them — `source = 'paid'` and
   * `attribution_setting = 'account_default'` are the filters that make the
   * numbers correct — so stating them here is reporting what was queried, not
   * re-deciding it. A consumer that later merges two fact sets can see that both
   * were measured the same way instead of assuming it.
   *
   * `provider` is `meta` because that is the only provider S2 ingests. It is a
   * dimension precisely so a second provider does not fork the metric keys.
   *
   * Notably absent: tenant, workspace and client. Those are the scope, and a
   * second copy of the client id is a second thing that can disagree with the
   * first.
   */
  private dimensions(extra: { date?: string }): IntelligenceDimensions {
    const dimensions: IntelligenceDimensions = {
      provider: 'meta',
      source: 'paid',
      attribution: 'account_default',
    };

    if (extra.date) dimensions.date = extra.date;

    return dimensions;
  }

  private provenance(syncedAt: string | null): IntelligenceProvenance {
    return {
      canonicalSource: 'social_ad_metrics_daily',
      attributionBasis: 'account_default',
      ingestionMode: 'synced',
      notes: {
        entityLevel: 'account',
        // A pointer rather than a copy. Listing sync run ids for a ninety-day
        // window would mean dozens of uuids plus every intraday convergence,
        // outweighing the facts themselves — for identifiers a consumer cannot
        // act on. The endpoint that already reports run-level detail is named
        // instead.
        runDetail: 'GET /social/analytics/freshness',
        latestSyncedAt: syncedAt ?? 'never',
      },
    };
  }

  /**
   * Freshness and coverage, from the sync's own evidence.
   *
   * `coveredDays` counts days up to `latestMetricDate` — how far the sync has
   * progressed — and not days that have rows. The difference matters for exactly
   * the case that would otherwise be misreported: an ad account that delivered
   * nothing on a Sunday has no Meta row for Sunday, and a row-counting coverage
   * would report that day as missing, indistinguishable from a sync that never
   * ran. This is the same evidence `GET /social/analytics/freshness` already
   * publishes, read through the same service.
   */
  private freshness(
    query: IntelligenceFactQuery,
    freshness: Awaited<ReturnType<SocialAnalyticsReadService['freshness']>>,
  ): IntelligenceFreshness {
    const expectedDays = countWindowDays(query.window);
    const latest = freshness.metrics.latestMetricDate;

    return {
      asOf: freshness.metrics.latestMetricsSyncedAt,
      // Scoped to the requested window: a partial day outside it says nothing
      // about these facts.
      isPartial: isWithin(freshness.metrics.latestPartialMetricDate, query),
      mode: 'synced',
      coverage: {
        expectedDays,
        coveredDays: coveredDays(latest, query, expectedDays),
        basis: 'sync_progress',
      },
    };
  }
}

/** Days of the window the sync has reached, capped at the window itself. */
function coveredDays(
  latestMetricDate: string | null,
  query: IntelligenceFactQuery,
  expectedDays: number,
): number {
  if (!latestMetricDate) return 0;
  if (latestMetricDate < query.window.since) return 0;

  const bound =
    latestMetricDate > query.window.until
      ? query.window.until
      : latestMetricDate;

  return Math.min(
    expectedDays,
    countWindowDays({ since: query.window.since, until: bound }),
  );
}

function isWithin(day: string | null, query: IntelligenceFactQuery): boolean {
  return day !== null && day >= query.window.since && day <= query.window.until;
}

/**
 * The series field a metric key maps to.
 *
 * A closed map rather than a dynamic lookup: the view's field names are
 * camelCase and the metric keys are snake_case, and a naive conversion would
 * work for eight of the nine and silently return `undefined` — read downstream
 * as `null`, "not measurable" — for whichever one drifted.
 */
const SERIES_FIELDS: Record<string, keyof SocialAdSeriesPoint> = {
  spend: 'spend',
  impressions: 'impressions',
  reach: 'reach',
  clicks: 'clicks',
  link_clicks: 'linkClicks',
  leads: 'leads',
  conversions: 'conversions',
  conversion_value: 'conversionValue',
  video_views: 'videoViews',
};

const TOTALS_FIELDS: Record<string, keyof SocialAdAnalyticsTotals> = {
  spend: 'spend',
  impressions: 'impressions',
  reach: 'reach',
  clicks: 'clicks',
  link_clicks: 'linkClicks',
  leads: 'leads',
  conversions: 'conversions',
  conversion_value: 'conversionValue',
  video_views: 'videoViews',
};

function readSeriesValue(
  point: SocialAdSeriesPoint,
  metricKey: string,
): string | null {
  const field = SERIES_FIELDS[metricKey];
  const value = field ? point[field] : null;

  return typeof value === 'string' ? value : null;
}

function readTotalsValue(
  totals: SocialAdAnalyticsTotals,
  metricKey: string,
): string | null {
  const field = TOTALS_FIELDS[metricKey];
  const value = field ? totals[field] : null;

  return typeof value === 'string' ? value : null;
}
