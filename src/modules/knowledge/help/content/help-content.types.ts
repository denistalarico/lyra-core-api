export type HelpLocale = "pt-BR" | "en" | "es";
export type HelpStatus = "published" | "draft" | "archived";
export type HelpContentFormat = "html" | "markdown";

export interface HelpCategorySeed {
  key: string;
  title: string;
  description: string;
  icon: string;
  color: string;
  productKey: string;
  moduleKey: string;
  order: number;
  locale: HelpLocale;
  status: HelpStatus;
}

export interface HelpTrailArticleRef {
  articleKey: string;
  required?: boolean;
  estimatedMinutes?: number;
}

export interface HelpTrailSeed {
  key: string;
  title: string;
  description: string;
  audience: string;
  estimatedMinutes: number;
  productKey: string;
  moduleKey: string;
  order: number;
  locale: HelpLocale;
  status: HelpStatus;
  articles: HelpTrailArticleRef[];
}

export interface HelpArticleSeed {
  systemKey: string;
  slug: string;
  title: string;
  summary: string;
  /** Authored, trusted platform content (Markdown by default). */
  content: string;
  contentFormat: HelpContentFormat;
  categoryKey: string;
  productKey: string;
  moduleKey: string;
  locale: HelpLocale;
  version: number;
  order: number;
  status: HelpStatus;
  isFeatured: boolean;
  searchable: boolean;
  estimatedReadMinutes?: number;
  /**
   * Trails this article declares membership in (frontmatter `trailKeys`).
   * Trail ordering itself is driven by trails.json `articleKeys`; this is
   * kept for validation and back-linking.
   */
  trailKeys?: string[];
  /** Stable sha256 of the source file — drives content-aware re-sync. */
  contentHash?: string;
  /** Repo-relative path of the markdown source (diagnostics/metadata). */
  sourcePath?: string;
  metadata?: Record<string, unknown>;
}

export interface HelpContentRegistry {
  categories: HelpCategorySeed[];
  trails: HelpTrailSeed[];
  articles: HelpArticleSeed[];
}
