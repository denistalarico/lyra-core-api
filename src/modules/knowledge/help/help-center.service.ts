import { Injectable, NotFoundException } from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { FindOptionsWhere, ILike, In, Repository } from "typeorm";
import {
  HelpArticle,
  HelpCategory,
  HelpTrail,
  HelpTrailArticle,
} from "./entities";
import { DEFAULT_HELP_LOCALE } from "./dto";
import { markdownToHtml } from "./content/markdown-to-html";

const PUBLISHED = "published";

/** Article body pre-rendered to safe HTML for the reader. */
export type HelpArticleWithHtml = HelpArticle & { contentHtml: string };

export interface HelpArticleListItem {
  id: string;
  systemKey: string;
  slug: string;
  title: string;
  summary: string | null;
  categoryKey: string | null;
  moduleKey: string | null;
  isFeatured: boolean;
  estimatedReadMinutes: number;
  updatedAt: Date;
}

export interface HelpTrailListItem {
  id: string;
  key: string;
  title: string;
  description: string | null;
  audience: string | null;
  estimatedMinutes: number;
  moduleKey: string | null;
  articleCount: number;
}

export interface HelpTrailStep extends HelpArticleListItem {
  required: boolean;
  trailEstimatedMinutes: number | null;
}

@Injectable()
export class HelpCenterService {
  constructor(
    @InjectRepository(HelpCategory, "agency")
    private readonly categoriesRepo: Repository<HelpCategory>,
    @InjectRepository(HelpTrail, "agency")
    private readonly trailsRepo: Repository<HelpTrail>,
    @InjectRepository(HelpArticle, "agency")
    private readonly articlesRepo: Repository<HelpArticle>,
    @InjectRepository(HelpTrailArticle, "agency")
    private readonly trailArticlesRepo: Repository<HelpTrailArticle>,
  ) {}

  private resolveLocale(locale?: string): string {
    return locale && locale.trim() ? locale.trim() : DEFAULT_HELP_LOCALE;
  }

  private toListItem(article: HelpArticle): HelpArticleListItem {
    return {
      id: article.id,
      systemKey: article.systemKey,
      slug: article.slug,
      title: article.title,
      summary: article.summary,
      categoryKey: article.categoryKey,
      moduleKey: article.moduleKey,
      isFeatured: article.isFeatured,
      estimatedReadMinutes: this.readMinutes(article),
      updatedAt: article.updatedAt,
    };
  }

  private readMinutes(article: HelpArticle): number {
    const fromMeta = Number(
      (article.metadata as Record<string, unknown>)?.estimatedReadMinutes,
    );
    return Number.isFinite(fromMeta) && fromMeta > 0 ? fromMeta : 1;
  }

  async listCategories(locale?: string): Promise<HelpCategory[]> {
    return this.categoriesRepo.find({
      where: { locale: this.resolveLocale(locale), status: PUBLISHED },
      order: { sortOrder: "ASC", title: "ASC" },
    });
  }

  async listArticles(params: {
    locale?: string;
    categoryKey?: string;
    search?: string;
  }): Promise<HelpArticleListItem[]> {
    const locale = this.resolveLocale(params.locale);
    const order = { isFeatured: "DESC", sortOrder: "ASC", title: "ASC" } as const;

    const baseWhere: FindOptionsWhere<HelpArticle> = {
      locale,
      status: PUBLISHED,
      ...(params.categoryKey ? { categoryKey: params.categoryKey } : {}),
    };

    const search = params.search?.trim();
    if (!search) {
      const articles = await this.articlesRepo.find({ where: baseWhere, order });
      return articles.map((a) => this.toListItem(a));
    }

    // Search the official content only (separate table) and only flagged-as
    // searchable, published articles. Tenant/company content lives elsewhere.
    const term = ILike(`%${search}%`);
    const searchBase = { ...baseWhere, searchable: true };
    const articles = await this.articlesRepo.find({
      where: [
        { ...searchBase, title: term },
        { ...searchBase, summary: term },
        { ...searchBase, content: term },
      ],
      order,
    });

    // De-duplicate (an article can match more than one OR branch).
    const seen = new Set<string>();
    const unique: HelpArticle[] = [];
    for (const article of articles) {
      if (seen.has(article.id)) continue;
      seen.add(article.id);
      unique.push(article);
    }

    return unique.map((a) => this.toListItem(a));
  }

