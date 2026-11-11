import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import {
  decodeEntities,
  nicheNewsUrl,
  normalizeTerm,
  parseApproxTraffic,
  parseRssItems,
  resolveInsightsSegment,
  safeUrl,
  stripPublisherSuffix,
} from './social-insights-feeds';

const TRENDS_XML = `<?xml version="1.0"?><rss xmlns:ht="https://trends.google.com/trending/rss"><channel>
<title>Daily Search Trends</title><link>https://trends.google.com/trending/rss?geo=BR</link>
<item><title>gol linhas a&#233;reas</title><ht:approx_traffic>2 mil+</ht:approx_traffic>
<link>https://trends.google.com/trending/rss?geo=BR</link><pubDate>Wed, 11 Nov 2026 10:00:00 -0800</pubDate>
<ht:news_item><ht:news_item_title>Gol anuncia &amp; nova rota</ht:news_item_title>
<ht:news_item_url>https://example.com/gol</ht:news_item_url><ht:news_item_source>Folha</ht:news_item_source></ht:news_item></item>
<item><title><![CDATA[resultado <b>bbas3</b>]]></title><ht:approx_traffic>500+</ht:approx_traffic>
<ht:news_item_url>javascript:alert(1)</ht:news_item_url></item>
</channel></rss>`;

const NEWS_XML = `<rss><channel><item><title>Agência abre vagas - Portal Radar</title>
<link>https://news.google.com/rss/articles/abc</link><source url="https://radar.com">Portal Radar</source>
<pubDate>Tue, 10 Nov 2026 12:00:00 GMT</pubDate></item></channel></rss>`;

describe('social insights feeds', () => {
  it('reads Google Trends items as plain text with safe links', () => {
    const [first, second] = parseRssItems(TRENDS_XML);

    expect(first).toMatchObject({
      title: 'gol linhas aéreas',
      approxTraffic: '2 mil+',
      newsUrl: 'https://example.com/gol',
      newsTitle: 'Gol anuncia & nova rota',
      source: 'Folha',
      publishedAt: '2026-11-11T18:00:00.000Z',
    });
    // Markup inside CDATA is stripped; a non-http link never leaves the server.
    expect(second.title).toBe('resultado bbas3');
    expect(second.newsUrl).toBeNull();
  });

  it('reads Google News items and cuts the publisher from the headline', () => {
    const [item] = parseRssItems(NEWS_XML);
    expect(item.source).toBe('Portal Radar');
    expect(stripPublisherSuffix(item.title, item.source)).toBe('Agência abre vagas');
  });

  it('parses bucketed traffic labels', () => {
    expect(parseApproxTraffic('500+')).toBe(500);
    expect(parseApproxTraffic('2 mil+')).toBe(2000);
    expect(parseApproxTraffic('1,5 mi+')).toBe(1_500_000);
    expect(parseApproxTraffic(null)).toBeNull();
  });

  it('decodes entities and normalizes terms for grouping', () => {
    expect(decodeEntities('a &amp; b &#x27;c&#39; &lt;')).toBe("a & b 'c' <");
    expect(normalizeTerm('  Gol  LINHAS Aéreas ')).toBe('gol linhas aereas');
    expect(safeUrl('ftp://x.com')).toBeNull();
  });

  it('has a segment with news terms for every business mode, and marketing for the agency', () => {
    for (const mode of Object.values(LeadFlowBusinessMode)) {
      const segment = resolveInsightsSegment(mode);
      expect(segment.key).toBe(mode);
      expect(segment.newsTerms.length).toBeGreaterThanOrEqual(3);
    }
    expect(resolveInsightsSegment('agency_services').label).toBe('Marketing e Marketing Digital');
    expect(resolveInsightsSegment(null).key).toBeNull();
    expect(resolveInsightsSegment('unknown').key).toBeNull();
  });

  it('builds a windowed Google News query', () => {
    const url = decodeURIComponent(nicheNewsUrl(resolveInsightsSegment('real_estate'), 'week'));
    expect(url).toContain('"mercado imobiliário" OR');
    expect(url).toContain('when:7d');
    expect(url).toContain('hl=pt-BR&gl=BR&ceid=BR:pt-419');
  });
});
