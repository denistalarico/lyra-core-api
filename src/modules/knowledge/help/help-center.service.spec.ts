import { NotFoundException } from "@nestjs/common";
import { Repository } from "typeorm";
import { HelpCenterService } from "./help-center.service";
import { HelpCenterSeedService } from "./help-center-seed.service";
import { FakeRepository } from "./help-test-utils";
import {
  HelpArticle,
  HelpCategory,
  HelpTrail,
  HelpTrailArticle,
} from "./entities";
import { HelpContentRegistry } from "./content/help-content.types";

const article = (over: Partial<HelpArticle> & { systemKey: string }) => ({
  contentFormat: "html" as const,
  productKey: "lyra-agency",
  moduleKey: "finance",
  locale: "pt-BR" as const,
  version: 1,
  status: "published",
  searchable: true,
  isFeatured: false,
  summary: "",
  content: "",
  categoryKey: "finance",
  ...over,
});

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
      {
        key: "team",
        title: "Team",
        description: "Equipe",
        icon: "Users",
        color: "#9333ea",
        productKey: "lyra-agency",
        moduleKey: "team",
        order: 2,
        locale: "pt-BR",
        status: "published",
      },
    ],
    articles: [
      {
        systemKey: "a-pc",
        slug: "plano-de-contas",
        title: "Plano de contas",
        summary: "O que é plano de contas",
        content: "<p>O plano de contas organiza as receitas e despesas.</p>",
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
        estimatedReadMinutes: 5,
      },
      {
        systemKey: "a-team",
        slug: "custo-do-time",
        title: "Custo do time",
        summary: "Custo por hora",
        content: "<p>Custo por hora do colaborador.</p>",
        contentFormat: "html",
        categoryKey: "team",
        productKey: "lyra-agency",
        moduleKey: "team",
        locale: "pt-BR",
        version: 1,
        order: 1,
        status: "published",
        isFeatured: false,
        searchable: true,
      },
      {
        systemKey: "a-secret",
        slug: "plano-interno-nao-buscavel",
        title: "Plano interno (não buscável)",
        summary: "Não deve aparecer na busca",
        content: "<p>plano de contas mencionado, mas não buscável.</p>",
        contentFormat: "html",
        categoryKey: "finance",
        productKey: "lyra-agency",
        moduleKey: "finance",
        locale: "pt-BR",
        version: 1,
        order: 5,
        status: "published",
        isFeatured: false,
        searchable: false,
      },
      {
        systemKey: "a-draft",
        slug: "plano-rascunho",
        title: "Plano rascunho",
        summary: "Rascunho não publicado",
        content: "<p>plano de contas em rascunho.</p>",
        contentFormat: "html",
        categoryKey: "finance",
        productKey: "lyra-agency",
        moduleKey: "finance",
        locale: "pt-BR",
        version: 1,
        order: 6,
        status: "draft",
        isFeatured: false,
        searchable: true,
      },
    ],
    trails: [
      {
        key: "trilha-finance",
        title: "Trilha Finance",
        description: "Comece aqui",
        audience: "Todos",
        estimatedMinutes: 10,
        productKey: "lyra-agency",
        moduleKey: "finance",
        order: 1,
        locale: "pt-BR",
        status: "published",
        articles: [{ articleKey: "a-pc" }, { articleKey: "a-team" }],
      },
    ],
  };
}

async function setup() {
  const categories = new FakeRepository<HelpCategory>();
  const trails = new FakeRepository<HelpTrail>();
  const articles = new FakeRepository<HelpArticle>();
  const trailArticles = new FakeRepository<HelpTrailArticle>();

  const seed = new HelpCenterSeedService(
    categories as unknown as Repository<HelpCategory>,
    trails as unknown as Repository<HelpTrail>,
    articles as unknown as Repository<HelpArticle>,
    trailArticles as unknown as Repository<HelpTrailArticle>,
  );
  await seed.sync(buildRegistry());

  const service = new HelpCenterService(
    categories as unknown as Repository<HelpCategory>,
    trails as unknown as Repository<HelpTrail>,
    articles as unknown as Repository<HelpArticle>,
    trailArticles as unknown as Repository<HelpTrailArticle>,
  );

  return { service, articles };
}

describe("HelpCenterService", () => {
  it("lists published categories ordered", async () => {
    const { service } = await setup();
    const categories = await service.listCategories();
    expect(categories.map((c) => c.key)).toEqual(["finance", "team"]);
  });

  it("search returns only official, published, searchable articles", async () => {
    const { service } = await setup();

    const results = await service.listArticles({ search: "plano de contas" });

    // Only a-pc matches: a-secret is not searchable, a-draft is not published.
    expect(results.map((r) => r.systemKey)).toEqual(["a-pc"]);
  });

  it("search ignores non-searchable and draft articles even on a broad term", async () => {
    const { service } = await setup();
    const results = await service.listArticles({ search: "plano" });
    expect(results.map((r) => r.systemKey)).toEqual(["a-pc"]);
  });

  it("opens an article by slug with category, trails and in-trail navigation", async () => {
    const { service } = await setup();

    const result = await service.getArticleBySlug("plano-de-contas", {
      trailSlug: "trilha-finance",
    });

    expect(result.article.systemKey).toBe("a-pc");
    expect(result.category?.key).toBe("finance");
    expect(result.trails.map((t) => t.key)).toContain("trilha-finance");
    expect(result.navigation?.previous).toBeNull();
    expect(result.navigation?.next?.systemKey).toBe("a-team");
  });

  it("opens a trail by slug with ordered steps", async () => {
    const { service } = await setup();
    const { trail, steps } = await service.getTrailBySlug("trilha-finance");
    expect(trail.key).toBe("trilha-finance");
    expect(steps.map((s) => s.systemKey)).toEqual(["a-pc", "a-team"]);
  });

  it("overview exposes featured articles, categories and trails", async () => {
    const { service } = await setup();
    const overview = await service.getOverview();
    expect(overview.categories).toHaveLength(2);
    expect(overview.trails).toHaveLength(1);
    expect(overview.featured.map((a) => a.systemKey)).toEqual(["a-pc"]);
  });

  it("throws when the article slug does not exist", async () => {
    const { service } = await setup();
    await expect(service.getArticleBySlug("nao-existe")).rejects.toBeInstanceOf(
      NotFoundException,
    );
  });

  it("renders markdown content to sanitized HTML in the article detail", async () => {
    const categories = new FakeRepository<HelpCategory>();
    const trails = new FakeRepository<HelpTrail>();
    const articlesRepo = new FakeRepository<HelpArticle>();
    const trailArticles = new FakeRepository<HelpTrailArticle>();

    await articlesRepo.save(
      article({
        systemKey: "md-1",
        slug: "md-artigo",
        title: "Markdown",
        content: "## Seção\n\nUm *texto* com `code`.",
        contentFormat: "markdown",
      }) as HelpArticle,
    );

    const service = new HelpCenterService(
      categories as unknown as Repository<HelpCategory>,
      trails as unknown as Repository<HelpTrail>,
      articlesRepo as unknown as Repository<HelpArticle>,
      trailArticles as unknown as Repository<HelpTrailArticle>,
    );

    const result = await service.getArticleBySlug("md-artigo");
    expect(result.article.contentHtml).toContain("<h2>Seção</h2>");
    expect(result.article.contentHtml).toContain("<em>texto</em>");
    expect(result.article.contentHtml).toContain("<code>code</code>");
  });
});
