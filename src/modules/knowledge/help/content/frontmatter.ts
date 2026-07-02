/**
 * Minimal, dependency-free YAML frontmatter parser for the Help Center content
 * files. The frontmatter is authored by the platform (not arbitrary user YAML),
 * so we support only the subset our files use:
 *
 *   - `key: value` scalars (string, number, boolean, null);
 *   - quoted strings: `key: "with: colons"` or `key: 'value'`;
 *   - inline arrays: `key: [a, b, c]`;
 *   - block arrays:
 *       key:
 *         - a
 *         - b
 *   - `# comments` on their own line.
 *
 * This intentionally avoids pulling in a YAML dependency (e.g. gray-matter) for
 * a controlled, tiny format. If content ever needs full YAML, swap this for a
 * library — the returned shape (`{ data, content }`) mirrors gray-matter.
 */

export interface ParsedFrontmatter {
  data: Record<string, unknown>;
  content: string;
}

const FRONTMATTER_RE = /^﻿?---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/;

export function parseFrontmatter(raw: string): ParsedFrontmatter {
  const match = raw.match(FRONTMATTER_RE);
  if (!match) {
    return { data: {}, content: raw.replace(/^﻿/, "") };
  }

  const [, block, body] = match;
  return { data: parseBlock(block), content: body.replace(/^\r?\n/, "") };
}

function parseBlock(block: string): Record<string, unknown> {
  const data: Record<string, unknown> = {};
  const lines = block.split(/\r?\n/);

  for (let i = 0; i < lines.length; i += 1) {
    const line = lines[i];
    if (!line.trim() || line.trim().startsWith("#")) continue;

    // Only consider top-level keys (no indentation).
    const keyMatch = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
    if (!keyMatch) continue;

    const key = keyMatch[1];
    const rawValue = keyMatch[2];

    if (rawValue === "") {
      // Possibly a block array on the following indented `- item` lines.
      const items: string[] = [];
      let j = i + 1;
      while (j < lines.length && /^\s+-\s+/.test(lines[j])) {
        items.push(parseScalar(lines[j].replace(/^\s+-\s+/, "").trim()) as string);
        j += 1;
      }
      if (items.length) {
        data[key] = items;
        i = j - 1;
      } else {
        data[key] = null;
      }
      continue;
    }

    data[key] = parseValue(rawValue.trim());
  }

  return data;
}

function parseValue(value: string): unknown {
  // Inline array: [a, b, c]
  if (value.startsWith("[") && value.endsWith("]")) {
    const inner = value.slice(1, -1).trim();
    if (!inner) return [];
    return inner.split(",").map((item) => parseScalar(item.trim()));
  }
  return parseScalar(value);
}

function parseScalar(value: string): unknown {
  // Strip surrounding quotes (single or double).
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  if (value === "true") return true;
  if (value === "false") return false;
  if (value === "null" || value === "~") return null;
  if (value !== "" && !Number.isNaN(Number(value)) && /^-?\d+(\.\d+)?$/.test(value)) {
    return Number(value);
  }
  return value;
}
