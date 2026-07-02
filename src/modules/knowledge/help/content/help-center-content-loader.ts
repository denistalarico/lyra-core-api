import { createHash } from "crypto";
import { existsSync, readdirSync, readFileSync, statSync } from "fs";
import { join, posix, relative, resolve, sep } from "path";
import { parseFrontmatter } from "./frontmatter";
import {
  HelpArticleSeed,
  HelpCategorySeed,
  HelpContentFormat,
  HelpContentRegistry,
  HelpLocale,
  HelpStatus,
  HelpTrailSeed,
} from "./help-content.types";

export interface HelpContentLoadResult {
  registry: HelpContentRegistry;
  /** Fatal per-item problems (the item is skipped). */
  errors: string[];
  /** Non-fatal issues (still synced). */
  warnings: string[];
  sources: {
    contentDir: string;
    categoriesFile: string | null;
    trailsFile: string | null;
    articleFiles: string[];
  };
}

const REQUIRED_ARTICLE_FIELDS = [
  "systemKey",
  "slug",
  "title",
  "summary",
  "categoryKey",
  "order",
  "version",
  "locale",
  "status",
] as const;

/**
 * Loads the official Help Center content from versioned Markdown + JSON files
 * and turns it into a {@link HelpContentRegistry} the seed service can sync.
 *
 * Layout (inside the backend service, so it ships and versions with the code
 * that reads it):
 *
 *   content/help-center/{locale}/categories.json
 *   content/help-center/{locale}/trails.json
 *   content/help-center/{locale}/<area>/NNN-*.md   (frontmatter + Markdown body)
 *
 * Each article carries a `contentHash` (sha256 of the raw file) so the sync can
 * update on any edit — not just on a version bump.
 */
export class HelpCenterContentLoader {
  private readonly contentDir: string;

  constructor(contentDir?: string) {
    this.contentDir = contentDir ?? resolveDefaultContentDir();
  }

  getContentDir(): string {
    return this.contentDir;
  }

  load(locale: string = "pt-BR"): HelpContentLoadResult {
    const errors: string[] = [];
    const warnings: string[] = [];
    const localeDir = join(this.contentDir, locale);

    const sources: HelpContentLoadResult["sources"] = {
      contentDir: this.contentDir,
      categoriesFile: null,
      trailsFile: null,
      articleFiles: [],
    };

    if (!existsSync(localeDir)) {
      errors.push(`Content directory not found: ${localeDir}`);
      return {
        registry: { categories: [], trails: [], articles: [] },
        errors,
        warnings,
        sources,
      };
    }

    const categories = this.loadCategories(localeDir, locale, errors, sources);
    const categoryKeys = new Set(categories.map((c) => c.key));

    const articles = this.loadArticles(
      localeDir,
      locale,
      categoryKeys,
      errors,
      warnings,
      sources,
    );
    const articleKeys = new Set(articles.map((a) => a.systemKey));

    const trails = this.loadTrails(
      localeDir,
      locale,
      articles,
      articleKeys,
      errors,
      warnings,
      sources,
    );

    return {
      registry: { categories, trails, articles },
      errors,
      warnings,
      sources,
    };
  }

  private readJson<T>(file: string): T {
    return JSON.parse(readFileSync(file, "utf8")) as T;
  }

  private loadCategories(
    localeDir: string,
    locale: string,
    errors: string[],
    sources: HelpContentLoadResult["sources"],
  ): HelpCategorySeed[] {
    const file = join(localeDir, "categories.json");
    if (!existsSync(file)) {
      errors.push(`Missing categories.json for locale "${locale}".`);
      return [];
    }
    sources.categoriesFile = file;

    try {
      const raw = this.readJson<Record<string, unknown>[]>(file);
      return raw.map((c) => ({
        key: String(c.key),
        title: String(c.title),
        description: String(c.description ?? ""),
        icon: String(c.icon ?? ""),
        color: String(c.color ?? ""),
        productKey: String(c.productKey ?? "lyra-agency"),
        moduleKey: String(c.moduleKey ?? "general"),
        order: Number(c.order ?? 0),
        locale: (c.locale as HelpLocale) ?? (locale as HelpLocale),
        status: (c.status as HelpStatus) ?? "published",
      }));
    } catch (error) {
      errors.push(`Failed to parse categories.json: ${(error as Error).message}`);
      return [];
    }
  }

