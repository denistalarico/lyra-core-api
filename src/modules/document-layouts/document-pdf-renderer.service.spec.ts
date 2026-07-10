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
import type { FinanceInvoice } from '../finance/entities/finance-invoice.entity';
import type { FinanceInvoiceLine } from '../finance/entities/finance-invoice-line.entity';
import type { FinanceBankAccount } from '../finance/entities/finance-bank-account.entity';

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
    companyAddress: 'Rua das Agências, 100',
    companyCity: 'São Paulo',
    companyRegion: 'SP',
    companyPostalCode: '01000-000',
    companyEmail: 'financeiro@lyra.test',
    companyPhone: '(11) 99999-0000',
  } as unknown as DocumentLayoutEntity;
}

function makeTemplate(): DocumentLayoutTemplateEntity {
  return {
    htmlTemplate:
      `<div class="doc-page doc-template-{{layoutType}}">
        <header class="doc-header">
          <div class="doc-brand">{{companyBrandBlock}}</div>
          <div class="doc-company">
            <span>{{companyAddress}}</span>
            <span>{{companyCity}} {{companyRegion}} {{companyPostalCode}}</span>
            <span>{{companyEmail}} {{companyPhone}}</span>
          </div>
        </header>
        <main class="doc-content">
          <section class="doc-hero">
            <div class="doc-hero-copy">
              <span class="doc-kicker">{{documentTypeLabel}}</span>
              <h1>{{documentTitle}}</h1>
              <p>{{documentSubtitle}}</p>
            </div>
            {{customerHeaderBlock}}
          </section>
          <section class="doc-grid">
            <div><small>{{documentNumberLabel}}</small><strong>{{documentNumber}}</strong></div>
            {{dateGridCells}}
          </section>
          <section class="doc-closing{{closingModifier}}">
            {{termsBlock}}
            <div class="doc-totals-panel doc-totals">
              <h3>Resumo financeiro</h3>
              {{totalsTable}}
            </div>
          </section>
        </main>
      </div>`,
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

function makeBareInvoice(overrides: Partial<FinanceInvoice> = {}): FinanceInvoice {
  return {
    id: 'invoice-1',
    tenantId: 't',
    workspaceId: 'w',
    customerId: null,
    invoiceNumber: 'INV-0001',
    currency: 'BRL',
    issueDate: '2026-07-01',
    dueDate: '2026-07-10',
    periodStart: null,
    periodEnd: null,
    subtotalAmount: '150.00',
    discountAmount: '0.00',
    taxAmount: '0.00',
    totalAmount: '150.00',
    paidAmount: '0.00',
    balanceDue: '150.00',
    terms: null,
    notes: null,
    metadata: {
      customerName: 'Cliente Aurora',
      customerAvatarUrl: 'https://example.com/avatar.png',
    },
    ...overrides,
  } as unknown as FinanceInvoice;
}

function makePixBankAccount(overrides: Partial<FinanceBankAccount> = {}): FinanceBankAccount {
  return {
    id: 'bank-1',
    tenantId: 't',
    workspaceId: 'w',
    name: 'Conta principal',
    bankName: 'Banco Exemplo',
    currency: 'BRL',
    isPrimary: true,
    active: true,
    bankDetails: {
      pixKey: '12.345.678/0001-90',
      pixKeyType: 'cpf_cnpj',
      accountHolderName: 'Lyra Agency',
      accountHolderDocument: '12.345.678/0001-90',
      bankCode: '001',
      branchNumber: '0001',
      accountNumber: '12345',
      accountDigit: '6',
    },
    ...overrides,
  } as unknown as FinanceBankAccount;
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

describe('DocumentPdfRendererService — invoice layout HTML', () => {
  const service = new DocumentPdfRendererService();

  async function buildInvoiceHtml(
    invoice = makeBareInvoice(),
    paymentAccount: FinanceBankAccount | null = makePixBankAccount(),
  ) {
    return (service as unknown as {
      buildInvoiceHtml(input: {
        invoice: FinanceInvoice;
        lines: FinanceInvoiceLine[];
        layout: DocumentLayoutEntity;
        template: DocumentLayoutTemplateEntity;
        paymentAccount?: FinanceBankAccount | null;
      }): Promise<string>;
    }).buildInvoiceHtml({
      invoice,
      lines: [],
      layout: makeLayout(),
      template: makeTemplate(),
      paymentAccount,
    });
  }

  it('keeps the agency data in the standard header and renders the customer in the invoice hero', async () => {
    const html = await buildInvoiceHtml();

    expect(html).toContain('Rua das Agências, 100');
    expect(html).not.toContain('doc-company--invoice-customer');
    expect(html).toContain('doc-invoice-customer-header');
    expect(html).toContain('Cliente Aurora');
    expect(html).not.toContain('doc-customer-header"><span');
  });

  it('renders only issue and due date cards for invoice data', async () => {
    const html = await buildInvoiceHtml();

    expect(html).toContain('Data de emissão');
    expect(html).toContain('Data de vencimento');
    expect(html).not.toContain('<small>Número</small>');
  });

  it('renders Pix QR code and bank payment details in the financial closing area', async () => {
    const html = await buildInvoiceHtml();

    expect(html).toContain('Dados para pagamento');
    expect(html).toContain('Pix QR Code');
    expect(html).toContain('12.345.678/0001-90');
    expect(html).toContain('CPF / CNPJ');
    expect(html).not.toContain('cpf_cnpj');
    expect(html).not.toContain('Documento');
    expect(html).not.toContain('Código do banco');
    expect(html).toContain('data:image/png;base64,');
    expect(html).toContain('Resumo financeiro');
  });
});
