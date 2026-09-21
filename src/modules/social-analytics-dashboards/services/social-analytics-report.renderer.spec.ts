import { parseReportDocument } from '../report-document.contract';
import {
  buildSocialAnalyticsReportHtml,
  type ReportLetterhead,
  type ReportRenderInput,
} from './social-analytics-report.renderer';

const letterhead: ReportLetterhead = {
  agencyName: 'Agência Exemplo',
  agencyDetails: ['CNPJ: 00.000.000/0001-00', 'contato@exemplo.com'],
  agencyLogoUrl: 'https://cdn.exemplo.com/logo.png',
  clientName: 'Cliente Exemplo',
  clientLogoUrl: null,
};

function render(overrides: Partial<ReportRenderInput> = {}): string {
  const document = parseReportDocument({
    version: 1,
    sections: [
      {
        channelLabel: 'Meta Ads',
        title: 'Desempenho pago',
        cards: [
          {
            title: 'Valor gasto',
            description: 'Investimento no período',
            block: {
              kind: 'metric',
              label: 'Valor gasto',
              value: 'R$ 1.234,56',
              detail: null,
              highlighted: true,
            },
          },
        ],
      },
      {
        channelLabel: 'Instagram',
        title: 'Orgânico',
        cards: [
          {
            title: 'Alcance do período',
            description: null,
            block: {
              kind: 'notice',
              message: 'Alcance do período ainda não medido.',
            },
          },
        ],
      },
    ],
  });

  return buildSocialAnalyticsReportHtml({
    title: 'Relatório mensal',
    periodSince: '2026-09-01',
    periodUntil: '2026-09-30',
    pageMode: 'paginated',
    document,
    letterhead,
    generatedAt: new Date('2026-09-21T13:45:00Z'),
    ...overrides,
  });
}

describe('buildSocialAnalyticsReportHtml', () => {
  it('puts the agency above and the client below, per the plan', () => {
    const html = render();

    const agencyAt = html.indexOf('Agência Exemplo');
    const clientAt = html.indexOf('Cliente Exemplo');

    expect(agencyAt).toBeGreaterThan(-1);
    expect(clientAt).toBeGreaterThan(agencyAt);
    expect(html).toContain('https://cdn.exemplo.com/logo.png');
  });

  it('prints the period as calendar days, not as parsed dates', () => {
    // Constructing a Date from 'YYYY-MM-DD' re-anchors it to the runtime zone
    // and can print the day before — the bug §1.3 keeps warning about.
    expect(render()).toContain('01/09/2026 a 30/09/2026');
  });

  it('breaks the page before each channel after the first in paginated mode', () => {
    const html = render({ pageMode: 'paginated' });
    const applied = html.match(/class="section section--break"/g) ?? [];

    // Two sections, one break: before the second only. A trailing break would
    // print a blank final sheet. Matched on the applied class rather than on
    // the bare name, which also appears in the stylesheet that defines it.
    expect(applied).toHaveLength(1);
  });

  it('omits the breaks in continuous mode', () => {
    expect(render({ pageMode: 'continuous' })).not.toContain(
      'class="section section--break"',
    );
  });

  it('prints the empty-state sentence instead of dropping the card', () => {
    // A card the operator placed and cannot find in the PDF reads as the export
    // having lost it; the sentence says plainly there is no number.
    expect(render()).toContain('Alcance do período ainda não medido.');
  });

  it('escapes operator-authored text', () => {
    // Card titles are free text and the document is rendered by a real browser.
    const document = parseReportDocument({
      version: 1,
      sections: [
        {
          channelLabel: 'Meta Ads',
          title: '<script>alert(1)</script>',
          cards: [
            {
              title: '"><img src=x onerror=alert(1)>',
              description: null,
              block: {
                kind: 'metric',
                label: 'x',
                value: '1',
                detail: null,
                highlighted: false,
              },
            },
          ],
        },
      ],
    });

    const html = buildSocialAnalyticsReportHtml({
      title: 'Relatório',
      periodSince: '2026-09-01',
      periodUntil: '2026-09-01',
      pageMode: 'continuous',
      document,
      letterhead,
      generatedAt: new Date('2026-09-21T00:00:00Z'),
    });

    // The payload survives as text and is inert as markup: no unescaped angle
    // bracket or quote means no element and no attribute can be introduced.
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;alert(1)&lt;/script&gt;');
    expect(html).toContain('&quot;&gt;&lt;img src=x onerror=alert(1)&gt;');
  });

  it('draws funnel bands as polygons with plain hex fills', () => {
    // Polygons because Etapa 7 recorded that a clip-path is at the mercy of the
    // print rasteriser; plain hex because a colour function inside an SVG `fill`
    // attribute is the kind of thing that differs between screen and print.
    const document = parseReportDocument({
      version: 1,
      sections: [
        {
          channelLabel: 'Meta Ads',
          title: 'Funil',
          cards: [
            {
              title: 'Funil de conversão',
              description: null,
              block: {
                kind: 'funnel',
                orientation: 'vertical',
                steps: [
                  {
                    label: 'Impressões',
                    value: '1.000',
                    ratio: 1,
                    rate: null,
                    note: null,
                  },
                  {
                    label: 'Cliques',
                    value: '100',
                    ratio: 0.3,
                    rate: '10,0%',
                    note: null,
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const html = buildSocialAnalyticsReportHtml({
      title: 'Relatório',
      periodSince: '2026-09-01',
      periodUntil: '2026-09-30',
      pageMode: 'continuous',
      document,
      letterhead,
      generatedAt: new Date('2026-09-21T00:00:00Z'),
    });

    expect(html).toContain('<polygon');
    expect(html).toMatch(/fill="#[0-9a-f]{6}"/);
    expect(html).not.toContain('color-mix');
    // The numbers live in the list beside the shape, so a text extractor gets
    // values rather than a picture of them.
    expect(html).toContain('Taxa vs. etapa anterior: 10,0%');
  });

  it('keeps cards from splitting across the fold', () => {
    const html = render();

    expect(html).toContain('break-inside: avoid');
    expect(html).toContain('page-break-inside: avoid');
  });

  it('renders without a client when the report is agency-scoped', () => {
    const html = render({
      letterhead: { ...letterhead, clientName: null, clientLogoUrl: null },
    });

    expect(html).not.toContain('Cliente Exemplo');
    expect(html).toContain('Agência Exemplo');
  });

  it('embeds an inlined client logo as-is', () => {
    // The Brand Kit logo arrives as a `data:` URI because Playwright renders
    // with no session and could not fetch the authenticated endpoint. The
    // renderer must not rewrite it into something resolvable.
    const dataUri = `data:image/png;base64,${Buffer.from('LOGO').toString('base64')}`;
    const html = render({
      letterhead: { ...letterhead, clientLogoUrl: dataUri },
    });

    expect(html).toContain(`src="${dataUri}"`);
  });

  it('renders the client name with no mark when the kit has no logo', () => {
    const html = render({
      letterhead: { ...letterhead, clientLogoUrl: null },
    });

    expect(html).toContain('Cliente Exemplo');
    expect(html).not.toContain('class="client-logo"');
  });
});
