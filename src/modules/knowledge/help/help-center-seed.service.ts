import {
  Injectable,
  Logger,
  OnApplicationBootstrap,
} from "@nestjs/common";
import { InjectRepository } from "@nestjs/typeorm";
import { Repository } from "typeorm";
import {
  HelpArticle,
  HelpCategory,
  HelpTrail,
  HelpTrailArticle,
} from "./entities";
import {
  HelpCenterContentLoader,
  HelpContentLoadResult,
} from "./content/help-center-content-loader";
import {
  HelpArticleSeed,
  HelpCategorySeed,
  HelpContentRegistry,
  HelpTrailSeed,
} from "./content/help-content.types";

export interface HelpSeedSummary {
  categories: { created: number; updated: number; skipped: number };
  trails: { created: number; updated: number; skipped: number };
  articles: { created: number; updated: number; skipped: number };
  missingFromSource: number;
}

export interface HelpSyncResult extends HelpContentLoadResult {
  summary: HelpSeedSummary;
}

const DEFAULT_LOCALE = "pt-BR";

/**
 * Syncs the platform-owned Help Center content (Markdown + JSON files under
 * `content/help-center`) into the global help_* tables.
 *
 * Idempotent, version- and hash-aware:
 *  - categories/trails are upserted by (key, locale) — always reflect the files;
 *  - articles are keyed by (systemKey, locale): inserted when missing, updated
 *    when the file `version` is greater OR the file `contentHash` changed,
 *    otherwise skipped;
 *  - trail↔article links are rebuilt deterministically from the file order;
 *  - articles present in the DB but no longer in the files are NOT deleted; they
 *    are flagged `metadata.missingFromSource = true` (see the limitations note).
 *
 * Runs on application bootstrap so content exists for every tenant without a
 * manual step. Set HELP_CENTER_SEED_ON_BOOT=false to disable the auto-run
 * (e.g. to seed only via `pnpm agency:seed-help-center`).
 */
@Injectable()
export class HelpCenterSeedService implements OnApplicationBootstrap {
  private readonly logger = new Logger(HelpCenterSeedService.name);

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

