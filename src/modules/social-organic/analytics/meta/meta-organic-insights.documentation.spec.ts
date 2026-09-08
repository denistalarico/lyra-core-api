import { META_ORGANIC_GRAPH_API_VERSION } from '../../providers/meta/meta-organic-oauth.support';
import {
  FACEBOOK_PAGE_ACCOUNT_METRICS,
  INSTAGRAM_ACCOUNT_FOLLOW_METRICS,
  INSTAGRAM_ACCOUNT_MEDIA_METRICS,
  META_ORGANIC_BLOCKED_LIFETIME_METRICS,
  META_ORGANIC_DOCUMENTED_METRICS,
  META_ORGANIC_INSIGHTS_GRAPH_VERSION,
} from './meta-organic-insights.types';

describe('Meta organic documentation contract', () => {
  it('pins insights to the shared Meta Graph v26.0 configuration', () => {
    expect(META_ORGANIC_INSIGHTS_GRAPH_VERSION).toBe('v26.0');
    expect(META_ORGANIC_INSIGHTS_GRAPH_VERSION).toBe(
      META_ORGANIC_GRAPH_API_VERSION,
    );
  });

  it('allows runtime normalization only for documented daily/account facts', () => {
    const runtime = new Set<string>([
      ...FACEBOOK_PAGE_ACCOUNT_METRICS,
      ...INSTAGRAM_ACCOUNT_MEDIA_METRICS,
      ...INSTAGRAM_ACCOUNT_FOLLOW_METRICS,
      'followers_count',
    ]);
    const normalized = META_ORGANIC_DOCUMENTED_METRICS.filter(
      (metric) => metric.runtime === 'normalized',
    );

    expect(
      [...runtime].filter(
        (name) => !normalized.some((metric) => metric.name === name),
      ),
    ).toEqual([]);
    expect(normalized.every((metric) => metric.level === 'account')).toBe(true);
    expect(
      normalized.every(
        (metric) =>
          metric.period === 'day' || metric.period === 'current_snapshot',
      ),
    ).toBe(true);
  });

  it('normalizes documented lifetime post/media totals only as snapshots, never as a daily flow', () => {
    for (const name of META_ORGANIC_BLOCKED_LIFETIME_METRICS) {
      const lifetimeEntries = META_ORGANIC_DOCUMENTED_METRICS.filter(
        (metric) => metric.name === name && metric.period === 'lifetime',
      );

      expect(lifetimeEntries.length).toBeGreaterThan(0);
      // Still true post-A2: the specific lifetime-period entry for this name
      // is never written to a daily flow column — `normalized_snapshot`
      // preserves the distinction `blocked_daily_grain` existed to preserve.
      // (Some names, e.g. `views`, are legitimately shared with an unrelated
      // account-level *day* metric that IS `normalized` — this asserts only
      // about the lifetime-period entry, not every entry sharing the name.)
      for (const entry of lifetimeEntries) {
        expect(entry.runtime).toBe('normalized_snapshot');
      }
    }
  });

  it('records endpoint, parameters, limitations and official source for every metric', () => {
    for (const metric of META_ORGANIC_DOCUMENTED_METRICS) {
      expect(metric.endpoint).toMatch(/^GET \//);
      expect(metric.request.length).toBeGreaterThan(0);
      expect(metric.limitations.length).toBeGreaterThan(20);
      expect(metric.source).toMatch(/^https:\/\/developers\.facebook\.com\//);
      expect(metric.source).not.toContain('?');
    }
  });

  it('contains no paid KPI or unresolved marker', () => {
    const names = META_ORGANIC_DOCUMENTED_METRICS.map((metric) => metric.name);
    expect(names).not.toEqual(
      expect.arrayContaining(['spend', 'cpc', 'ctr', 'roas']),
    );
  });
});
