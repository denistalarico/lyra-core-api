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
import { HELP_CONTENT_REGISTRY } from "./content/help-content.registry";
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
}

/**
 * Syncs the platform-owned Help Center registry into the global help_* tables.
 *
 * Idempotent and version-aware:
 *  - categories/trails are upserted by (key, locale) — always reflect the registry;
 *  - articles are keyed by (systemKey, locale): inserted when missing, updated only
 *    when the registry `version` is greater than the stored one, otherwise skipped;
 *  - trail↔article links are rebuilt deterministically from the registry order.
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
      const summary = await this.sync();
      this.logger.log(
        `Help Center synced (categories +${summary.categories.created}/~${summary.categories.updated}, ` +
          `trails +${summary.trails.created}/~${summary.trails.updated}, ` +
          `articles +${summary.articles.created}/~${summary.articles.updated}).`,
      );
    } catch (error) {
      // Never block boot on content sync (e.g. migration not yet applied).
      this.logger.warn(
        `Help Center sync skipped: ${(error as Error).message}`,
      );
    }
  }

  async sync(
    registry: HelpContentRegistry = HELP_CONTENT_REGISTRY,
  ): Promise<HelpSeedSummary> {
    const categories = await this.syncCategories(registry.categories);
    const articles = await this.syncArticles(registry.articles);
    const trails = await this.syncTrails(registry.trails);
    return { categories, trails, articles };
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

  private async syncArticles(
    seeds: HelpArticleSeed[],
  ): Promise<HelpSeedSummary["articles"]> {
    const result = { created: 0, updated: 0, skipped: 0 };

    for (const seed of seeds) {
      const metadata = {
        ...(seed.metadata ?? {}),
        ...(seed.estimatedReadMinutes
          ? { estimatedReadMinutes: seed.estimatedReadMinutes }
          : {}),
      };

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

      // Version-aware: only overwrite when the registry is newer.
      if (existing.version >= seed.version) {
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
}