  async onApplicationBootstrap(): Promise<void> {
    if (process.env.HELP_CENTER_SEED_ON_BOOT === "false") {
      return;
    }

    try {
      const { summary, errors } = await this.loadAndSync();
      if (errors.length) {
        this.logger.warn(
          `Help Center content had ${errors.length} validation issue(s): ${errors.join(" | ")}`,
        );
      }
      this.logger.log(
        `Help Center synced (categories +${summary.categories.created}/~${summary.categories.updated}, ` +
          `trails +${summary.trails.created}/~${summary.trails.updated}, ` +
          `articles +${summary.articles.created}/~${summary.articles.updated}, ` +
          `missing ${summary.missingFromSource}).`,
      );
    } catch (error) {
      // Never block boot on content sync (e.g. migration not yet applied).
      this.logger.warn(
        `Help Center sync skipped: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Loads content from the versioned files and syncs it. This is the single
   * entry point used both on boot and by `pnpm agency:seed-help-center`.
   */
  async loadAndSync(
    locale: string = DEFAULT_LOCALE,
    loader: HelpCenterContentLoader = new HelpCenterContentLoader(),
  ): Promise<HelpSyncResult> {
    const loaded = loader.load(locale);
    const summary = await this.sync(loaded.registry);
    return { ...loaded, summary };
  }

  async sync(registry: HelpContentRegistry): Promise<HelpSeedSummary> {
    const categories = await this.syncCategories(registry.categories);
    const articles = await this.syncArticles(registry.articles);
    const trails = await this.syncTrails(registry.trails);
    const missingFromSource = await this.flagMissing(registry.articles);
    return { categories, trails, articles, missingFromSource };
  }

  private async syncCategories(
    seeds: HelpCategorySeed[],
  ): Promise<HelpSeedSummary["categories"]> {
    const result = { created: 0, updated: 0, skipped: 0 };

    for (const seed of seeds) {
      const existing = await this.categoriesRepo.findOne({
        where: { key: seed.key, locale: seed.locale },
      });

      if (!existing) {
        await this.categoriesRepo.save(
          this.categoriesRepo.create({
            key: seed.key,
            title: seed.title,
            description: seed.description,
            icon: seed.icon,
            color: seed.color,
            productKey: seed.productKey,
            moduleKey: seed.moduleKey,
            sortOrder: seed.order,
            locale: seed.locale,
            status: seed.status,
          }),
        );
        result.created += 1;
        continue;
      }

      this.categoriesRepo.merge(existing, {
        title: seed.title,
        description: seed.description,
        icon: seed.icon,
        color: seed.color,
        productKey: seed.productKey,
        moduleKey: seed.moduleKey,
        sortOrder: seed.order,
        status: seed.status,
      });
      await this.categoriesRepo.save(existing);
      result.updated += 1;
    }

    return result;
  }

  private buildArticleMetadata(seed: HelpArticleSeed): Record<string, unknown> {
    return {
      ...(seed.metadata ?? {}),
      ...(seed.estimatedReadMinutes
        ? { estimatedReadMinutes: seed.estimatedReadMinutes }
        : {}),
      ...(seed.contentHash ? { contentHash: seed.contentHash } : {}),
      // File-sourced articles get provenance; hand-built registries stay clean.
      ...(seed.sourcePath
        ? { sourcePath: seed.sourcePath, lastSyncedAt: new Date().toISOString() }
        : {}),
    };
  }

  private async syncArticles(
    seeds: HelpArticleSeed[],
  ): Promise<HelpSeedSummary["articles"]> {
    const result = { created: 0, updated: 0, skipped: 0 };

    for (const seed of seeds) {
      const metadata = this.buildArticleMetadata(seed);

      const existing = await this.articlesRepo.findOne({
        where: { systemKey: seed.systemKey, locale: seed.locale },
      });

      if (!existing) {
        await this.articlesRepo.save(
          this.articlesRepo.create({
            systemKey: seed.systemKey,
            slug: seed.slug,
            title: seed.title,
            summary: seed.summary,
            content: seed.content,
            contentFormat: seed.contentFormat,
            categoryKey: seed.categoryKey,
            productKey: seed.productKey,
            moduleKey: seed.moduleKey,
            locale: seed.locale,
            version: seed.version,
            sortOrder: seed.order,
            status: seed.status,
            isFeatured: seed.isFeatured,
            searchable: seed.searchable,
            metadata,
          }),
        );
        result.created += 1;
        continue;
      }

      // Update when the file is a newer version OR its content hash changed;
      // otherwise the article is untouched (keeps the sync idempotent).
      const existingHash = (existing.metadata as Record<string, unknown>)
        ?.contentHash as string | undefined;
      const versionNewer = seed.version > existing.version;
      const hashChanged = Boolean(seed.contentHash) && existingHash !== seed.contentHash;

      if (!versionNewer && !hashChanged) {
        result.skipped += 1;
        continue;
      }

      this.articlesRepo.merge(existing, {
        slug: seed.slug,
        title: seed.title,
        summary: seed.summary,
        content: seed.content,
        contentFormat: seed.contentFormat,
        categoryKey: seed.categoryKey,
        productKey: seed.productKey,
        moduleKey: seed.moduleKey,
        version: seed.version,
        sortOrder: seed.order,
        status: seed.status,
        isFeatured: seed.isFeatured,
        searchable: seed.searchable,
        metadata,
      });
      await this.articlesRepo.save(existing);
      result.updated += 1;
    }

    return result;
  }

  private async syncTrails(
    seeds: HelpTrailSeed[],
  ): Promise<HelpSeedSummary["trails"]> {
    const result = { created: 0, updated: 0, skipped: 0 };

    for (const seed of seeds) {
      let trail = await this.trailsRepo.findOne({
        where: { key: seed.key, locale: seed.locale },
      });

      if (!trail) {
        trail = await this.trailsRepo.save(
          this.trailsRepo.create({
            key: seed.key,
            title: seed.title,
            description: seed.description,
            audience: seed.audience,
            estimatedMinutes: seed.estimatedMinutes,
            productKey: seed.productKey,
            moduleKey: seed.moduleKey,
            sortOrder: seed.order,
            locale: seed.locale,
            status: seed.status,
          }),
        );
        result.created += 1;
      } else {
        this.trailsRepo.merge(trail, {
          title: seed.title,
          description: seed.description,
          audience: seed.audience,
          estimatedMinutes: seed.estimatedMinutes,
          productKey: seed.productKey,
          moduleKey: seed.moduleKey,
          sortOrder: seed.order,
          status: seed.status,
        });
        await this.trailsRepo.save(trail);
        result.updated += 1;
      }

      await this.rebuildTrailLinks(trail.id, seed);
    }

    return result;
  }

  private async rebuildTrailLinks(
    trailId: string,
    seed: HelpTrailSeed,
  ): Promise<void> {
    // Resolve referenced articles by systemKey within the trail locale.
    const links: HelpTrailArticle[] = [];
    let order = 0;

    for (const ref of seed.articles) {
      const article = await this.articlesRepo.findOne({
        where: { systemKey: ref.articleKey, locale: seed.locale },
      });
      if (!article) {
        this.logger.warn(
          `Trail "${seed.key}" references unknown article "${ref.articleKey}".`,
        );
        continue;
      }
      links.push(
        this.trailArticlesRepo.create({
          trailId,
          articleId: article.id,
          sortOrder: (order += 10),
          required: ref.required ?? true,
          estimatedMinutes: ref.estimatedMinutes ?? null,
        }),
      );
    }

    // Deterministic rebuild keeps the join idempotent across runs.
    await this.trailArticlesRepo.delete({ trailId });
    if (links.length) {
      await this.trailArticlesRepo.save(links);
    }
  }

  /**
   * Articles that exist in the DB but are no longer present in the source files
   * are flagged (not deleted) so an accidental file removal never silently
   * drops published content. Cleanup is deferred to a future sprint.
   */
  private async flagMissing(seeds: HelpArticleSeed[]): Promise<number> {
    const byLocale = new Map<string, Set<string>>();
    for (const seed of seeds) {
      if (!byLocale.has(seed.locale)) byLocale.set(seed.locale, new Set());
      byLocale.get(seed.locale)!.add(seed.systemKey);
    }

    let flagged = 0;
    for (const [locale, keys] of byLocale) {
      const dbArticles = await this.articlesRepo.find({ where: { locale } });
      for (const orphan of dbArticles) {
        if (keys.has(orphan.systemKey)) continue;
        const metadata = (orphan.metadata as Record<string, unknown>) ?? {};
        if (metadata.missingFromSource === true) continue;
        this.articlesRepo.merge(orphan, {
          metadata: { ...metadata, missingFromSource: true },
        });
        await this.articlesRepo.save(orphan);
        flagged += 1;
      }
    }
    return flagged;
  }
}
