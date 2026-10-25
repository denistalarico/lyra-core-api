import { Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

export type OrionHelpHit = {
  slug: string;
  title: string;
  summary: string | null;
  excerpt: string;
};

/**
 * OR4 — Help Center search for the Orion (D-OR-9: Postgres text search, no
 * pgvector). Platform content only (`help_articles` is global), published and
 * `searchable`.
 *
 * The question is normalized with the same Portuguese configuration as the
 * generated `search_vector` and its lexemes are OR-ed: a user question is a
 * sentence, and requiring every word (as `plainto_tsquery` does) would miss
 * the article for "como conecto o WhatsApp no LeadFlow?". Ranking still
 * favours articles that match more terms, and the title weighs most.
 */
@Injectable()
export class OrionHelpSearchService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async search(
    query: string,
    options: { locale?: string; limit?: number } = {},
  ): Promise<OrionHelpHit[]> {
    // Lexemes go into a tsquery literal; backslashes are the one character
    // that `quote_literal` would turn into an E'' string. NUL is not valid text
    // for PostgreSQL at all.
    const text = query
      .split('\\')
      .join(' ')
      .split(String.fromCharCode(0))
      .join(' ')
      .trim()
      .slice(0, 300);
    if (!text) return [];
    const limit = Math.min(Math.max(options.limit ?? 4, 1), 8);
    const rows = await this.dataSource.query<
      Array<{
        slug: string;
        title: string;
        summary: string | null;
        excerpt: string | null;
      }>
    >(
      `WITH q AS (
         SELECT (SELECT string_agg(quote_literal(lexeme), ' | ')
                   FROM unnest(tsvector_to_array(to_tsvector('portuguese', $2))) AS lexeme
                )::tsquery AS query
       )
       SELECT a.slug, a.title, a.summary,
              ts_headline('portuguese', a.content, q.query,
                'MaxWords=35, MinWords=12, MaxFragments=1, StartSel="", StopSel=""') AS excerpt
         FROM help_articles a, q
        WHERE q.query IS NOT NULL
          AND a.locale = $1 AND a.status = 'published' AND a.searchable
          AND a.search_vector @@ q.query
        ORDER BY ts_rank(a.search_vector, q.query) DESC, a.sort_order ASC, a.title ASC
        LIMIT $3`,
      [options.locale ?? 'pt-BR', text, limit],
    );
    return rows.map((row) => ({
      slug: row.slug,
      title: row.title,
      summary: row.summary,
      excerpt: (row.excerpt ?? '').replace(/\s+/g, ' ').trim().slice(0, 400),
    }));
  }
}