  private loadTrails(
    localeDir: string,
    locale: string,
    articles: HelpArticleSeed[],
    articleKeys: Set<string>,
    errors: string[],
    warnings: string[],
    sources: HelpContentLoadResult["sources"],
  ): HelpTrailSeed[] {
    const file = join(localeDir, "trails.json");
    if (!existsSync(file)) {
      errors.push(`Missing trails.json for locale "${locale}".`);
      return [];
    }
    sources.trailsFile = file;

    let raw: Record<string, unknown>[];
    try {
      raw = this.readJson<Record<string, unknown>[]>(file);
    } catch (error) {
      errors.push(`Failed to parse trails.json: ${(error as Error).message}`);
      return [];
    }

    return raw.map((t) => {
      const key = String(t.key);
      const declared = Array.isArray(t.articleKeys)
        ? (t.articleKeys as string[])
        : null;

      // Authoritative order comes from trails.json `articleKeys`; if absent, we
      // derive membership from each article's `trailKeys`, ordered by `order`.
      const orderedKeys = declared
        ? declared
        : articles
            .filter((a) => (a.trailKeys ?? []).includes(key))
            .sort((a, b) => a.order - b.order)
            .map((a) => a.systemKey);

      for (const articleKey of orderedKeys) {
        if (!articleKeys.has(articleKey)) {
          warnings.push(
            `Trail "${key}" references unknown article "${articleKey}".`,
          );
        }
      }

      // Consistency check: an article that claims this trail should be listed.
      for (const article of articles) {
        const claims = (article.trailKeys ?? []).includes(key);
        const listed = orderedKeys.includes(article.systemKey);
        if (claims && !listed) {
          warnings.push(
            `Article "${article.systemKey}" declares trail "${key}" but is not listed in it.`,
          );
        }
      }

      return {
        key,
        title: String(t.title),
        description: String(t.description ?? ""),
        audience: String(t.audience ?? ""),
        estimatedMinutes: Number(t.estimatedMinutes ?? 0),
        productKey: String(t.productKey ?? "lyra-agency"),
        moduleKey: String(t.moduleKey ?? "general"),
        order: Number(t.order ?? 0),
        locale: (t.locale as HelpLocale) ?? (locale as HelpLocale),
        status: (t.status as HelpStatus) ?? "published",
        articles: orderedKeys
          .filter((k) => articleKeys.has(k))
          .map((articleKey) => ({ articleKey })),
      };
    });
  }

