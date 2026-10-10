import sanitizeHtml from 'sanitize-html';
import { sanitizeContractHtml } from '../contracts-sanitize';
import { CONTRACT_CLIENT_VARIABLE_CATALOG } from './contract-variable-catalog';

export interface ContractVariableMapping {
  originalText: string;
  variable: string;
  confidence: 'high' | 'medium';
}

export interface ContractAppliedMapping {
  variable: string;
  label: string;
  originalText: string;
  occurrences: number;
}

export interface ContractUnresolvedMapping {
  originalText: string;
  variable: string;
  reason: 'not_found' | 'too_short' | 'unknown_variable' | 'ambiguous';
}

export function escapeContractText(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function plainTextHtml(text: string, headings: string[]): string {
  const headingSet = new Set(headings);
  return text
    .replace(/\r\n?/g, '\n')
    .split(/\n[\t ]*\n+/)
    .map((paragraph) => {
      let body = '';
      let lines: string[] = [];
      const flush = () => {
        if (lines.length)
          body += `<p>${lines.map(escapeContractText).join('<br>')}</p>`;
        lines = [];
      };
      for (const line of paragraph.split('\n')) {
        if (line && headingSet.has(line)) {
          flush();
          body += `<h3>${escapeContractText(line)}</h3>`;
        } else lines.push(line);
      }
      flush();
      return body;
    })
    .join('');
}

/** Never let the model author HTML or change anything but exact literal text. */
export function applyContractVariableMapping(
  source: { sourceText?: string; sourceHtml?: string },
  mapping: { replacements: ContractVariableMapping[]; headings: string[] },
): {
  bodyHtml: string;
  replacements: ContractAppliedMapping[];
  unresolved: ContractUnresolvedMapping[];
} {
  const html = sanitizeContractHtml(
    source.sourceHtml ??
      plainTextHtml(source.sourceText ?? '', mapping.headings),
  );
  const unresolved: ContractUnresolvedMapping[] = [];
  const candidates: ContractAppliedMapping[] = [];
  const catalog = new Map<string, string>(
    CONTRACT_CLIENT_VARIABLE_CATALOG.map((v) => [v.key, v.label]),
  );
  const variablesByText = new Map<string, Set<string>>();
  for (const row of mapping.replacements) {
    const vars = variablesByText.get(row.originalText) ?? new Set<string>();
    vars.add(row.variable);
    variablesByText.set(row.originalText, vars);
  }
  const seen = new Set<string>();
  for (const row of [...mapping.replacements].sort(
    (a, b) => b.originalText.length - a.originalText.length,
  )) {
    const key = JSON.stringify([row.originalText, row.variable]);
    if (seen.has(key)) continue;
    seen.add(key);
    const label = catalog.get(row.variable);
    const reason = !label
      ? 'unknown_variable'
      : row.originalText.length < 3
        ? 'too_short'
        : variablesByText.get(row.originalText)!.size > 1
          ? 'ambiguous'
          : null;
    if (reason) {
      unresolved.push({
        originalText: row.originalText,
        variable: row.variable,
        reason,
      });
      continue;
    }
    candidates.push({
      variable: row.variable,
      label: label!,
      originalText: row.originalText,
      occurrences: 0,
    });
  }

  const replaceSegment = (segment: string): string => {
    for (const candidate of candidates) {
      // Longest-first across the whole node, not merely at the current cursor.
      // Protect newly inserted tokens from all subsequent substitutions.
      segment = segment
        .split(/({{[\s\S]*?}})/g)
        .map((part) => {
          if (part.startsWith('{{')) return part;
          const pieces = part.split(candidate.originalText);
          candidate.occurrences += pieces.length - 1;
          return pieces.join(`{{${candidate.variable}}}`);
        })
        .join('');
    }
    return segment;
  };

  // The first sanitizer canonicalizes entities. Disable decoding on this pass
  // so parser events do not split one text node at each entity reference.
  // Operate on escaped text nodes; attributes and tags never enter here.
  // Keep placeholder state across nodes too (e.g. a bold span inside {{...}}).
  let insidePlaceholder = false;
  const bodyHtml = sanitizeHtml(html, {
    allowedTags: sanitizeHtml.defaults.allowedTags,
    allowedAttributes: false,
    parser: { decodeEntities: false },
    textFilter(text) {
      // Decode only canonical entity escapes, once; matching entity syntax
      // itself (e.g. "amp" in &amp;) would corrupt the visible legal text.
      const entities: Record<string, string> = {
        '&amp;': '&',
        '&lt;': '<',
        '&gt;': '>',
      };
      text = text.replace(/&(amp|lt|gt);/g, (entity) => entities[entity]);
      let result = '';
      for (let i = 0; i < text.length; ) {
        if (insidePlaceholder) {
          const end = text.indexOf('}}', i);
          if (end < 0) {
            result += text.slice(i);
            break;
          }
          result += text.slice(i, end + 2);
          i = end + 2;
          insidePlaceholder = false;
          continue;
        }
        if (text.startsWith('{{', i)) {
          insidePlaceholder = true;
          result += '{{';
          i += 2;
          continue;
        }
        // Never allow a matched excerpt to consume an existing placeholder.
        const nextPlaceholder = text.indexOf('{{', i);
        const end = nextPlaceholder < 0 ? text.length : nextPlaceholder;
        result += replaceSegment(text.slice(i, end));
        i = end;
      }
      return escapeContractText(result);
    },
  });
  for (const candidate of candidates) {
    if (!candidate.occurrences)
      unresolved.push({
        originalText: candidate.originalText,
        variable: candidate.variable,
        reason: 'not_found',
      });
  }
  return {
    bodyHtml: sanitizeContractHtml(bodyHtml),
    replacements: candidates
      .filter((c) => c.occurrences > 0)
      .map(({ variable, label, originalText, occurrences }) => ({
        variable,
        label,
        originalText,
        occurrences,
      })),
    unresolved,
  };
}
