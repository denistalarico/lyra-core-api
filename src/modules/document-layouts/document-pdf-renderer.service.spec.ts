import {
  DocumentPdfRendererService,
  PdfEngineUnavailableError,
} from './document-pdf-renderer.service';
import type {
  DocumentLayoutEntity,
  DocumentLayoutTemplateEntity,
} from './entities/document-layout.entities';
import type { FinanceBill } from '../finance/entities/finance-bill.entity';
import type { FinanceBillLine } from '../finance/entities/finance-bill-line.entity';

function makeLayout(): DocumentLayoutEntity {
  return {
    paperFormat: 'a4',
    layoutType: 'essence',
    primaryColor: '#2563EB',
    secondaryColor: '#0F172A',
    textColor: '#0F172A',
    backgroundColor: '#FFFFFF',
    fontFamily: 'Inter',
    headingFontFamily: 'Sora',
  } as unknown as DocumentLayoutEntity;
}

function makeTemplate(): DocumentLayoutTemplateEntity {
  return {
    htmlTemplate:
      '<section>{{documentTypeLabel}} {{documentTitle}} {{customerName}} {{dateGridCells}} {{validUntil}} {{itemsTable}} {{totalsTable}} {{footerText}}</section>',
    cssTemplate: 'body { color: {{textColor}}; font-family: {{fontFamily}}; }',
  } as unknown as DocumentLayoutTemplateEntity;
}

// A bill missing every optional field (vendor, category, cost center, dates,
// metadata) — the scenario that previously produced a 500.
function makeBareBill(overrides: Partial<FinanceBill> = {}): FinanceBill {
  return {
    id: 'bill-1',
    tenantId: 't',
    workspaceId: 'w',
    vendorId: null,
    billNumber: 'BILL-0001',
    currency: 'BRL',
    issueDate: null,
    dueDate: null,
    periodStart: null,
    periodEnd: null,
    subtotalAmount: '0.00',
    taxAmount: '0.00',
    totalAmount: '0.00',
    paidAmount: '0.00',
    balanceDue: '0.00',
    categoryId: null,
    costCenterId: null,
    notes: null,
    metadata: {},
    ...overrides,
  } as unknown as FinanceBill;
}

describe('DocumentPdfRendererService — bill rendering resilience', () => {
  const service = new DocumentPdfRendererService();

  // Renders and asserts no *unexpected* error is thrown. A missing browser
  // engine surfaces as a typed PdfEngineUnavailableError (handled gracefully by
  // the controller) and is acceptable here — what must never happen is a crash
  // from accessing absent fields (e.g. the old formatDate TypeError).
  async function expectNoFieldAccessCrash(bill: FinanceBill, lines: FinanceBillLine[]) {
    try {
      const buffer = await service.renderBillPdf({
        bill,
        lines,
        layout: makeLayout(),
        template: makeTemplate(),
      });
      expect(Buffer.isBuffer(buffer)).toBe(true);
      expect(buffer.length).toBeGreaterThan(0);
    } catch (error) {
      if (!(error instanceof PdfEngineUnavailableError)) throw error;
    }
  }

  it('renders a bill with no vendor/category/cost center without crashing', async () => {
    await expectNoFieldAccessCrash(makeBareBill(), []);
  }, 30000);

  it('renders a bill whose lines have no category/cost center without crashing', async () => {
    const bill = makeBareBill({ totalAmount: '150.00', subtotalAmount: '150.00' });
    const lines = [
      {
        id: 'l1',
        description: 'Serviço avulso',
        quantity: '1.0000',
        unitPrice: '150.00',
        taxAmount: '0.00',
        totalAmount: '150.00',
        categoryId: null,
        costCenterId: null,
        metadata: {},
      } as unknown as FinanceBillLine,
    ];
    await expectNoFieldAccessCrash(bill, lines);
  }, 30000);

  it('tolerates a due date provided as a Date object (defensive formatDate)', async () => {
    const bill = makeBareBill({ dueDate: new Date('2026-07-15') as unknown as string });
    await expectNoFieldAccessCrash(bill, []);
  }, 30000);
});
