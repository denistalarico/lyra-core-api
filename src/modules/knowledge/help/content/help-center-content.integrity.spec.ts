import { HelpCenterContentLoader } from "./help-center-content-loader";
import { markdownToHtml } from "./markdown-to-html";

/**
 * Guards the versioned pt-BR content itself (not the loader logic): the files
 * shipped in `content/help-center` must load cleanly, keep their internal links
 * pointing at real articles and stay inside what the renderer supports.
 */
const { registry, errors, warnings } = new HelpCenterContentLoader().load("pt-BR");
const articles = registry.articles;
const slugs = new Set(articles.map((a) => a.slug));

// OR-DOC (Claude): LF, AG, OR, CA.
const OR_DOC_CLAUDE_KEYS = [
  "leadflow-overview",
  "leadflow-settings-business-mode",
  "leadflow-briefing",
  "leadflow-analytics-reading",
  "agents-overview",
  "agents-create-from-preset",
  "agents-channels-activation",
  "agents-handoff",
  "agents-crm-behavior",
  "operations-room-chat",
  "agents-pause-activate",
  "orion-what-it-does",
  "orion-commands",
  "orion-mentions",
  "orion-privacy-limits",
  "client-area-overview",
  "client-area-invite",
  "client-area-module-levels",
  "client-area-white-label",
  "client-conversations",
];

describe("Help Center content (pt-BR)", () => {
  it("loads every file without errors", () => {
    expect(errors).toEqual([]);
  });

  it("only warns about trail entries whose article is not written yet", () => {
    for (const warning of warnings) {
      expect(warning).toMatch(/^Trail ".+" references unknown article ".+"\.$/);
    }
  });

  it("ships every OR-DOC article of the Claude batch", () => {
    const keys = new Set(articles.map((a) => a.systemKey));
    expect(OR_DOC_CLAUDE_KEYS.filter((key) => !keys.has(key))).toEqual([]);
  });

  it("keeps a published trail from pointing only at missing articles", () => {
    const empty = registry.trails
      .filter((t) => t.status === "published" && t.articles.length === 0)
      .map((t) => t.key);
    expect(empty).toEqual([]);
  });

  it("links only to existing article slugs", () => {
    const broken: string[] = [];
    for (const article of articles) {
      for (const match of article.content.matchAll(/\(\/help\/articles\/([^)\s?#]+)/g)) {
        if (!slugs.has(match[1])) broken.push(`${article.slug} → ${match[1]}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it("avoids indented sub-lists, which the renderer flattens into text", () => {
    const offenders = articles
      .filter((a) => /^[ \t]+(?:[-*]|\d+\.)[ \t]/m.test(a.content.replace(/```[\s\S]*?```/g, "")))
      .map((a) => a.slug);
    expect(offenders).toEqual([]);
  });

  it("renders every article with sanitized, non-empty HTML", () => {
    for (const article of articles) {
      const html = markdownToHtml(article.content);
      expect(html.length).toBeGreaterThan(0);
      expect(html).not.toMatch(/<script/i);
    }
  });
});
