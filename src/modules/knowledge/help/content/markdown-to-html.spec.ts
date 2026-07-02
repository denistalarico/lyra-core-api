import { markdownToHtml } from "./markdown-to-html";

describe("markdownToHtml", () => {
  it("renders headings, paragraphs and inline emphasis", () => {
    const html = markdownToHtml("## Título\n\nTexto com **negrito** e *itálico*.");
    expect(html).toContain("<h2>Título</h2>");
    expect(html).toContain("<strong>negrito</strong>");
    expect(html).toContain("<em>itálico</em>");
    expect(html).toContain("<p>Texto com");
  });

  it("renders unordered and ordered lists", () => {
    expect(markdownToHtml("- a\n- b")).toBe("<ul><li>a</li><li>b</li></ul>");
    expect(markdownToHtml("1. um\n2. dois")).toBe(
      "<ol><li>um</li><li>dois</li></ol>",
    );
  });

  it("renders GFM pipe tables with inline formatting in cells", () => {
    const html = markdownToHtml(
      "| A | B |\n| --- | --- |\n| **x** | y |",
    );
    expect(html).toContain("<table>");
    expect(html).toContain("<th>A</th>");
    expect(html).toContain("<td><strong>x</strong></td>");
  });

  it("renders blockquotes and internal/external links", () => {
    expect(markdownToHtml("> nota")).toBe(
      "<blockquote><p>nota</p></blockquote>",
    );
    const links = markdownToHtml(
      "[interno](/knowledge/help) e [externo](https://x.com)",
    );
    expect(links).toContain('<a href="/knowledge/help">interno</a>');
    // External links get target/rel added.
    expect(links).toContain('target="_blank"');
    expect(links).toContain('rel="noopener noreferrer"');
  });

  it("keeps inline code literal and never treats numbers as code placeholders", () => {
    const html = markdownToHtml("veja `system_key` nos top 5 itens");
    expect(html).toContain("<code>system_key</code>");
    expect(html).toContain("top 5 itens");
    // The "5" must survive as text, not be swallowed by a placeholder.
    expect(html).not.toContain("<code>5</code>");
  });

  it("escapes HTML inside fenced code blocks (no script injection)", () => {
    const html = markdownToHtml("```\n<script>alert(1)</script>\n```");
    expect(html).toContain("<pre><code>");
    expect(html).toContain("&lt;script&gt;");
    expect(html).not.toContain("<script>");
  });

  it("neutralizes dangerous raw HTML by escaping it to inert text", () => {
    const html = markdownToHtml('Texto <img src=x onerror="alert(1)"> fim');
    // No active element is produced — the tag is rendered as visible text.
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });

  it("strips a raw <script> block instead of executing it", () => {
    const html = markdownToHtml("<script>alert(1)</script>\n\noi");
    expect(html).not.toContain("<script>");
  });
});
