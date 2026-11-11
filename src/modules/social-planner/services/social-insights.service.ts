import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { COMMEMORATIVE_DATES } from '../catalog/commemorative-dates.catalog';
import { SocialTrendSnapshotEntity } from '../entities/social-trend-snapshot.entity';
import { resolveCommemorativeDates } from './commemorative-dates.resolver';
import { SocialBrandContextPort } from './social-brand-context.port';
import type { SocialPlannerScope } from './social-planner.service';
import {
  INSIGHTS_COUNTRY,
  NATIONAL_NEWS_URL,
  WINDOW_DAYS,
  nicheNewsUrl,
  normalizeTerm,
  parseApproxTraffic,
  parseRssItems,
  resolveInsightsSegment,
  stripPublisherSuffix,
  trendingSearchesUrl,
  type InsightsWindow,
  type RssItem,
} from './social-insights-feeds';

export type SocialInsightsNewsItem = {
  title: string;
  source: string | null;
  url: string;
  publishedAt: string | null;
};

export type SocialInsightsTickerItem = SocialInsightsNewsItem & {
  scope: 'niche' | 'national';
};

export type SocialInsightsTrend = {
  term: string;
  trafficLabel: string | null;
  /** Hourly observations of the term inside the window. */
  appearances: number;
  url: string;
  newsTitle: string | null;
};

export type SocialInsightsSourceStatus = 'ok' | 'stale' | 'unavailable';

export type SocialInsightsView = {
  generatedAt: string;
  segment: { key: string | null; label: string };
  country: string;
  ticker: SocialInsightsTickerItem[];
  trends: Record<InsightsWindow, { national: SocialInsightsTrend[]; niche: SocialInsightsNewsItem[] }>;
  /** First stored observation; week/month are partial before it is 30 days old. */
  trendsCollectingSince: string | null;
  dates: Array<{ key: string; label: string; date: string; significance: string }>;
  sources: { googleTrends: SocialInsightsSourceStatus; googleNews: SocialInsightsSourceStatus };
};

export type SocialNewsTickerView = Pick<SocialInsightsView, 'generatedAt' | 'segment' | 'ticker'> & {
  sources: { googleNews: SocialInsightsSourceStatus };
};

const NEWS_TTL_MS = 30 * 60_000;
const TRENDS_TTL_MS = 50 * 60_000;
const FETCH_TIMEOUT_MS = 8_000;
const RETENTION_DAYS = 35;
const DATES_LOOKAHEAD_DAYS = 60;
const MAX_DATES = 12;
/** Generic client name on purpose: nothing about the tenant leaves the server. */
const USER_AGENT = 'Mozilla/5.0 (compatible; LyraSocialInsights/1.0)';

type CachedFeed = { at: number; items: RssItem[] };
type FeedResult = { items: RssItem[]; status: SocialInsightsSourceStatus };

/**
 * Trends, news ticker and upcoming dates for the Social Overview.
 *
 * Everything comes from public, keyless feeds (see `social-insights-feeds`),
 * read server-side only: the browser never calls Google, results are cached
 * per URL, and a failed feed answers with its last good copy.
 */
@Injectable()
export class SocialInsightsService {
  private readonly logger = new Logger(SocialInsightsService.name);
  private readonly cache = new Map<string, CachedFeed>();
  private readonly inflight = new Map<string, Promise<FeedResult>>();
  private collecting: Promise<void> | null = null;

  constructor(
    @InjectRepository(SocialTrendSnapshotEntity, 'agency')
    private readonly snapshots: Repository<SocialTrendSnapshotEntity>,
    private readonly brandContext: SocialBrandContextPort,
  ) {}

