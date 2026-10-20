import { DocumentPdfRendererService } from './document-pdf-renderer.service';
import type {
  DocumentLayoutEntity,
  DocumentLayoutTemplateEntity,
} from './entities/document-layout.entities';
import {
  QuoteEntity,
  type QuoteItemEntity,
} from '../quotes/entities/quote.entities';

type QuoteHtmlInput = {
  quote: QuoteEntity;
  items: QuoteItemEntity[];
  layout: DocumentLayoutEntity;
  template: DocumentLayoutTemplateEntity;
  customerName?: string | null;
};

function makeItem(overrides: Partial<QuoteItemEntity> = {}): QuoteItemEntity {
  return {
    id: 'item-1',
    name: 'Consultoria',
    description: null,
    quantity: 2,
    currency: 'BRL',
    unitPriceCents: 12500,
    setupPriceCents: 3000,
    recurringPriceCents: 4500,
    recurringTotalCents: 9000,
    totalCents: 28000,
    metadata: {},
    ...overrides,
  } as QuoteItemEntity;
}

function buildHtml(items: QuoteItemEntity[], customerName?: string | null) {
  const service = new DocumentPdfRendererService();
  // Inspect the complete HTML supplied to Chromium without launching a browser
  // or making network requests. The existing invoice tests use this boundary.
  return (
    service as unknown as {
      buildQuoteHtml(input: QuoteHtmlInput): string;
    }
  ).buildQuoteHtml({
    quote: Object.assign(new QuoteEntity(), {
      id: 'quote-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      status: 'draft',
      title: 'Proposta',
      quoteNumber: 'Q-2026-00001',
      currency: 'BRL',
      metadata: { customerName: 'Snapshot antigo' },
      subtotalCents: 28000,
      totalCents: 28000,
      recurringTotalCents: 9000,
      discountCents: 0,
      taxCents: 0,
    }),
    items,
    layout: {
      paperFormat: 'a4',
      layoutType: 'essence',
    } as DocumentLayoutEntity,
    template: {
      htmlTemplate:
        '<div>{{customerName}}</div>{{customerHeaderBlock}}{{itemsTable}}',
      // Print protection must work for existing templates too.
      cssTemplate: '',
    } as DocumentLayoutTemplateEntity,
    customerName,
  });
}

function findRow(html: string, text: string) {
  const rows: string[] = html.match(/<tr\b[^>]*>[\s\S]*?<\/tr>/g) ?? [];
  const row = rows.find((candidate) => candidate.includes(text));
  expect(row).toBeDefined();
  return row!;
}

describe('DocumentPdfRendererService — quote content and pagination', () => {
  it('renders a note as escaped text spanning the table, without financial cells', () => {
    const html = buildHtml([
      makeItem({
        name: 'Observações',
        description: 'Escopo <especial> & cronograma\nSegunda linha',
        metadata: { kind: 'note' },
      }),
    ]);
    const row = findRow(html, 'Observações');

    expect(row.match(/<td\b/g)).toHaveLength(1);
    expect(row).toMatch(/colspan=["']6["']/);
    expect(row).toContain('Escopo &lt;especial&gt; &amp; cronograma');
    expect(row).toContain('Segunda linha');
    expect(row).not.toContain('Total recorrente');
    expect(row).not.toContain('R$');
    expect(row).not.toContain('<especial>');
  });

  it('renders a section title spanning all financial columns', () => {
    const html = buildHtml([
      makeItem({ name: 'Estratégia & criação', metadata: { kind: 'section' } }),
      makeItem(),
    ]);
    const row = findRow(html, 'Estratégia &amp; criação');

    expect(row.match(/<t[dh]\b/g)).toHaveLength(1);
    expect(row).toMatch(/colspan=["']6["']/);
    expect(row).not.toContain('R$');
    expect(row).not.toContain('Total recorrente');
  });

  it('keeps each section and its following rows in a separate printable group', () => {
    const html = buildHtml([
      makeItem({ name: 'Seção A', metadata: { kind: 'section' } }),
      makeItem({ name: 'Serviço A' }),
      makeItem({ name: 'Nota A', metadata: { kind: 'note' } }),
      makeItem({ name: 'Seção B', metadata: { kind: 'section' } }),
      makeItem({ name: 'Serviço B' }),
    ]);
    const groups = html.match(/<tbody\b[^>]*>[\s\S]*?<\/tbody>/g) ?? [];

    expect(groups).toHaveLength(2);
    expect(groups[0]).toContain('Seção A');
    expect(groups[0]).toContain('Serviço A');
    expect(groups[0]).toContain('Nota A');
    expect(groups[0]).not.toContain('Seção B');
    expect(groups[1]).toContain('Seção B');
    expect(groups[1]).toContain('Serviço B');
    // Prevent splitting normal-sized sections and individual rows. Chromium
    // may still fragment a group longer than one page, which remains usable.
    expect(html).toMatch(
      /\.doc-items-table\s+tbody[^{}]*\{[^}]*break-inside:\s*avoid/,
    );
    expect(html).toMatch(
      /\.doc-items-table\s+tr[^{}]*\{[^}]*break-inside:\s*avoid/,
    );
  });

  it('continues rendering six financial cells for ordinary quote items', () => {
    const row = findRow(buildHtml([makeItem()]), 'Consultoria');

    expect(row.match(/<td\b/g)).toHaveLength(6);
    expect(row).toContain('125,00');
    expect(row).toContain('280,00');
    expect(row).toContain('Total recorrente');
  });

  it('uses the current contact name instead of stale quote metadata and escapes it', () => {
    const html = buildHtml([], 'Cliente <Aurora> & Filhos');

    expect(html).toContain('Cliente &lt;Aurora&gt; &amp; Filhos');
    expect(html).not.toContain('Snapshot antigo');
    expect(html).not.toContain('Cliente não informado');
    expect(html).not.toContain('{{customerHeaderBlock}}');
    expect(html).toContain('doc-customer-header');
  });

  it('preserves the metadata fallback for older callers without a resolved contact', () => {
    expect(buildHtml([])).toContain('Snapshot antigo');
  });
});
