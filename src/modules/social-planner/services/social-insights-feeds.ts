import type { SocialBusinessModeKey } from '../catalog/commemorative-dates.catalog';

/**
 * Pure pieces of the Social Overview insights: which public feeds to read for
 * a segment, and how to read them. No I/O here, so the spec covers it whole.
 *
 * SOURCES (all public, keyless, free)
 * -----------------------------------
 *  - Google Trends "Trending now" RSS (`trends.google.com/trending/rss`): the
 *    ~10 searches spiking in a country right now. It honours only `geo` —
 *    `hours` and `category` are ignored (verified 2026-11-11) — so week and
 *    month are built from hourly snapshots we keep ourselves.
 *  - Google News RSS search (`news.google.com/rss/search`): niche headlines
 *    with a `when:` window, which is what gives the niche day/week/month.
 *  - Google News RSS top stories: the national/world strip of the ticker.
 *
 * None of these has a formal contract, which is why every caller treats a
 * failure as "keep the last good answer" rather than as an error.
 */

export const INSIGHTS_COUNTRY = 'BR';

export type InsightsSegment = {
  key: SocialBusinessModeKey | null;
  label: string;
  /** Google News query terms, OR-ed. Quoted so multi-word terms stay whole. */
  newsTerms: string[];
};

const SEGMENTS: Record<SocialBusinessModeKey, Omit<InsightsSegment, 'key'>> = {
  agency_services: {
    label: 'Marketing e Marketing Digital',
    newsTerms: ['marketing digital', 'redes sociais', 'Meta Ads', 'Google Ads', 'publicidade', 'influenciadores'],
  },
  local_services: {
    label: 'Serviços locais',
    newsTerms: ['pequenas empresas', 'empreendedorismo', 'prestadores de serviço', 'Sebrae'],
  },
  clinics_esthetics: {
    label: 'Clínicas e estética',
    newsTerms: ['estética', 'harmonização facial', 'dermatologia', 'procedimentos estéticos'],
  },
  restaurants_food: {
    label: 'Restaurantes e alimentação',
    newsTerms: ['gastronomia', 'restaurantes', 'food service', 'delivery de comida'],
  },
  real_estate: {
    label: 'Mercado imobiliário',
    newsTerms: ['mercado imobiliário', 'financiamento imobiliário', 'lançamentos imobiliários', 'imóveis'],
  },
  education_courses: {
    label: 'Educação e cursos',
    newsTerms: ['educação', 'cursos online', 'ensino a distância', 'Enem'],
  },
  automotive: {
    label: 'Automotivo',
    newsTerms: ['mercado automotivo', 'concessionárias', 'carros', 'veículos elétricos'],
  },
  retail_store: {
    label: 'Varejo',
    newsTerms: ['varejo', 'comércio', 'consumidor', 'vendas no varejo'],
  },
  ecommerce_light: {
    label: 'E-commerce',
    newsTerms: ['e-commerce', 'comércio eletrônico', 'marketplace', 'vendas online'],
  },
  events_tourism: {
    label: 'Eventos e turismo',
    newsTerms: ['turismo', 'eventos', 'viagens', 'hotelaria'],
  },
  legal_accounting: {
    label: 'Jurídico e contábil',
    newsTerms: ['contabilidade', 'reforma tributária', 'Receita Federal', 'direito empresarial'],
  },
  fitness_wellness: {
    label: 'Fitness e bem-estar',
    newsTerms: ['academia', 'fitness', 'bem-estar', 'nutrição'],
  },
};

const GENERIC_SEGMENT: Omit<InsightsSegment, 'key'> = {
  label: 'Negócios e empreendedorismo',
  newsTerms: ['negócios', 'empreendedorismo', 'pequenas empresas'],
};

/** An unknown or missing mode reads as the generic business segment. */
export function resolveInsightsSegment(mode: string | null | undefined): InsightsSegment {
  const known = mode && mode in SEGMENTS ? (mode as SocialBusinessModeKey) : null;
  return { key: known, ...(known ? SEGMENTS[known] : GENERIC_SEGMENT) };
}

export type InsightsWindow = 'day' | 'week' | 'month';

export const WINDOW_DAYS: Record<InsightsWindow, number> = { day: 1, week: 7, month: 30 };

const NEWS_LOCALE = 'hl=pt-BR&gl=BR&ceid=BR:pt-419';

