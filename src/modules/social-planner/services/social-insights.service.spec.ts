import { EMPTY_SOCIAL_BRAND_CONTEXT } from './social-brand-context.port';
import { SocialInsightsService } from './social-insights.service';

const NEWS_XML = `<rss><channel>
<item><title>Notícia A - Fonte</title><link>https://news.google.com/rss/articles/a</link><source>Fonte</source></item>
<item><title>Notícia B - Fonte</title><link>https://news.google.com/rss/articles/b</link><source>Fonte</source></item>
</channel></rss>`;

const TRENDS_XML = `<rss><channel><item><title>termo quente</title><ht:approx_traffic>1 mil+</ht:approx_traffic>
<ht:news_item_url>https://example.com/t</ht:news_item_url></item></channel></rss>`;

function queryBuilder(raw: unknown) {
  const builder = {
    select: () => builder,
    where: () => builder,
    delete: () => builder,
    getRawOne: async () => raw,
    execute: async () => ({}),
  };
  return builder;
}

function build(options: { businessMode?: string | null; fetchOk?: boolean } = {}) {
  const urls: string[] = [];
  global.fetch = jest.fn(async (url: string | URL | Request) => {
    const href = String(url);
    urls.push(href);
    if (options.fetchOk === false) throw new Error('offline');
    const body = href.includes('trends.google.com') ? TRENDS_XML : NEWS_XML;
    return { ok: true, status: 200, text: async () => body } as Response;
  }) as typeof fetch;

  const repository = {
    createQueryBuilder: jest.fn(() => queryBuilder({ last: null, first: null })),
    create: jest.fn((row: unknown) => row),
    save: jest.fn(async (rows: unknown) => rows),
    query: jest.fn(async () => []),
  };
  const brand = {
    load: jest.fn(async () => ({
      ...EMPTY_SOCIAL_BRAND_CONTEXT,
      country: 'BR',
      businessMode: (options.businessMode ?? null) as never,
    })),
  };
  const service = new SocialInsightsService(repository as never, brand as never);
  return { service, urls, repository };
}

const agencyScope = { tenantId: 't', workspaceId: 'w', agencyClientId: null, companyContextId: null };
const clientScope = { ...agencyScope, agencyClientId: 'c1' };
const now = new Date('2026-11-11T12:00:00Z');

describe('SocialInsightsService', () => {
  it('reads the agency as Marketing whatever its own settings say', async () => {
    const { service, urls } = build({ businessMode: 'restaurants_food' });
    const view = await service.getInsights(agencyScope, now);

    expect(view.segment).toEqual({ key: 'agency_services', label: 'Marketing e Marketing Digital' });
    expect(urls.some((url) => decodeURIComponent(url).includes('"marketing digital"'))).toBe(true);
    // Agency sector dates in the next 60 days (Designer Day, Nov 5, is past; Singles Day is not agency).
    expect(view.dates.every((date) => date.date >= '2026-11-11')).toBe(true);
  });

  it("reads a client by its own Business Mode", async () => {
    const { service } = build({ businessMode: 'clinics_esthetics' });
    const view = await service.getInsights(clientScope, now);
    expect(view.segment.key).toBe('clinics_esthetics');
  });

  it('shows only dates relevant to everyone when a client has no Business Mode', async () => {
    const { service } = build({ businessMode: null });
    const view = await service.getInsights(clientScope, now);
    expect(view.segment.key).toBeNull();
    expect(view.dates.some((date) => date.significance === 'sector')).toBe(false);
    expect(view.dates.map((date) => date.key)).toContain('black_friday');
  });

  it('builds the ticker and falls back to the live trends feed when nothing is stored', async () => {
    const { service, repository } = build({ businessMode: 'real_estate' });
    const view = await service.getInsights(clientScope, now);

    expect(view.ticker[0]).toMatchObject({ title: 'Notícia A', scope: 'niche', url: 'https://news.google.com/rss/articles/a' });
    expect(view.ticker.some((item) => item.scope === 'national')).toBe(true);
    expect(view.trends.day.national[0]).toMatchObject({ term: 'termo quente', url: 'https://example.com/t' });
    // The lazy collection stored the observation.
    expect(repository.save).toHaveBeenCalled();
  });

  it('answers with empty sections, not an error, when every feed is down', async () => {
    const { service } = build({ businessMode: 'real_estate', fetchOk: false });
    const view = await service.getInsights(clientScope, now);

    expect(view.ticker).toEqual([]);
    expect(view.trends.day.national).toEqual([]);
    expect(view.sources).toEqual({ googleTrends: 'unavailable', googleNews: 'unavailable' });
    expect(view.dates.length).toBeGreaterThan(0);
  });
});
