import { sanitizeContractHtml } from './contracts-sanitize';

describe('sanitizeContractHtml', () => {
  it('strips script tags while keeping safe markup', () => {
    const input = '<script>window.__xss = true</script><p>Ok</p>';

    const result = sanitizeContractHtml(input);

    expect(result).not.toContain('<script');
    expect(result).not.toContain('__xss');
    expect(result).toContain('<p>Ok</p>');
  });

  it('strips inline event handlers and disallowed tags', () => {
    const input = '<img src="x" onerror="alert(1)" /><iframe src="https://evil.example"></iframe><p>Texto</p>';

    const result = sanitizeContractHtml(input);

    expect(result).not.toContain('onerror');
    expect(result).not.toContain('<img');
    expect(result).not.toContain('<iframe');
    expect(result).toContain('<p>Texto</p>');
  });

  it('blocks javascript: and data: URLs on links', () => {
    const input = '<a href="javascript:alert(1)">click</a><a href="data:text/html,evil">click2</a>';

    const result = sanitizeContractHtml(input);

    expect(result).not.toContain('javascript:');
    expect(result).not.toContain('data:text/html');
  });

  it('keeps allowed structural tags used by the Tiptap editor', () => {
    const input =
      '<h1>Titulo</h1><p><strong>Negrito</strong> e <em>italico</em></p>' +
      '<table><tbody><tr><td>Celula</td></tr></tbody></table>' +
      '<a href="https://example.com" target="_blank" rel="noopener">link</a>';

    const result = sanitizeContractHtml(input);

    expect(result).toContain('<h1>Titulo</h1>');
    expect(result).toContain('<strong>Negrito</strong>');
    expect(result).toContain('<table>');
    expect(result).toContain('<td>Celula</td>');
    expect(result).toContain('href="https://example.com"');
  });

  it('returns an empty string for null/undefined input', () => {
    expect(sanitizeContractHtml(null)).toBe('');
    expect(sanitizeContractHtml(undefined)).toBe('');
  });
});
