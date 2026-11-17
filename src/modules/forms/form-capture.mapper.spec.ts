import {
  isCaptureOriginAllowed,
  normalizeCapture,
  parseCapturePayload,
  resolveCaptureTarget,
  summarizeCapturedFields,
} from './form-capture.mapper';
import type { CapturedField } from './forms.types';

const field = (
  key: string,
  value: string,
  extra: Partial<CapturedField> = {},
): CapturedField => ({
  key,
  value,
  label: null,
  type: 'text',
  autocomplete: null,
  hint: null,
  ...extra,
});

describe('parseCapturePayload', () => {
  it('drops sensitive, hidden and empty inputs and merges repeated names', () => {
    const parsed = parseCapturePayload(
      JSON.stringify({
        fields: [
          { key: 'nome', value: ' Ana ' },
          { key: 'password', type: 'password', value: 'x' },
          { key: 'cc-number', value: '4111' },
          { key: '_wpnonce', value: 'abc' },
          { key: 'csrf_token', value: 'abc' },
          { key: 'interesse[]', type: 'checkbox', value: 'SEO' },
          { key: 'interesse[]', type: 'checkbox', value: 'Ads' },
          { key: 'vazio', value: '   ' },
          { key: 'ref', type: 'hidden', value: 'x' },
        ],
        nonce: 'bad nonce!',
        elapsedMs: -1,
      }),
    );
    expect(parsed.fields.map((f) => [f.key, f.value])).toEqual([
      ['nome', 'Ana'],
      ['interesse[]', 'SEO, Ads'],
    ]);
    expect(parsed.nonce).toBeNull();
    expect(parsed.elapsedMs).toBeNull();
  });

  it('throws on non-JSON or missing fields', () => {
    expect(() => parseCapturePayload('x')).toThrow();
    expect(() => parseCapturePayload('{"a":1}')).toThrow();
  });
});

describe('resolveCaptureTarget', () => {
  it.each([
    [field('your-email', 'a@b.co'), 'contact.email'],
    [field('campo1', 'a', { type: 'email' }), 'contact.email'],
    [field('input_3', 'x', { autocomplete: 'section-x tel' }), 'contact.phone'],
    [field('whatsapp', '1199'), 'contact.phone'],
    [field('company_name', 'ACME'), 'contact.company'],
    [field('nome_completo', 'Ana'), 'contact.name'],
    [field('input_9', 'Ana', { label: 'Seu nome' }), 'contact.name'],
    [field('mensagem', 'oi'), 'opportunity.notes'],
    [field('input_7', 'x'), 'none'],
    [field('input_7', 'x', { hint: 'company' }), 'contact.company'],
  ])('%o → %s', (input, target) => {
    expect(resolveCaptureTarget(input).target).toBe(target);
  });

  it('the saved mapping wins over every guess', () => {
    expect(
      resolveCaptureTarget(field('your-email', 'a@b.co'), {
        'your-email': 'ignore',
      }),
    ).toEqual({ target: 'ignore', source: 'map' });
  });
});

describe('normalizeCapture', () => {
  it('joins name parts, keeps notes out of the summary and skips ignored fields', () => {
    const result = normalizeCapture(
      [
        field('first_name', 'Ana'),
        field('last_name', 'Souza'),
        field('email', 'ANA@X.COM'),
        field('telefone', '(11) 98888-7777'),
        field('mensagem', 'Quero orçamento'),
        field('origem', 'Google', { label: 'Como nos conheceu?' }),
        field('lixo', 'x'),
      ],
      { lixo: 'ignore' },
    );
    expect(result.lead).toEqual({
      name: 'Ana Souza',
      email: 'ana@x.com',
      phone: '+5511988887777',
      company: null,
      position: null,
    });
    expect(result.opportunity.notes).toBe('Quero orçamento');
    expect(result.summaryLines).toContain('Como nos conheceu?: Google');
    expect(result.summaryLines.join('\n')).not.toContain('Quero orçamento');
    expect(result.values).not.toHaveProperty('lixo');
  });
});

describe('summarizeCapturedFields', () => {
  it('counts each field across captures with its current target', () => {
    const rows = [
      { fields: [field('input_1', 'Ana'), field('email', 'a@b.co')] },
      { fields: [field('input_1', 'Bia')] },
      {},
    ];
    const summary = summarizeCapturedFields(rows, { input_1: 'contact.name' });
    expect(summary).toEqual([
      expect.objectContaining({
        key: 'input_1',
        count: 2,
        target: 'contact.name',
        source: 'map',
        sample: 'Ana',
      }),
      expect.objectContaining({
        key: 'email',
        count: 1,
        target: 'contact.email',
        source: 'auto',
      }),
    ]);
  });
});

describe('isCaptureOriginAllowed', () => {
  it('empty list allows any site; otherwise Origin, then Referer, must match', () => {
    expect(isCaptureOriginAllowed(null, null, [])).toBe(true);
    expect(
      isCaptureOriginAllowed('https://site.com.br', null, ['site.com.br']),
    ).toBe(true);
    expect(
      isCaptureOriginAllowed('https://www.site.com.br', null, ['site.com.br']),
    ).toBe(false);
    expect(
      isCaptureOriginAllowed('https://www.site.com.br', null, [
        '*.site.com.br',
      ]),
    ).toBe(true);
    expect(
      isCaptureOriginAllowed('https://site.com.br', null, ['*.site.com.br']),
    ).toBe(true);
    expect(
      isCaptureOriginAllowed('null', 'https://lp.site.com.br/x', [
        '*.site.com.br',
      ]),
    ).toBe(true);
    expect(
      isCaptureOriginAllowed('https://evilsite.com.br', null, [
        '*.site.com.br',
      ]),
    ).toBe(false);
    expect(isCaptureOriginAllowed(null, null, ['site.com.br'])).toBe(false);
  });
});
