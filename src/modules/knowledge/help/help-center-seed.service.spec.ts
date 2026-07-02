import { Repository } from "typeorm";
import { HelpCenterSeedService } from "./help-center-seed.service";
import { FakeRepository } from "./help-test-utils";
import {
  HelpArticle,
  HelpCategory,
  HelpTrail,
  HelpTrailArticle,
} from "./entities";
import { HelpContentRegistry } from "./content/help-content.types";

function buildRegistry(): HelpContentRegistry {
  return {
    categories: [
      {
        key: "finance",
        title: "Finance",
        description: "Finanças",
        icon: "Wallet",
        color: "#16a34a",
        productKey: "lyra-agency",
        moduleKey: "finance",
        order: 1,
        locale: "pt-BR",
        status: "published",
      },
    ],
    articles: [
      {
        systemKey: "a-1",
        slug: "artigo-1",
        title: "Artigo 1",
        summary: "Resumo 1",
        content: "<p>Conteúdo 1</p>",
        contentFormat: "html",
        categoryKey: "finance",
        productKey: "lyra-agency",
        moduleKey: "finance",
        locale: "pt-BR",
        version: 1,
        order: 1,
        status: "published",
        isFeatured: true,
        searchable: true,
        estimatedReadMinutes: 4,
      },
      {
        systemKey: "a-2",
        slug: "artigo-2",
        title: "Artigo 2",
        summary: "Resumo 2",
        content: "<p>Conteúdo 2</p>",
        contentFormat: "html",
        categoryKey: "finance",
        productKey: "lyra-agency",
        moduleKey: "finance",
        locale: "pt-BR",
        version: 1,
        order: 2,
        status: "published",
        isFeatured: false,
        searchable: true,
      },
    ],
    trails: [
      {
        key: "trilha-1",
        title: "Trilha 1",
        description: "Trilha de teste",
        audience: "Todos",
        estimatedMinutes: 10,
        productKey: "lyra-agency",
        moduleKey: "finance",
        order: 1,
        locale: "pt-BR",
        status: "published",
        articles: [{ articleKey: "a-1" }, { articleKey: "a-2" }],
      },
    ],
  };
}

function makeService() {
  const categories = new FakeRepository<HelpCategory>();
  const trails = new FakeRepository<HelpTrail>();
  const articles = new FakeRepository<HelpArticle>();
  const trailArticles = new FakeRepository<HelpTrailArticle>();
  const service = new HelpCenterSeedService(
    categories as unknown as Repository<HelpCategory>,
    trails as unknown as Repository<HelpTrail>,
    articles as unknown as Repository<HelpArticle>,
    trailArticles as unknown as Repository<HelpTrailArticle>,
  );
  return { service, categories, trails, articles, trailArticles };
}

describe("HelpCenterSeedService", () => {
  it("creates the full registry on first sync", async () => {
    const { service, categories, trails, articles, trailArticles } =
      makeService();

    const summary = await service.sync(buildRegistry());

    expect(summary.categories).toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(summary.articles).toEqual({ created: 2, updated: 0, skipped: 0 });
    expect(summary.trails).toEqual({ created: 1, updated: 0, skipped: 0 });
    expect(categories.rows).toHaveLength(1);
    expect(articles.rows).toHaveLength(2);
    expect(trails.rows).toHaveLength(1);
    expect(trailArticles.rows).toHaveLength(2);
    // estimatedReadMinutes folded into metadata.
    expect(articles.rows[0].metadata).toEqual({ estimatedReadMinutes: 4 });
  });

  it("is idempotent: a second sync duplicates nothing and skips same-version articles", async () => {
    const { service, articles, trailArticles } = makeService();
    const registry = buildRegistry();

    await service.sync(registry);
    const summary = await service.sync(registry);

    expect(summary.articles).toEqual({ created: 0, updated: 0, skipped: 2 });
    expect(summary.categories.updated).toBe(1);
    expect(summary.trails.updated).toBe(1);
    expect(articles.rows).toHaveLength(2);
    // Links are rebuilt deterministically — no duplicates accumulate.
    expect(trailArticles.rows).toHaveLength(2);
  });

  it("updates an article only when the registry version increases", async () => {
    const { service, articles } = makeService();
    const registry = buildRegistry();

    await service.sync(registry);

    registry.articles[0].version = 2;
    registry.articles[0].content = "<p>Conteúdo 1 revisado</p>";
    const summary = await service.sync(registry);

    expect(summary.articles.updated).toBe(1);
    expect(summary.articles.skipped).toBe(1);
    const updated = articles.rows.find((a) => a.systemKey === "a-1");
    expect(updated?.version).toBe(2);
    expect(updated?.content).toBe("<p>Conteúdo 1 revisado</p>");
  });

  it("stores contentHash / sourcePath / lastSyncedAt for file-sourced articles", async () => {
    const { service, articles } = makeService();
    const registry = buildRegistry();
    registry.articles[0].contentHash = "hash-a1";
    registry.articles[0].sourcePath = "content/help-center/pt-BR/finance/a1.md";

    await service.sync(registry);

    const meta = articles.rows.find((a) => a.systemKey === "a-1")
      ?.metadata as Record<string, unknown>;
    expect(meta.contentHash).toBe("hash-a1");
    expect(meta.sourcePath).toBe("content/help-center/pt-BR/finance/a1.md");
    expect(typeof meta.lastSyncedAt).toBe("string");
  });

  it("re-syncs an article when the contentHash changes at the same version", async () => {
    const { service, articles } = makeService();
    const registry = buildRegistry();
    registry.articles[0].contentHash = "hash-v1";

    await service.sync(registry);

    // Same version, edited body -> new hash -> must update.
    registry.articles[0].contentHash = "hash-v2";
    registry.articles[0].content = "<p>editado</p>";
    const summary = await service.sync(registry);

    expect(summary.articles.updated).toBe(1);
    const a1 = articles.rows.find((a) => a.systemKey === "a-1");
    expect(a1?.content).toBe("<p>editado</p>");
    expect((a1?.metadata as Record<string, unknown>).contentHash).toBe("hash-v2");
  });

  it("is idempotent for hashed articles: no change means skipped", async () => {
    const { service } = makeService();
    const registry = buildRegistry();
    registry.articles.forEach((a, i) => (a.contentHash = `h-${i}`));

    await service.sync(registry);
    const summary = await service.sync(registry);

    expect(summary.articles).toEqual({ created: 0, updated: 0, skipped: 2 });
  });

  it("flags DB articles no longer present in the source (never deletes)", async () => {
    const { service, articles } = makeService();
    const registry = buildRegistry();

    await service.sync(registry);
    expect(articles.rows).toHaveLength(2);

    // Drop a-2 from the source; a-1 stays.
    registry.articles = registry.articles.filter((a) => a.systemKey === "a-1");
    registry.trails[0].articles = [{ articleKey: "a-1" }];
    const summary = await service.sync(registry);

    expect(summary.missingFromSource).toBe(1);
    expect(articles.rows).toHaveLength(2); // not deleted
    const orphan = articles.rows.find((a) => a.systemKey === "a-2");
    expect((orphan?.metadata as Record<string, unknown>).missingFromSource).toBe(true);
    const kept = articles.rows.find((a) => a.systemKey === "a-1");
    expect((kept?.metadata as Record<string, unknown>).missingFromSource).toBeUndefined();
  });
});