  async getInsights(scope: SocialPlannerScope, now = new Date()): Promise<SocialInsightsView> {
    const brand = await this.brandContext.load(scope);
    // The agency's own Social is always read as a marketing business; a
    // client's follows the Business Mode configured for it.
    const segment = resolveInsightsSegment(
      scope.agencyClientId === null ? 'agency_services' : brand.businessMode,
    );
    const country = INSIGHTS_COUNTRY;

    const [, day, week, month, national] = await Promise.all([
      this.collectTrendsIfStale(country).catch(() => undefined),
      this.fetchFeed(nicheNewsUrl(segment, 'day'), NEWS_TTL_MS),
      this.fetchFeed(nicheNewsUrl(segment, 'week'), NEWS_TTL_MS),
      this.fetchFeed(nicheNewsUrl(segment, 'month'), NEWS_TTL_MS),
      this.fetchFeed(NATIONAL_NEWS_URL, NEWS_TTL_MS),
    ]);

    const [nationalDay, nationalWeek, nationalMonth, since] = await Promise.all([
      this.rankTrends(country, 'day', now),
      this.rankTrends(country, 'week', now),
      this.rankTrends(country, 'month', now),
      this.firstObservation(country),
    ]);

    // Nothing stored (first run, or the table is unreachable): read live.
    if (!nationalDay) await this.fetchFeed(trendingSearchesUrl(country), TRENDS_TTL_MS);

    const nicheDay = toNews(day.items, 8);
    const ticker = buildTicker(day.items, week.items, national.items);

    const newsStatuses = [day.status, week.status, month.status, national.status];
    const trendsCached = this.cache.get(trendingSearchesUrl(country));

    return {
      generatedAt: now.toISOString(),
      segment: { key: segment.key, label: segment.label },
      country,
      ticker,
      trends: {
        day: { national: nationalDay ?? this.liveTrends(country), niche: nicheDay },
        week: { national: nationalWeek ?? [], niche: toNews(week.items, 8) },
        month: { national: nationalMonth ?? [], niche: toNews(month.items, 8) },
      },
      trendsCollectingSince: since,
      dates: this.upcomingDates(brand.country, segment.key, now),
      sources: {
        googleTrends: nationalDay
          ? 'ok'
          : trendsCached
            ? 'stale'
            : 'unavailable',
        googleNews: combineStatuses(newsStatuses),
      },
    };
  }

  /**
   * The news ticker alone, for Overviews outside Social (Agency Dashboard,
   * LeadFlow). Public headlines only: `businessMode` just picks the niche
   * query, and an unknown or missing mode falls back to the generic segment.
   */
  async getNewsTicker(businessMode: string | null, now = new Date()): Promise<SocialNewsTickerView> {
    const segment = resolveInsightsSegment(businessMode);
    const [day, week, national] = await Promise.all([
      this.fetchFeed(nicheNewsUrl(segment, 'day'), NEWS_TTL_MS),
      this.fetchFeed(nicheNewsUrl(segment, 'week'), NEWS_TTL_MS),
      this.fetchFeed(NATIONAL_NEWS_URL, NEWS_TTL_MS),
    ]);
    return {
      generatedAt: now.toISOString(),
      segment: { key: segment.key, label: segment.label },
      ticker: buildTicker(day.items, week.items, national.items),
      sources: { googleNews: combineStatuses([day.status, week.status, national.status]) },
    };
  }

  /**
   * Reads the trending feed and stores one observation per term. Skips when
   * the last observation is recent, so the hourly scheduler and the lazy
   * call from a page view never double-count an hour.
   */
  async collectTrends(country = INSIGHTS_COUNTRY, now = new Date()): Promise<number> {
    const last = await this.snapshots
      .createQueryBuilder('s')
      .select('MAX(s.observed_at)', 'last')
      .where('s.country = :country', { country })
      .getRawOne<{ last: Date | string | null }>();
    const lastAt = last?.last ? new Date(last.last).getTime() : 0;
    if (now.getTime() - lastAt < TRENDS_TTL_MS) return 0;

    const feed = await this.fetchFeed(trendingSearchesUrl(country), TRENDS_TTL_MS, true);
    if (feed.status !== 'ok' || feed.items.length === 0) return 0;

    const rows = feed.items.slice(0, 25).map((item) =>
      this.snapshots.create({
        country,
        term: item.title.slice(0, 200),
        normalizedTerm: normalizeTerm(item.title),
        traffic: parseApproxTraffic(item.approxTraffic),
        trafficLabel: item.approxTraffic?.slice(0, 40) ?? null,
        newsUrl: item.newsUrl,
        newsTitle: item.newsTitle?.slice(0, 400) ?? null,
        observedAt: now,
      }),
    );
    await this.snapshots.save(rows);
    await this.snapshots
      .createQueryBuilder()
      .delete()
      .where('observed_at < :cutoff', {
        cutoff: new Date(now.getTime() - RETENTION_DAYS * 86_400_000),
      })
      .execute();
    return rows.length;
  }