export function nicheNewsUrl(segment: InsightsSegment, window: InsightsWindow): string {
  const terms = segment.newsTerms.map((term) => `"${term}"`).join(' OR ');
  const query = `(${terms}) when:${WINDOW_DAYS[window]}d`;
  return `https://news.google.com/rss/search?q=${encodeURIComponent(query)}&${NEWS_LOCALE}`;
}

export const NATIONAL_NEWS_URL = `https://news.google.com/rss?${NEWS_LOCALE}`;

export function trendingSearchesUrl(country: string): string {
  return `https://trends.google.com/trending/rss?geo=${encodeURIComponent(country)}`;
}

// ------------------------------------------------------------------ parsing --

export type RssItem = {
  title: string;
  url: string | null;
  source: string | null;
  publishedAt: string | null;
  /** Google Trends only: "500+", "2 mil+" … */
  approxTraffic: string | null;
  /** Google Trends only: the first news link explaining the spike. */
  newsUrl: string | null;
  newsTitle: string | null;
};

const MAX_ITEMS = 60;

/**
 * A deliberately small RSS reader: the feeds are flat `<item>` lists and a
 * full XML dependency would be the larger risk. Everything leaves as plain
 * text; nothing from the feed is ever rendered as HTML.
 */
export function parseRssItems(xml: string): RssItem[] {
  const items: RssItem[] = [];
  const pattern = /<item\b[^>]*>([\s\S]*?)<\/item>/gi;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(xml)) && items.length < MAX_ITEMS) {
    const block = match[1];
    const title = tag(block, 'title');
    if (!title) continue;
    const pubDate = tag(block, 'pubDate');
    const published = pubDate ? new Date(pubDate) : null;

    items.push({
      title,
      url: safeUrl(tag(block, 'link')),
      source: tag(block, 'source') ?? tag(block, 'ht:news_item_source'),
      publishedAt: published && !Number.isNaN(published.getTime()) ? published.toISOString() : null,
      approxTraffic: tag(block, 'ht:approx_traffic'),
      newsUrl: safeUrl(tag(block, 'ht:news_item_url')),
      newsTitle: tag(block, 'ht:news_item_title'),
    });
  }

  return items;
}

/**
 * Google News titles end in " - Publisher". The publisher is already in
 * `<source>`, so it is cut from the headline when it matches.
 */
export function stripPublisherSuffix(title: string, source: string | null): string {
  if (!source) return title;
  const suffix = ` - ${source}`;
  return title.endsWith(suffix) ? title.slice(0, -suffix.length).trim() : title;
}

/** "2 mil+" → 2000, "500+" → 500, "1,5 mi+" → 1 500 000. Null when unreadable. */
export function parseApproxTraffic(value: string | null): number | null {
  if (!value) return null;
  const match = /([\d.,]+)\s*(mil|mi|k|m)?/i.exec(value);
  if (!match) return null;
  const base = Number(match[1].replace(/\./g, '').replace(',', '.'));
  if (!Number.isFinite(base)) return null;
  const unit = match[2]?.toLowerCase();
  const factor = unit === 'mil' || unit === 'k' ? 1_000 : unit === 'mi' || unit === 'm' ? 1_000_000 : 1;
  return Math.round(base * factor);
}

export function normalizeTerm(term: string): string {
  return term
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 200);
}

function tag(block: string, name: string): string | null {
  const escaped = name.replace(':', '\\:');
  const match = new RegExp(`<${escaped}\\b[^>]*>([\\s\\S]*?)</${escaped}>`, 'i').exec(block);
  if (!match) return null;
  const text = decodeEntities(match[1].replace(/^\s*<!\[CDATA\[([\s\S]*?)\]\]>\s*$/, '$1'))
    .replace(/<[^>]*>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
  return text ? text.slice(0, 400) : null;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

export function decodeEntities(value: string): string {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (whole, entity: string) => {
    if (entity[0] === '#') {
      const code = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : parseInt(entity.slice(1), 10);
      return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
    }
    return NAMED_ENTITIES[entity.toLowerCase()] ?? whole;
  });
}

/** Only absolute http(s) links leave the server; anything else becomes null. */
export function safeUrl(value: string | null): string | null {
  if (!value) return null;
  try {
    const url = new URL(value);
    return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
  } catch {
    return null;
  }
}
