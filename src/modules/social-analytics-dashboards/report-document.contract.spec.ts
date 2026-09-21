import {
  parseReportDocument,
  ReportDocumentError,
  type ReportFunnelBlock,
  type ReportInsightBlock,
  type ReportMetricBlock,
  type ReportTableBlock,
} from './report-document.contract';

function document(overrides: Record<string, unknown> = {}) {
  return {
    version: 1,
    sections: [
      {
        channelLabel: 'Meta Ads',
        title: 'Desempenho pago',
        cards: [
          {
            title: 'Valor gasto',
            description: null,
            block: {
              kind: 'metric',
              label: 'Valor gasto',
              value: 'R$ 1.234,56',
              detail: null,
              highlighted: false,
            },
          },
        ],
      },
    ],
    ...overrides,
  };
}

function sectionsWith(block: Record<string, unknown>) {
  return document({
    sections: [
      {
        channelLabel: 'Meta Ads',
        title: 'Seção',
        cards: [{ title: 'Card', description: null, block }],
      },
    ],
  });
}

describe('parseReportDocument', () => {
  it('accepts a well-formed document', () => {
    const parsed = parseReportDocument(document());

    expect(parsed.version).toBe(1);
    expect(parsed.sections).toHaveLength(1);
    expect(parsed.sections[0].cards[0].block.kind).toBe('metric');
  });

  it('refuses a version it does not understand', () => {
    // A document written by a newer build may contain block kinds this renderer
    // has never seen; interpreting it would print something nobody authored.
    expect(() => parseReportDocument(document({ version: 2 }))).toThrow(
      ReportDocumentError,
    );
  });

  it('refuses a document with no sections', () => {
    expect(() => parseReportDocument(document({ sections: [] }))).toThrow(
      ReportDocumentError,
    );
  });

  it('refuses an unknown block kind', () => {
    expect(() =>
      parseReportDocument(sectionsWith({ kind: 'sparkline' })),
    ).toThrow(ReportDocumentError);
  });

  it('keeps the formatted value verbatim rather than re-deriving it', () => {
    // The load-bearing property of this whole etapa: the report shows what the
    // card showed. A parser that coerced the string to a number and re-formatted
    // it would be free to disagree with the dashboard it came from.
    const parsed = parseReportDocument(
      sectionsWith({
        kind: 'metric',
        label: 'Alcance do período',
        value: '1.234',
        detail: 'Medido em 2026-09-20',
        highlighted: true,
      }),
    );

    const block = parsed.sections[0].cards[0].block as ReportMetricBlock;

    expect(block.value).toBe('1.234');
    expect(block.detail).toBe('Medido em 2026-09-20');
    expect(block.highlighted).toBe(true);
  });

  it('keeps an empty-state sentence as the reading it is', () => {
    // "não medido" is a reading, not a missing value. Dropping it here would
    // leave the PDF with a bare em dash, which reads as zero — the exact failure
    // §2.1 of the plan exists to prevent.
    const parsed = parseReportDocument(
      sectionsWith({
        kind: 'notice',
        message: 'Alcance do período ainda não medido.',
      }),
    );

    expect(parsed.sections[0].cards[0].block).toEqual({
      kind: 'notice',
      message: 'Alcance do período ainda não medido.',
    });
  });

  it('drops keys the contract does not name', () => {
    const parsed = parseReportDocument(
      sectionsWith({
        kind: 'metric',
        label: 'Cliques',
        value: '10',
        detail: null,
        highlighted: false,
        onerror: 'alert(1)',
      }),
    );

    expect(parsed.sections[0].cards[0].block).not.toHaveProperty('onerror');
  });

  it('clamps a funnel ratio into the drawable range', () => {
    const parsed = parseReportDocument(
      sectionsWith({
        kind: 'funnel',
        orientation: 'vertical',
        steps: [
          { label: 'A', value: '100', ratio: 4, rate: null, note: null },
          { label: 'B', value: '10', ratio: -1, rate: '10%', note: null },
          { label: 'C', value: '1', ratio: 'x', rate: null, note: null },
        ],
      }),
    );

    const block = parsed.sections[0].cards[0].block as ReportFunnelBlock;

    expect(block.steps.map((step) => step.ratio)).toEqual([1, 0, 0]);
  });

  it('truncates a table row to its declared columns', () => {
    // A cell with no column above it prints under the wrong heading, which
    // silently attributes a number to a field it does not belong to.
    const parsed = parseReportDocument(
      sectionsWith({
        kind: 'table',
        columns: ['Campanha', 'Valor gasto'],
        rows: [['Campanha A', 'R$ 10,00', 'sobra']],
        note: null,
      }),
    );

    const block = parsed.sections[0].cards[0].block as ReportTableBlock;

    expect(block.rows[0]).toEqual(['Campanha A', 'R$ 10,00']);
  });

  it('drops empty paragraphs from an insight', () => {
    const parsed = parseReportDocument(
      sectionsWith({
        kind: 'insight',
        paragraphs: ['Primeiro parágrafo.', '   ', 'Segundo.'],
        generatedAt: '2026-09-21',
        model: 'gpt-5.6-terra',
      }),
    );

    const block = parsed.sections[0].cards[0].block as ReportInsightBlock;

    expect(block.paragraphs).toEqual(['Primeiro parágrafo.', 'Segundo.']);
    expect(block.model).toBe('gpt-5.6-terra');
  });

  it('refuses a body that is not an object', () => {
    expect(() => parseReportDocument(null)).toThrow(ReportDocumentError);
    expect(() => parseReportDocument([])).toThrow(ReportDocumentError);
    expect(() => parseReportDocument('relatório')).toThrow(ReportDocumentError);
  });

  it('refuses a table with more rows than it will print', () => {
    // The ceiling is what stops one request becoming an unbounded document —
    // and an unbounded Playwright render.
    const rows = Array.from({ length: 101 }, () => ['x']);

    expect(() =>
      parseReportDocument(
        sectionsWith({ kind: 'table', columns: ['x'], rows, note: null }),
      ),
    ).toThrow(ReportDocumentError);
  });
});