  private collectTrendsIfStale(country: string): Promise<void> {
    // One collection at a time per process; concurrent page views share it.
    this.collecting ??= this.collectTrends(country)
      .then(() => undefined)
      .catch((error: unknown) => {
        this.logger.warn(`Trend collection failed: ${error instanceof Error ? error.name : 'unknown'}`);
      })
      .finally(() => {
        this.collecting = null;
      });
    return this.collecting;
  }

  /** Terms ranked by summed traffic across the window's hourly observations. */
  private async rankTrends(
    country: string,
    window: InsightsWindow,
    now: Date,
  ): Promise<SocialInsightsTrend[] | null> {
    try {
      const rows = await this.snapshots.query(
        `SELECT
           (array_agg("term" ORDER BY "observed_at" DESC))[1] AS term,
           (array_agg("traffic_label" ORDER BY "traffic" DESC NULLS LAST))[1] AS traffic_label,
           (array_agg("news_url" ORDER BY "observed_at" DESC) FILTER (WHERE "news_url" IS NOT NULL))[1] AS news_url,
           (array_agg("news_title" ORDER BY "observed_at" DESC) FILTER (WHERE "news_title" IS NOT NULL))[1] AS news_title,
           COUNT(*)::int AS appearances,
           COALESCE(SUM("traffic"), 0)::bigint AS score
         FROM "social_trend_snapshots"
         WHERE "country" = $1 AND "observed_at" >= $2
         GROUP BY "normalized_term"
         ORDER BY score DESC, appearances DESC
         LIMIT 10`,
        [country, new Date(now.getTime() - WINDOW_DAYS[window] * 86_400_000)],
      );
      const trends = (rows as Array<Record<string, unknown>>).map((row) => {
        const term = String(row.term);
        return {
          term,
          trafficLabel: (row.traffic_label as string | null) ?? null,
          appearances: Number(row.appearances ?? 0),
          url: (row.news_url as string | null) ?? googleSearchUrl(term),
          newsTitle: (row.news_title as string | null) ?? null,
        };
      });
      return trends.length > 0 ? trends : null;
    } catch (error) {
      this.logger.warn(`Trend ranking failed: ${error instanceof Error ? error.name : 'unknown'}`);
      return null;
    }
  }

  /** Fallback for "today" when nothing is stored yet: the live feed as is. */
  private liveTrends(country: string): SocialInsightsTrend[] {
    const cached = this.cache.get(trendingSearchesUrl(country));
    return (cached?.items ?? []).slice(0, 10).map((item) => ({
      term: item.title,
      trafficLabel: item.approxTraffic,
      appearances: 1,
      url: item.newsUrl ?? googleSearchUrl(item.title),
      newsTitle: item.newsTitle,
    }));
  }

  private async firstObservation(country: string): Promise<string | null> {
    try {
      const row = await this.snapshots
        .createQueryBuilder('s')
        .select('MIN(s.observed_at)', 'first')
        .where('s.country = :country', { country })
        .getRawOne<{ first: Date | string | null }>();
      return row?.first ? new Date(row.first).toISOString() : null;
    } catch {
      return null;
    }
  }