  async getArticleBySlug(
    slug: string,
    options: { locale?: string; trailSlug?: string } = {},
  ): Promise<{
    article: HelpArticleWithHtml;
    category: HelpCategory | null;
    trails: HelpTrailListItem[];
    related: HelpArticleListItem[];
    navigation: {
      trail: HelpTrailListItem;
      previous: HelpArticleListItem | null;
      next: HelpArticleListItem | null;
    } | null;
  }> {
    const locale = this.resolveLocale(options.locale);
    const found = await this.articlesRepo.findOne({
      where: { slug, locale, status: PUBLISHED },
    });

    if (!found) {
      throw new NotFoundException("Help article not found");
    }

    // Markdown is the canonical stored form; render (and sanitize) to HTML for
    // the reader. Legacy platform HTML is passed through unchanged.
    const article: HelpArticleWithHtml = {
      ...found,
      contentHtml:
        found.contentFormat === "markdown"
          ? markdownToHtml(found.content)
          : found.content,
    };

    const category = article.categoryKey
      ? await this.categoriesRepo.findOne({
          where: { key: article.categoryKey, locale, status: PUBLISHED },
        })
      : null;

    // Trails that include this article.
    const links = await this.trailArticlesRepo.find({
      where: { articleId: article.id },
    });
    const trailIds = links.map((l) => l.trailId);
    const trails = trailIds.length
      ? await this.listTrails(locale, trailIds)
      : [];

    // Related: other published articles in the same category.
    const related = article.categoryKey
      ? (
          await this.articlesRepo.find({
            where: {
              categoryKey: article.categoryKey,
              locale,
              status: PUBLISHED,
            },
            order: { sortOrder: "ASC", title: "ASC" },
          })
        )
          .filter((a) => a.id !== article.id)
          .slice(0, 4)
          .map((a) => this.toListItem(a))
      : [];

    // In-trail navigation (previous / next), when opened from a trail.
    let navigation: {
      trail: HelpTrailListItem;
      previous: HelpArticleListItem | null;
      next: HelpArticleListItem | null;
    } | null = null;

    if (options.trailSlug) {
      const trail = await this.trailsRepo.findOne({
        where: { key: options.trailSlug, locale, status: PUBLISHED },
      });
      if (trail) {
        const steps = await this.getTrailSteps(trail.id, locale);
        const index = steps.findIndex((s) => s.id === article.id);
        if (index >= 0) {
          navigation = {
            trail: (await this.listTrails(locale, [trail.id]))[0],
            previous: index > 0 ? steps[index - 1] : null,
            next: index < steps.length - 1 ? steps[index + 1] : null,
          };
        }
      }
    }

    return { article, category, trails, related, navigation };
  }

  async listTrails(
    locale?: string,
    onlyIds?: string[],
  ): Promise<HelpTrailListItem[]> {
    const resolved = this.resolveLocale(locale);
    const trails = await this.trailsRepo.find({
      where: {
        locale: resolved,
        status: PUBLISHED,
        ...(onlyIds && onlyIds.length ? { id: In(onlyIds) } : {}),
      },
      order: { sortOrder: "ASC", title: "ASC" },
    });

    if (!trails.length) return [];

    const links = await this.trailArticlesRepo.find({
      where: { trailId: In(trails.map((t) => t.id)) },
    });

    const countByTrail = new Map<string, number>();
    for (const link of links) {
      countByTrail.set(link.trailId, (countByTrail.get(link.trailId) ?? 0) + 1);
    }

    return trails.map((trail) => ({
      id: trail.id,
      key: trail.key,
      title: trail.title,
      description: trail.description,
      audience: trail.audience,
      estimatedMinutes: trail.estimatedMinutes,
      moduleKey: trail.moduleKey,
      articleCount: countByTrail.get(trail.id) ?? 0,
    }));
  }

  private async getTrailSteps(
    trailId: string,
    locale: string,
  ): Promise<HelpTrailStep[]> {
    const links = await this.trailArticlesRepo.find({
      where: { trailId },
      order: { sortOrder: "ASC" },
    });
    if (!links.length) return [];

    const articles = await this.articlesRepo.find({
      where: { id: In(links.map((l) => l.articleId)), locale, status: PUBLISHED },
    });
    const articleById = new Map(articles.map((a) => [a.id, a]));

    return links
      .map((link) => {
        const article = articleById.get(link.articleId);
        if (!article) return null;
        return {
          ...this.toListItem(article),
          required: link.required,
          trailEstimatedMinutes: link.estimatedMinutes,
        } satisfies HelpTrailStep;
      })
      .filter((s): s is HelpTrailStep => s !== null);
  }

  async getTrailBySlug(
    slug: string,
    locale?: string,
  ): Promise<{ trail: HelpTrail; steps: HelpTrailStep[] }> {
    const resolved = this.resolveLocale(locale);
    const trail = await this.trailsRepo.findOne({
      where: { key: slug, locale: resolved, status: PUBLISHED },
    });

    if (!trail) {
      throw new NotFoundException("Help trail not found");
    }

    const steps = await this.getTrailSteps(trail.id, resolved);
    return { trail, steps };
  }

  async getOverview(locale?: string): Promise<{
    categories: HelpCategory[];
    featured: HelpArticleListItem[];
    trails: HelpTrailListItem[];
  }> {
    const resolved = this.resolveLocale(locale);
    const [categories, trails, featuredArticles] = await Promise.all([
      this.listCategories(resolved),
      this.listTrails(resolved),
      this.articlesRepo.find({
        where: { locale: resolved, status: PUBLISHED, isFeatured: true },
        order: { sortOrder: "ASC", title: "ASC" },
      }),
    ]);

    return {
      categories,
      featured: featuredArticles.map((a) => this.toListItem(a)),
      trails,
    };
  }
}
