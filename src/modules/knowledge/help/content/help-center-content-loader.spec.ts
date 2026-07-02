import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";
import { HelpCenterContentLoader } from "./help-center-content-loader";

let root: string;

function write(relPath: string, content: string): void {
  const full = join(root, relPath);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
}

function article(fields: Record<string, unknown>, body = "## Corpo\n\nTexto."): string {
  const fm = Object.entries(fields)
    .map(([k, v]) => {
      if (Array.isArray(v)) return `${k}: [${v.join(", ")}]`;
      if (typeof v === "string") return `${k}: "${v}"`;
      return `${k}: ${String(v)}`;
    })
    .join("\n");
  return `---\n${fm}\n---\n\n${body}`;
}

const CATEGORIES = JSON.stringify([
  { key: "finance", title: "Finance", order: 1, locale: "pt-BR", status: "published" },
]);

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "help-content-"));
  mkdirSync(join(root, "pt-BR"), { recursive: true });
  write("pt-BR/categories.json", CATEGORIES);
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

function load() {
  return new HelpCenterContentLoader(root).load("pt-BR");
}

describe("HelpCenterContentLoader", () => {
  it("finds markdown files, parses frontmatter and computes hash + sourcePath", () => {
    write(
      "pt-BR/trails.json",
      JSON.stringify([
        {
          key: "t1",
          title: "T1",
          order: 1,
          locale: "pt-BR",
          status: "published",
          articleKeys: ["a-1"],
        },
      ]),
    );
    write(
      "pt-BR/finance/001-a.md",
      article({
        systemKey: "a-1",
        slug: "artigo-1",
        title: "Artigo 1",
        summary: "Resumo",
        categoryKey: "finance",
        trailKeys: ["t1"],
        order: 1,
        version: 1,
        locale: "pt-BR",
        status: "published",
        estimatedMinutes: 5,
      }),
    );

    const { registry, errors, warnings } = load();
    expect(errors).toEqual([]);
    expect(warnings).toEqual([]);
    expect(registry.articles).toHaveLength(1);

    const a = registry.articles[0];
    expect(a.systemKey).toBe("a-1");
    expect(a.contentFormat).toBe("markdown");
    expect(a.content).toContain("## Corpo");
    expect(a.estimatedReadMinutes).toBe(5);
    expect(a.contentHash).toMatch(/^[a-f0-9]{64}$/);
    expect(a.sourcePath).toBe("content/help-center/pt-BR/finance/001-a.md");
    expect(a.trailKeys).toEqual(["t1"]);
  });

  it("reports missing required fields and skips the article", () => {
    write(
      "pt-BR/trails.json",
      JSON.stringify([]),
    );
    // Missing `summary` and `slug`.
    write(
      "pt-BR/finance/bad.md",
      article({
        systemKey: "bad",
        title: "Sem campos",
        categoryKey: "finance",
        trailKeys: [],
        order: 1,
        version: 1,
        locale: "pt-BR",
        status: "published",
      }),
    );

    const { registry, errors } = load();
    expect(registry.articles).toHaveLength(0);
    expect(errors.some((e) => e.includes("missing required field"))).toBe(true);
  });

  it("skips an article with an unknown categoryKey and reports a clear error", () => {
    write("pt-BR/trails.json", JSON.stringify([]));
    write(
      "pt-BR/x/ghost.md",
      article({
        systemKey: "ghost",
        slug: "fantasma",
        title: "Fantasma",
        summary: "sem categoria válida",
        categoryKey: "does-not-exist",
        trailKeys: [],
        order: 1,
        version: 1,
        locale: "pt-BR",
        status: "published",
      }),
    );

    const { registry, errors } = load();
    expect(registry.articles).toHaveLength(0);
    expect(errors.some((e) => e.includes('unknown categoryKey "does-not-exist"'))).toBe(
      true,
    );
  });

  it("builds trail article refs in the order declared by trails.json", () => {
    write(
      "pt-BR/trails.json",
      JSON.stringify([
        {
          key: "t1",
          title: "T1",
          order: 1,
          locale: "pt-BR",
          status: "published",
          articleKeys: ["a-2", "a-1"],
        },
      ]),
    );
    for (const [key, order] of [
      ["a-1", 1],
      ["a-2", 2],
    ] as const) {
      write(
        `pt-BR/finance/${key}.md`,
        article({
          systemKey: key,
          slug: key,
          title: key,
          summary: "s",
          categoryKey: "finance",
          trailKeys: ["t1"],
          order,
          version: 1,
          locale: "pt-BR",
          status: "published",
        }),
      );
    }

    const { registry, warnings } = load();
    const trail = registry.trails.find((t) => t.key === "t1");
    expect(trail?.articles.map((a) => a.articleKey)).toEqual(["a-2", "a-1"]);
    expect(warnings).toEqual([]);
  });

  it("reports duplicate systemKeys instead of silently overwriting", () => {
    write("pt-BR/trails.json", JSON.stringify([]));
    const common = {
      systemKey: "dup",
      title: "Dup",
      summary: "s",
      categoryKey: "finance",
      trailKeys: [],
      order: 1,
      version: 1,
      locale: "pt-BR",
      status: "published",
    };
    write("pt-BR/finance/one.md", article({ ...common, slug: "one" }));
    write("pt-BR/finance/two.md", article({ ...common, slug: "two" }));

    const { registry, errors } = load();
    expect(registry.articles).toHaveLength(1);
    expect(errors.some((e) => e.includes("duplicate systemKey"))).toBe(true);
  });
});