  private loadArticles(
    localeDir: string,
    locale: string,
    categoryKeys: Set<string>,
    errors: string[],
    warnings: string[],
    sources: HelpContentLoadResult["sources"],
  ): HelpArticleSeed[] {
    const files = walkMarkdown(localeDir).sort();
    sources.articleFiles = files.map((f) => toPosixRelative(this.contentDir, f));

    const articles: HelpArticleSeed[] = [];
    const seenSystemKeys = new Map<string, string>();
    const seenSlugs = new Map<string, string>();

    for (const file of files) {
      const relPath = toPosixRelative(this.contentDir, file);
      let rawFile: string;
      try {
        rawFile = readFileSync(file, "utf8");
      } catch (error) {
        errors.push(`Cannot read ${relPath}: ${(error as Error).message}`);
        continue;
      }

      const { data, content } = parseFrontmatter(rawFile);
      const body = content.trim();

      const missing = REQUIRED_ARTICLE_FIELDS.filter(
        (field) => data[field] === undefined || data[field] === null || data[field] === "",
      );
      if (missing.length) {
        errors.push(`${relPath}: missing required field(s): ${missing.join(", ")}.`);
        continue;
      }
      if (!body) {
        errors.push(`${relPath}: missing Markdown body/content.`);
        continue;
      }

      const trailKeys = normalizeStringArray(data.trailKeys);
      if (data.trailKeys === undefined) {
        errors.push(`${relPath}: missing required field: trailKeys.`);
        continue;
      }

      const systemKey = String(data.systemKey);
      const slug = String(data.slug);
      const categoryKey = String(data.categoryKey);

      if (!categoryKeys.has(categoryKey)) {
        // Controlled skip: never sync an article pointing at an unknown category.
        errors.push(
          `${relPath}: unknown categoryKey "${categoryKey}" (skipped).`,
        );
        continue;
      }

      if (seenSystemKeys.has(systemKey)) {
        errors.push(
          `${relPath}: duplicate systemKey "${systemKey}" (also in ${seenSystemKeys.get(systemKey)}).`,
        );
        continue;
      }
      if (seenSlugs.has(slug)) {
        errors.push(
          `${relPath}: duplicate slug "${slug}" (also in ${seenSlugs.get(slug)}).`,
        );
        continue;
      }
      seenSystemKeys.set(systemKey, relPath);
      seenSlugs.set(slug, relPath);

      const fileLocale = String(data.locale);
      if (fileLocale !== locale) {
        warnings.push(
          `${relPath}: frontmatter locale "${fileLocale}" differs from folder locale "${locale}".`,
        );
      }

      const estimatedReadMinutes = firstNumber(
        data.estimatedMinutes,
        data.estimatedReadMinutes,
      );

      const extraMetadata: Record<string, unknown> = {};
      if (data.tags !== undefined) extraMetadata.tags = normalizeStringArray(data.tags);
      if (data.audience !== undefined) extraMetadata.audience = String(data.audience);
      if (data.relatedArticleKeys !== undefined) {
        extraMetadata.relatedArticleKeys = normalizeStringArray(data.relatedArticleKeys);
      }
      if (data.updatedAt !== undefined) extraMetadata.updatedAt = String(data.updatedAt);

      articles.push({
        systemKey,
        slug,
        title: String(data.title),
        summary: String(data.summary),
        content: body,
        contentFormat: (String(data.contentFormat ?? "markdown") as HelpContentFormat),
        categoryKey,
        productKey: String(data.productKey ?? "lyra-agency"),
        moduleKey: String(data.moduleKey ?? "general"),
        locale: fileLocale as HelpLocale,
        version: Number(data.version),
        order: Number(data.order),
        status: String(data.status) as HelpStatus,
        isFeatured: Boolean(data.isFeatured ?? false),
        searchable: data.searchable === undefined ? true : Boolean(data.searchable),
        estimatedReadMinutes,
        trailKeys,
        contentHash: sha256(rawFile),
        sourcePath: posix.join("content", "help-center", relPath),
        metadata: extraMetadata,
      });
    }

    // Back-link validation: an article claiming an unknown trail is a warning.
    return articles;
  }
}

function sha256(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

function firstNumber(...values: unknown[]): number | undefined {
  for (const value of values) {
    const n = Number(value);
    if (value !== undefined && value !== null && Number.isFinite(n) && n > 0) {
      return n;
    }
  }
  return undefined;
}

function normalizeStringArray(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((v) => String(v));
  if (value === undefined || value === null || value === "") return [];
  return [String(value)];
}

function walkMarkdown(dir: string): string[] {
  const results: string[] = [];
  const stack = [dir];
  while (stack.length) {
    const current = stack.pop() as string;
    let entries: string[];
    try {
      entries = readdirSync(current);
    } catch {
      continue;
    }
    for (const entry of entries) {
      const full = join(current, entry);
      const stat = statSync(full);
      if (stat.isDirectory()) {
        stack.push(full);
      } else if (entry.toLowerCase().endsWith(".md")) {
        results.push(full);
      }
    }
  }
  return results;
}

function toPosixRelative(from: string, to: string): string {
  return relative(from, to).split(sep).join(posix.sep);
}

/**
 * Resolves the `content/help-center` directory that ships inside this service.
 * Works from both `src` (ts-node) and `dist` (compiled) because they mirror the
 * same depth under the service root. An explicit override wins.
 */
export function resolveDefaultContentDir(): string {
  const candidates = [
    process.env.HELP_CENTER_CONTENT_DIR,
    resolve(__dirname, "../../../../../content/help-center"),
    resolve(process.cwd(), "content/help-center"),
    resolve(process.cwd(), "services/lyra-core-api/content/help-center"),
  ].filter((c): c is string => Boolean(c));

  for (const candidate of candidates) {
    if (existsSync(candidate)) return candidate;
  }
  return candidates[1] ?? candidates[0];
}
