import { applyContractVariableMapping } from './contract-ai-assist-apply';

const replacement = (originalText: string, variable = 'client.name') => ({
  originalText,
  variable,
  confidence: 'high' as const,
});

describe('applyContractVariableMapping', () => {
  it('does not match substrings of entity encodings', () => {
    const result = applyContractVariableMapping(
      { sourceHtml: '<p>A &amp; B &lt; C</p>' },
      {
        headings: [],
        replacements: [replacement('amp')],
      },
    );
    expect(result.bodyHtml).toBe('<p>A &amp; B &lt; C</p>');
    expect(result.unresolved[0].reason).toBe('not_found');
  });

  it('gives longer excerpts priority even when a shorter overlapping excerpt starts earlier', () => {
    const result = applyContractVariableMapping(
      { sourceText: 'ABCDEFG' },
      {
        headings: [],
        replacements: [
          replacement('ABCDE'),
          replacement('BCDEFG', 'client.legalName'),
        ],
      },
    );
    expect(result.bodyHtml).toBe('<p>A{{client.legalName}}</p>');
    expect(result.unresolved).toContainEqual({
      originalText: 'ABCDE',
      variable: 'client.name',
      reason: 'not_found',
    });
  });

  it('escapes plain text, preserves paragraphs and makes only literal heading lines h3', () => {
    const result = applyContractVariableMapping(
      { sourceText: 'TÍTULO\nA & B <script>\n\nFim.' },
      {
        headings: ['TÍTULO', 'Inventado'],
        replacements: [],
      },
    );
    expect(result.bodyHtml).toBe(
      '<h3>TÍTULO</h3><p>A &amp; B &lt;script&gt;</p><p>Fim.</p>',
    );
  });

  it('applies longer matches first, counts every occurrence and never remaps inserted tokens', () => {
    const result = applyContractVariableMapping(
      { sourceText: 'ACME Brasil e ACME. ACME Brasil.' },
      {
        headings: [],
        replacements: [
          replacement('ACME'),
          replacement('ACME Brasil', 'client.legalName'),
          replacement('client.name'),
        ],
      },
    );
    expect(result.bodyHtml).toBe(
      '<p>{{client.legalName}} e {{client.name}}. {{client.legalName}}.</p>',
    );
    expect(result.replacements.map((r) => r.occurrences)).toEqual([2, 1]);
    expect(result.unresolved).toContainEqual({
      originalText: 'client.name',
      variable: 'client.name',
      reason: 'not_found',
    });
  });

  it('changes only text nodes, preserving attributes and existing placeholders', () => {
    const result = applyContractVariableMapping(
      {
        sourceHtml:
          '<p class="ACME">{{client.name}} ACME <a href="https://ACME.test">ACME</a></p>',
      },
      {
        headings: [],
        replacements: [replacement('ACME'), replacement('client.name')],
      },
    );
    expect(result.bodyHtml).toBe(
      '<p class="ACME">{{client.name}} {{client.name}} <a href="https://ACME.test">{{client.name}}</a></p>',
    );
    expect(result.replacements[0].occurrences).toBe(2);
  });

  it('matches decoded entities literally and does not span markup', () => {
    const result = applyContractVariableMapping(
      { sourceHtml: '<p>A &amp; B e AC<strong>ME</strong></p>' },
      {
        headings: [],
        replacements: [replacement('A & B'), replacement('ACME')],
      },
    );
    expect(result.bodyHtml).toBe(
      '<p>{{client.name}} e AC<strong>ME</strong></p>',
    );
    expect(result.unresolved[0].reason).toBe('not_found');
  });

  it('ignores short matches and rejects invented variable keys without modifying the legal text', () => {
    const result = applyContractVariableMapping(
      { sourceText: 'AB ACME' },
      {
        headings: [],
        replacements: [
          replacement('AB'),
          replacement('ACME', 'invented.value'),
        ],
      },
    );
    expect(result.bodyHtml).toBe('<p>AB ACME</p>');
    expect(result.unresolved.map((r) => r.reason).sort()).toEqual(
      ['too_short', 'unknown_variable'].sort(),
    );
  });

  it('sanitizes dangerous HTML and never replaces content removed by the sanitizer', () => {
    const result = applyContractVariableMapping(
      {
        sourceHtml:
          '<script>ACME</script><p onclick="bad()">Seguro</p><a href="javascript:bad()">Link</a>',
      },
      {
        headings: [],
        replacements: [replacement('ACME')],
      },
    );
    expect(result.bodyHtml).toBe('<p>Seguro</p><a>Link</a>');
    expect(result.unresolved[0].reason).toBe('not_found');
  });

  it('protects existing placeholders that span text nodes', () => {
    const result = applyContractVariableMapping(
      { sourceHtml: '<p>{{client.<strong>name</strong>}} ACME</p>' },
      {
        headings: [],
        replacements: [replacement('name'), replacement('ACME')],
      },
    );
    expect(result.bodyHtml).toBe(
      '<p>{{client.<strong>name</strong>}} {{client.name}}</p>',
    );
  });
});