  private upcomingDates(
    brandCountry: string | null,
    mode: string | null,
    now: Date,
  ): SocialInsightsView['dates'] {
    const today = now.toISOString().slice(0, 10);
    const end = new Date(now.getTime() + DATES_LOOKAHEAD_DAYS * 86_400_000).toISOString().slice(0, 10);
    // Without a Business Mode only the dates relevant to everyone are shown;
    // the resolver's "null mode = every sector date" suits a picker, not a feed.
    const catalog = mode ? COMMEMORATIVE_DATES : COMMEMORATIVE_DATES.filter((item) => item.businessModes === null);

    return resolveCommemorativeDates(
      {
        periodStart: today,
        periodEnd: end,
        country: brandCountry,
        businessMode: mode as never,
      },
      catalog,
    )
      .slice(0, MAX_DATES)
      .map(({ key, label, date, significance }) => ({ key, label, date, significance }));
  }

  private fetchFeed(url: string, ttlMs: number, force = false): Promise<FeedResult> {
    const cached = this.cache.get(url);
    if (!force && cached && Date.now() - cached.at < ttlMs) {
      return Promise.resolve({ items: cached.items, status: 'ok' });
    }
    const running = this.inflight.get(url);
    if (running) return running;

    const request = fetch(url, {
      headers: { 'User-Agent': USER_AGENT, Accept: 'application/rss+xml, application/xml, text/xml' },
      signal: AbortSignal.timeout(FETCH_TIMEOUT_MS),
    })
      .then(async (response) => {
        if (!response.ok) throw new Error(`HTTP ${response.status}`);
        const items = parseRssItems(await response.text());
        this.cache.set(url, { at: Date.now(), items });
        this.trimCache();
        return { items, status: 'ok' as const };
      })
      .catch((error: unknown) => {
        this.logger.warn(
          `Insights feed unavailable (${new URL(url).hostname}): ${error instanceof Error ? error.message : 'unknown'}`,
        );
        return cached
          ? { items: cached.items, status: 'stale' as const }
          : { items: [], status: 'unavailable' as const };
      })
      .finally(() => this.inflight.delete(url));

    this.inflight.set(url, request);
    return request;
  }

  /** 13 segments × 3 windows + national + trends: a small, bounded cache. */
  private trimCache() {
    if (this.cache.size <= 80) return;
    const oldest = [...this.cache.entries()].sort((a, b) => a[1].at - b[1].at)[0];
    if (oldest) this.cache.delete(oldest[0]);
  }
}

/** Niche headlines of the day (the week's when the day is thin), then national. */
function buildTicker(day: RssItem[], week: RssItem[], national: RssItem[]): SocialInsightsTickerItem[] {
  const nicheDay = toNews(day, 8);
  const niche = nicheDay.length >= 5 ? nicheDay : toNews(week, 8);
  return [
    ...niche.map((item) => ({ ...item, scope: 'niche' as const })),
    ...toNews(national, 8).map((item) => ({ ...item, scope: 'national' as const })),
  ];
}

function combineStatuses(statuses: SocialInsightsSourceStatus[]): SocialInsightsSourceStatus {
  if (statuses.every((status) => status === 'unavailable')) return 'unavailable';
  return statuses.some((status) => status !== 'ok') ? 'stale' : 'ok';
}

function toNews(items: RssItem[], limit: number): SocialInsightsNewsItem[] {
  const seen = new Set<string>();
  const news: SocialInsightsNewsItem[] = [];
  for (const item of items) {
    if (!item.url) continue;
    const title = stripPublisherSuffix(item.title, item.source);
    const key = normalizeTerm(title);
    if (seen.has(key)) continue;
    seen.add(key);
    news.push({ title, source: item.source, url: item.url, publishedAt: item.publishedAt });
    if (news.length >= limit) break;
  }
  return news;
}

function googleSearchUrl(term: string): string {
  return `https://www.google.com/search?q=${encodeURIComponent(term)}`;
}
