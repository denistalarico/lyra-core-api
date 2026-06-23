import { Injectable } from '@nestjs/common';
import { chromium } from 'playwright';
import type {
  QuoteEntity,
  QuoteItemEntity,
} from '../quotes/entities/quote.entities';
import type {
  DocumentLayoutEntity,
  DocumentLayoutTemplateEntity,
} from './entities/document-layout.entities';
import type { FinanceInvoice } from '../finance/entities/finance-invoice.entity';
import type { FinanceInvoiceLine } from '../finance/entities/finance-invoice-line.entity';
import type { FinanceBill } from '../finance/entities/finance-bill.entity';
import type { FinanceBillLine } from '../finance/entities/finance-bill-line.entity';

type RenderQuotePdfInput = {
  quote: QuoteEntity;
  items: QuoteItemEntity[];
  layout: DocumentLayoutEntity;
  template: DocumentLayoutTemplateEntity;
};

type RenderInvoicePdfInput = {
  invoice: FinanceInvoice;
  lines: FinanceInvoiceLine[];
  layout: DocumentLayoutEntity;
  template: DocumentLayoutTemplateEntity;
};

type RenderBillPdfInput = {
  bill: FinanceBill;
  lines: FinanceBillLine[];
  layout: DocumentLayoutEntity;
  template: DocumentLayoutTemplateEntity;
};

type RenderHtmlPdfOptions = {
  format?: 'A4' | 'Letter';
  margin?: { top?: string; right?: string; bottom?: string; left?: string };
};

type TeamDocumentAgency = {
  legalName: string;
  publicName: string;
  taxId: string;
  address: string;
  email: string;
  phone: string;
  signerName: string;
  signerRole: string;
};

type TeamDocumentMember = {
  displayName: string;
  legalName: string;
  document: string;
  role: string;
  department: string;
};

type TeamDocumentPeriod = {
  label: string;
  startDate: string;
  endDate: string;
  paymentDate: string;
};

type TeamDocumentPayment = {
  currency: string;
  baseAmount: number;
  grossAmount: number;
  netAmount: number;
  paymentMethod: string;
  notes: string;
};

type TeamDocumentLineItem = { name: string; amount: number };

type TeamDocumentAttendanceRecord = {
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  breakMinutes?: number | null;
  totalHours?: number | null;
  status?: string;
  note?: string | null;
};

type TeamDocumentAttendanceAggregates = {
  totalWorkedHours: number;
  expectedHours: number;
  overtimeHours: number;
  missingHours: number;
  balanceHours: number;
};

type TeamDocumentSignature = {
  memberName: string;
  memberRole: string;
  agencySignerName: string;
  agencySignerRole: string;
  city: string;
  date: string;
};

type TeamDocumentMeta = { name: string; locale: string };

type TeamDocumentPresentation = {
  headerPreset?: string;
  footerPreset?: string;
  showLogo?: boolean;
  logoUrl?: string | null;
  showCompanyData?: boolean;
  showDocumentNumber?: boolean;
  documentNumber?: string;
  showPoweredByLyra?: boolean;
};

type SignatureBlockInput = {
  memberLabel: string;
  memberRole?: string;
  agencyLabel: string;
  agencyRole?: string;
  city?: string;
  date?: string;
};

type RenderTeamAttendanceReportInput = {
  agency: TeamDocumentAgency;
  member: TeamDocumentMember;
  period: TeamDocumentPeriod;
  attendance: {
    records: TeamDocumentAttendanceRecord[];
    aggregates: TeamDocumentAttendanceAggregates;
  };
  signature: TeamDocumentSignature;
  document: TeamDocumentMeta;
  presentation?: TeamDocumentPresentation;
};

type RenderTeamPayslipInput = {
  agency: TeamDocumentAgency;
  member: TeamDocumentMember;
  period: TeamDocumentPeriod;
  payment: TeamDocumentPayment;
  benefits: TeamDocumentLineItem[];
  earnings?: TeamDocumentLineItem[];
  deductions: TeamDocumentLineItem[];
  signature: TeamDocumentSignature;
  document: TeamDocumentMeta;
  pageSize: 'A4' | 'LETTER';
  presentation?: TeamDocumentPresentation;
};

type RenderTeamPaymentStatementInput = {
  agency: TeamDocumentAgency;
  member: TeamDocumentMember;
  contract: { number: string; paymentTerms: string };
  period: TeamDocumentPeriod;
  payment: TeamDocumentPayment;
  benefits: TeamDocumentLineItem[];
  earnings?: TeamDocumentLineItem[];
  deductions: TeamDocumentLineItem[];
  signature: TeamDocumentSignature;
  document: TeamDocumentMeta;
  presentation?: TeamDocumentPresentation;
};

type RenderTeamBenefitAcknowledgmentInput = {
  agency: TeamDocumentAgency;
  member: TeamDocumentMember;
  period: TeamDocumentPeriod;
  payment: Pick<TeamDocumentPayment, 'currency'>;
  benefits: TeamDocumentLineItem[];
  signature: TeamDocumentSignature;
  document: TeamDocumentMeta;
  presentation?: TeamDocumentPresentation;
};

@Injectable()
export class DocumentPdfRendererService {
  async renderHtmlToPdf(
    html: string,
    options: RenderHtmlPdfOptions = {},
  ): Promise<Buffer> {
    const browser = await chromium.launch({ headless: true });
    let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;

    try {
      page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.emulateMedia({ media: 'print' });

      return await page.pdf({
        format: options.format ?? 'A4',
        printBackground: true,
        margin: options.margin ?? {
          top: '12mm',
          right: '12mm',
          bottom: '12mm',
          left: '12mm',
        },
      });
    } finally {
      await page?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  async renderQuotePdf(input: RenderQuotePdfInput): Promise<Buffer> {
    const html = this.buildQuoteHtml(input);
    const browser = await chromium.launch({ headless: true });
    let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;

    try {
      page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.emulateMedia({ media: 'print' });

      return await page.pdf({
        format: input.layout.paperFormat === 'letter' ? 'Letter' : 'A4',
        printBackground: true,
        margin: {
          top: '0',
          right: '0',
          bottom: '0',
          left: '0',
        },
      });
    } finally {
      await page?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private buildQuoteHtml(input: RenderQuotePdfInput) {
    const { quote, items, layout, template } = input;
    const companyBrandBlock = this.buildCompanyBrandBlock(layout);
    const termsBlock = this.buildTermsBlock(quote.termsAndConditions);
    const html = this.replaceTokens(template.htmlTemplate, {
      layoutType: this.escapeHtml(layout.layoutType),
      companyBrandBlock,
      companyLogoBlock: companyBrandBlock,
      companyLogo: '',
      companyName: this.escapeHtml(layout.companyName ?? ''),
      slogan: this.escapeHtml(layout.slogan ?? ''),
      companyAddress: this.escapeHtml(layout.companyAddress ?? ''),
      companyCity: this.escapeHtml(layout.companyCity ?? ''),
      companyRegion: this.escapeHtml(layout.companyRegion ?? ''),
      companyPostalCode: this.escapeHtml(layout.companyPostalCode ?? ''),
      companyEmail: this.escapeHtml(layout.companyEmail ?? ''),
      companyPhone: this.escapeHtml(layout.companyPhone ?? ''),
      companyDocumentLabel: this.escapeHtml(layout.companyDocumentLabel ?? ''),
      companyDocumentValue: this.escapeHtml(layout.companyDocumentValue ?? ''),
      documentTypeLabel: 'Cotação',
      documentTitle: this.escapeHtml(quote.title || quote.quoteNumber),
      documentSubtitle: this.escapeHtml(this.getDocumentSubtitle(quote)),
      clientLabel: 'Cliente',
      documentNumberLabel: 'Número',
      customerName: this.escapeHtml(this.getCustomerName(quote)),
      documentNumber: this.escapeHtml(quote.quoteNumber),
      // new tokens (post-migration templates)
      dateGridCells: `<div><small>Validade</small><strong>${this.escapeHtml(this.formatDate(quote.validUntil))}</strong></div>`,
      termsBlock,
      closingModifier: termsBlock ? '' : ' doc-closing--no-terms',
      // legacy tokens (pre-migration templates)
      validUntil: this.escapeHtml(this.formatDate(quote.validUntil)),
      termsAndConditions: this.escapeHtml(quote.termsAndConditions ?? ''),
      itemsTable: this.buildItemsTable(items, quote.currency),
      totalsTable: this.buildTotalsTable(quote),
      footerText: this.escapeHtml(layout.footerText ?? ''),
    });

    const css = this.replaceTokens(template.cssTemplate, {
      primaryColor: this.escapeCssValue(layout.primaryColor || '#2563EB'),
      secondaryColor: this.escapeCssValue(layout.secondaryColor || '#0F172A'),
      textColor: this.escapeCssValue(layout.textColor || '#0F172A'),
      backgroundColor: this.escapeCssValue(layout.backgroundColor || '#FFFFFF'),
      fontFamily: this.escapeCssValue(layout.fontFamily || 'Inter'),
      headingFontFamily: this.escapeCssValue(
        layout.headingFontFamily || 'Sora',
      ),
    });

    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { margin: 0; size: ${layout.paperFormat === 'letter' ? 'Letter' : 'A4'}; }
    ${css}
  </style>
</head>
<body>${html}</body>
</html>`;
  }

  private escapeHtml(value: unknown) {
    return String(value ?? '')
      .replaceAll('&', '&amp;')
      .replaceAll('<', '&lt;')
      .replaceAll('>', '&gt;')
      .replaceAll('"', '&quot;')
      .replaceAll("'", '&#39;');
  }

  private replaceTokens(template: string, values: Record<string, string>) {
    return Object.entries(values).reduce(
      (current, [key, value]) => current.replaceAll(`{{${key}}}`, value),
      template,
    );
  }

  private formatMoney(cents: number | null | undefined, currency = 'BRL') {
    const amount = Number.isFinite(cents) ? Number(cents) / 100 : 0;

    try {
      return new Intl.NumberFormat('pt-BR', {
        style: 'currency',
        currency: currency || 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currency || 'BRL'} ${amount.toFixed(2)}`;
    }
  }

  private buildItemsTable(items: QuoteItemEntity[], fallbackCurrency: string) {
    const rows =
      items.length > 0
        ? items
            .map((item) => {
              const currency = item.currency || fallbackCurrency || 'BRL';
              const recurringLabel =
                item.recurringTotalCents > 0
                  ? `${this.formatMoney(item.recurringPriceCents, currency)}<br /><span style="color:#64748b;">Total recorrente: ${this.formatMoney(item.recurringTotalCents, currency)}</span>`
                  : '-';

              return `
        <tr>
          <td>
            <strong>${this.escapeHtml(item.name)}</strong>
            ${
              item.description
                ? `<br /><span style="color:#64748b;">${this.escapeHtml(item.description)}</span>`
                : ''
            }
          </td>
          <td style="text-align:center;">${this.escapeHtml(item.quantity)}</td>
          <td style="text-align:right;">${this.escapeHtml(this.formatMoney(item.unitPriceCents, currency))}</td>
          <td style="text-align:right;">${this.escapeHtml(this.formatMoney(item.setupPriceCents, currency))}</td>
          <td style="text-align:right;">${recurringLabel}</td>
          <td style="text-align:right;"><strong>${this.escapeHtml(this.formatMoney(item.totalCents, currency))}</strong></td>
        </tr>`;
            })
            .join('')
        : `
        <tr>
          <td colspan="6" style="text-align:center;color:#64748b;">Nenhum item informado.</td>
        </tr>`;

    return `
    <table class="doc-items-table">
      <thead>
        <tr>
          <th style="text-align:left;">Item</th>
          <th style="text-align:center;">Qtd.</th>
          <th style="text-align:right;">Unitário</th>
          <th style="text-align:right;">Setup</th>
          <th style="text-align:right;">Recorrente</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>`;
  }

  private buildTotalsTable(quote: QuoteEntity) {
    const currency = quote.currency || 'BRL';
    const optionalRows = [
      quote.discountCents > 0
        ? this.buildTotalRow(
            'Desconto',
            `-${this.formatMoney(quote.discountCents, currency)}`,
          )
        : '',
      quote.taxCents > 0
        ? this.buildTotalRow(
            'Impostos',
            this.formatMoney(quote.taxCents, currency),
          )
        : '',
      quote.recurringTotalCents > 0
        ? this.buildTotalRow(
            'Total recorrente',
            this.formatMoney(quote.recurringTotalCents, currency),
          )
        : '',
    ].join('');

    return `
    <div class="doc-total-list">
      ${this.buildTotalRow('Subtotal', this.formatMoney(quote.subtotalCents, currency))}
      ${optionalRows}
      <div class="doc-total-row doc-total-row--grand">
        <span>Total inicial</span>
        <strong class="doc-total-value">${this.escapeHtml(this.formatMoney(quote.totalCents, currency))}</strong>
      </div>
    </div>`;
  }

  async renderInvoicePdf(input: RenderInvoicePdfInput): Promise<Buffer> {
    const html = this.buildInvoiceHtml(input);
    const browser = await chromium.launch({ headless: true });
    let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;
    try {
      page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.emulateMedia({ media: 'print' });
      return await page.pdf({
        format: input.layout.paperFormat === 'letter' ? 'Letter' : 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
    } finally {
      await page?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  async renderBillPdf(input: RenderBillPdfInput): Promise<Buffer> {
    const html = this.buildBillHtml(input);
    const browser = await chromium.launch({ headless: true });
    let page: Awaited<ReturnType<typeof browser.newPage>> | null = null;
    try {
      page = await browser.newPage();
      await page.setContent(html, { waitUntil: 'networkidle' });
      await page.emulateMedia({ media: 'print' });
      return await page.pdf({
        format: input.layout.paperFormat === 'letter' ? 'Letter' : 'A4',
        printBackground: true,
        margin: { top: '0', right: '0', bottom: '0', left: '0' },
      });
    } finally {
      await page?.close().catch(() => undefined);
      await browser.close().catch(() => undefined);
    }
  }

  private buildInvoiceHtml(input: RenderInvoicePdfInput) {
    const { invoice, lines, layout, template } = input;
    const companyBrandBlock = this.buildCompanyBrandBlock(layout);
    const metadata = invoice.metadata ?? {};
    const customerName =
      typeof metadata['customerName'] === 'string' && metadata['customerName'].trim()
        ? metadata['customerName'].trim()
        : 'Cliente não informado';
    const subtitle =
      typeof metadata['documentSubtitle'] === 'string' && metadata['documentSubtitle'].trim()
        ? metadata['documentSubtitle'].trim()
        : 'Fatura de serviços prestados';
    const termsBlock = this.buildTermsBlock(invoice.terms);
    const html = this.replaceTokens(template.htmlTemplate, {
      layoutType: this.escapeHtml(layout.layoutType),
      companyBrandBlock,
      companyLogoBlock: companyBrandBlock,
      companyLogo: '',
      companyName: this.escapeHtml(layout.companyName ?? ''),
      slogan: this.escapeHtml(layout.slogan ?? ''),
      companyAddress: this.escapeHtml(layout.companyAddress ?? ''),
      companyCity: this.escapeHtml(layout.companyCity ?? ''),
      companyRegion: this.escapeHtml(layout.companyRegion ?? ''),
      companyPostalCode: this.escapeHtml(layout.companyPostalCode ?? ''),
      companyEmail: this.escapeHtml(layout.companyEmail ?? ''),
      companyPhone: this.escapeHtml(layout.companyPhone ?? ''),
      companyDocumentLabel: this.escapeHtml(layout.companyDocumentLabel ?? ''),
      companyDocumentValue: this.escapeHtml(layout.companyDocumentValue ?? ''),
      documentTypeLabel: 'Fatura',
      documentTitle: this.escapeHtml(invoice.invoiceNumber),
      documentSubtitle: this.escapeHtml(subtitle),
      clientLabel: 'Cliente',
      documentNumberLabel: 'Número',
      customerName: this.escapeHtml(customerName),
      documentNumber: this.escapeHtml(invoice.invoiceNumber),
      // new tokens (post-migration templates)
      dateGridCells: [
        `<div><small>Data de emissão</small><strong>${this.escapeHtml(this.formatDate(invoice.issueDate))}</strong></div>`,
        `<div><small>Vencimento</small><strong>${this.escapeHtml(this.formatDate(invoice.dueDate))}</strong></div>`,
      ].join(''),
      termsBlock,
      closingModifier: termsBlock ? '' : ' doc-closing--no-terms',
      // legacy tokens (pre-migration templates)
      validUntil: this.escapeHtml(
        invoice.dueDate
          ? `${this.formatDate(invoice.issueDate)} · Venc. ${this.formatDate(invoice.dueDate)}`
          : this.formatDate(invoice.issueDate),
      ),
      termsAndConditions: this.escapeHtml(invoice.terms ?? ''),
      itemsTable: this.buildFinanceItemsTable(
        lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          totalAmount: l.totalAmount,
        })),
        invoice.currency,
      ),
      totalsTable: this.buildFinanceTotalsTable({
        subtotalAmount: invoice.subtotalAmount,
        discountAmount: invoice.discountAmount,
        taxAmount: invoice.taxAmount,
        totalAmount: invoice.totalAmount,
        currency: invoice.currency,
        grandLabel: 'Total da fatura',
      }),
      footerText: this.escapeHtml(layout.footerText ?? ''),
    });
    const css = this.replaceTokens(template.cssTemplate, {
      primaryColor: this.escapeCssValue(layout.primaryColor || '#2563EB'),
      secondaryColor: this.escapeCssValue(layout.secondaryColor || '#0F172A'),
      textColor: this.escapeCssValue(layout.textColor || '#0F172A'),
      backgroundColor: this.escapeCssValue(layout.backgroundColor || '#FFFFFF'),
      fontFamily: this.escapeCssValue(layout.fontFamily || 'Inter'),
      headingFontFamily: this.escapeCssValue(layout.headingFontFamily || 'Sora'),
    });
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { margin: 0; size: ${layout.paperFormat === 'letter' ? 'Letter' : 'A4'}; }
    ${css}
  </style>
</head>
<body>${html}</body>
</html>`;
  }

  private buildBillHtml(input: RenderBillPdfInput) {
    const { bill, lines, layout, template } = input;
    const companyBrandBlock = this.buildCompanyBrandBlock(layout);
    const metadata = bill.metadata ?? {};
    const vendorName =
      typeof metadata['vendorName'] === 'string' && metadata['vendorName'].trim()
        ? metadata['vendorName'].trim()
        : 'Fornecedor não informado';
    const subtitle =
      typeof metadata['documentSubtitle'] === 'string' && metadata['documentSubtitle'].trim()
        ? metadata['documentSubtitle'].trim()
        : 'Documento de obrigação financeira';
    const html = this.replaceTokens(template.htmlTemplate, {
      layoutType: this.escapeHtml(layout.layoutType),
      companyBrandBlock,
      companyLogoBlock: companyBrandBlock,
      companyLogo: '',
      companyName: this.escapeHtml(layout.companyName ?? ''),
      slogan: this.escapeHtml(layout.slogan ?? ''),
      companyAddress: this.escapeHtml(layout.companyAddress ?? ''),
      companyCity: this.escapeHtml(layout.companyCity ?? ''),
      companyRegion: this.escapeHtml(layout.companyRegion ?? ''),
      companyPostalCode: this.escapeHtml(layout.companyPostalCode ?? ''),
      companyEmail: this.escapeHtml(layout.companyEmail ?? ''),
      companyPhone: this.escapeHtml(layout.companyPhone ?? ''),
      companyDocumentLabel: this.escapeHtml(layout.companyDocumentLabel ?? ''),
      companyDocumentValue: this.escapeHtml(layout.companyDocumentValue ?? ''),
      documentTypeLabel: 'Conta a Pagar',
      documentTitle: this.escapeHtml(bill.billNumber),
      documentSubtitle: this.escapeHtml(subtitle),
      clientLabel: 'Fornecedor',
      documentNumberLabel: 'Número',
      customerName: this.escapeHtml(vendorName),
      documentNumber: this.escapeHtml(bill.billNumber),
      // new tokens (post-migration templates)
      dateGridCells: `<div><small>Vencimento</small><strong>${this.escapeHtml(this.formatDate(bill.dueDate))}</strong></div>`,
      termsBlock: '',
      closingModifier: ' doc-closing--no-terms',
      // legacy tokens (pre-migration templates)
      validUntil: this.escapeHtml(this.formatDate(bill.dueDate)),
      termsAndConditions: '',
      itemsTable: this.buildFinanceItemsTable(
        lines.map((l) => ({
          description: l.description,
          quantity: l.quantity,
          unitPrice: l.unitPrice,
          totalAmount: l.totalAmount,
        })),
        bill.currency,
      ),
      totalsTable: this.buildFinanceTotalsTable({
        subtotalAmount: bill.subtotalAmount,
        discountAmount: '0',
        taxAmount: bill.taxAmount,
        totalAmount: bill.totalAmount,
        currency: bill.currency,
        grandLabel: 'Total a pagar',
      }),
      footerText: this.escapeHtml(layout.footerText ?? ''),
    });
    const css = this.replaceTokens(template.cssTemplate, {
      primaryColor: this.escapeCssValue(layout.primaryColor || '#2563EB'),
      secondaryColor: this.escapeCssValue(layout.secondaryColor || '#0F172A'),
      textColor: this.escapeCssValue(layout.textColor || '#0F172A'),
      backgroundColor: this.escapeCssValue(layout.backgroundColor || '#FFFFFF'),
      fontFamily: this.escapeCssValue(layout.fontFamily || 'Inter'),
      headingFontFamily: this.escapeCssValue(layout.headingFontFamily || 'Sora'),
    });
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <style>
    @page { margin: 0; size: ${layout.paperFormat === 'letter' ? 'Letter' : 'A4'}; }
    ${css}
  </style>
</head>
<body>${html}</body>
</html>`;
  }

  private buildFinanceItemsTable(
    lines: { description: string; quantity: string; unitPrice: string; totalAmount: string }[],
    fallbackCurrency: string,
  ) {
    const rows =
      lines.length > 0
        ? lines
            .map(
              (l) => `
        <tr>
          <td><strong>${this.escapeHtml(l.description)}</strong></td>
          <td style="text-align:center;">${this.escapeHtml(l.quantity)}</td>
          <td style="text-align:right;">${this.escapeHtml(this.formatMoney(Math.round(Number(l.unitPrice) * 100), fallbackCurrency))}</td>
          <td style="text-align:right;"><strong>${this.escapeHtml(this.formatMoney(Math.round(Number(l.totalAmount) * 100), fallbackCurrency))}</strong></td>
        </tr>`,
            )
            .join('')
        : `<tr><td colspan="4" style="text-align:center;color:#64748b;">Nenhum item informado.</td></tr>`;
    return `
    <table class="doc-items-table">
      <thead>
        <tr>
          <th style="text-align:left;">Item</th>
          <th style="text-align:center;">Qtd.</th>
          <th style="text-align:right;">Unitário</th>
          <th style="text-align:right;">Total</th>
        </tr>
      </thead>
      <tbody>${rows}
      </tbody>
    </table>`;
  }

  private buildFinanceTotalsTable(params: {
    subtotalAmount: string;
    discountAmount: string;
    taxAmount: string;
    totalAmount: string;
    currency: string;
    grandLabel: string;
  }) {
    const { subtotalAmount, discountAmount, taxAmount, totalAmount, currency, grandLabel } = params;
    const discount = Number(discountAmount);
    const tax = Number(taxAmount);
    const optionalRows = [
      discount > 0
        ? this.buildTotalRow('Desconto', `-${this.formatMoney(Math.round(discount * 100), currency)}`)
        : '',
      tax > 0
        ? this.buildTotalRow('Impostos', this.formatMoney(Math.round(tax * 100), currency))
        : '',
    ].join('');
    return `
    <div class="doc-total-list">
      ${this.buildTotalRow('Subtotal', this.formatMoney(Math.round(Number(subtotalAmount) * 100), currency))}
      ${optionalRows}
      <div class="doc-total-row doc-total-row--grand">
        <span>${this.escapeHtml(grandLabel)}</span>
        <strong class="doc-total-value">${this.escapeHtml(this.formatMoney(Math.round(Number(totalAmount) * 100), currency))}</strong>
      </div>
    </div>`;
  }

  private buildTermsBlock(terms: string | null | undefined) {
    if (!terms?.trim()) return '';
    return `<div class="doc-terms-panel"><h3>Termos e condições</h3><p>${this.escapeHtml(terms)}</p></div>`;
  }

  private buildCompanyBrandBlock(layout: DocumentLayoutEntity) {
    const logoUrl = this.resolveAssetUrl(layout.logoUrl);

    if (!logoUrl) return '';

    const position = ['left', 'center', 'right'].includes(layout.logoPosition)
      ? layout.logoPosition
      : 'left';

    return `<div class="doc-logo doc-logo--uploaded doc-logo--${this.escapeHtml(position)}"><img src="${this.escapeHtml(logoUrl)}" alt="" aria-label="Logo da empresa" onerror="this.closest('.doc-logo')?.remove();" /></div>`;
  }

  private resolveAssetUrl(logoUrl: string | null | undefined) {
    const value = logoUrl?.trim();

    if (!value) return '';
    if (/^[a-z][a-z\d+\-.]*:/i.test(value)) return value;

    if (value.startsWith('/')) {
      const baseUrl = (
        process.env.AGENCY_PUBLIC_API_URL ||
        process.env.API_PUBLIC_URL ||
        'http://localhost:3000/api'
      ).replace(/\/$/, '');

      return `${baseUrl}${value}`;
    }

    return value;
  }

  private buildTotalRow(label: string, value: string) {
    return `
      <div class="doc-total-row">
        <span>${this.escapeHtml(label)}</span>
        <strong class="doc-total-value">${this.escapeHtml(value)}</strong>
      </div>`;
  }

  private formatDate(value: string | null) {
    if (!value) return 'Sem validade definida';

    const dateParts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateParts) return `${dateParts[3]}/${dateParts[2]}/${dateParts[1]}`;

    const date = new Date(value);
    if (Number.isNaN(date.getTime())) return value;

    return new Intl.DateTimeFormat('pt-BR').format(date);
  }

  private getCustomerName(quote: QuoteEntity) {
    const metadata = quote.metadata ?? {};
    const value =
      metadata.customerName ??
      metadata.clientName ??
      metadata.companyName ??
      metadata.contactName;

    return typeof value === 'string' && value.trim()
      ? value.trim()
      : 'Cliente não informado';
  }

  private getDocumentSubtitle(quote: QuoteEntity) {
    const metadata = quote.metadata ?? {};
    const value =
      metadata.documentSubtitle ?? metadata.subtitle ?? metadata.description;

    return typeof value === 'string' && value.trim()
      ? value.trim()
      : quote.quoteNumber
        ? `Proposta comercial ${quote.quoteNumber}`
        : 'Proposta comercial';
  }

  private escapeCssValue(value: string) {
    return value.replace(/[<>{};]/g, '');
  }

  /**
   * Bloco de assinatura sanitizer-safe (linha em texto, sem depender de bordas
   * CSS) — usado pelos 3 renderers protegidos de Team e, via TeamService,
   * anexado ao bodyHtml de modelos `custom_html` antes da sanitização de Contracts.
   */
  buildSignatureBlockHtml(input: SignatureBlockInput): string {
    const place = [input.city, input.date].filter(Boolean).join(', ');

    return `
    <table class="team-doc-signature">
      <tr>
        <td style="width:50%;text-align:center;">
          ____________________________<br/>
          ${this.escapeHtml(input.memberLabel || 'Colaborador/Prestador')}${
            input.memberRole ? `<br/>${this.escapeHtml(input.memberRole)}` : ''
          }
        </td>
        <td style="width:50%;text-align:center;">
          ____________________________<br/>
          ${this.escapeHtml(input.agencyLabel || 'Responsável da agência')}${
            input.agencyRole ? `<br/>${this.escapeHtml(input.agencyRole)}` : ''
          }
        </td>
      </tr>
      ${place ? `<tr><td colspan="2" style="text-align:center;">${this.escapeHtml(place)}</td></tr>` : ''}
    </table>`;
  }

  buildTeamAttendanceReportHtml(input: RenderTeamAttendanceReportInput): string {
    const { agency, member, period, attendance, signature, document } = input;

    const rows = attendance.records.length
      ? attendance.records
          .map(
            (record) => `
        <tr>
          <td>${this.escapeHtml(this.formatTeamDate(record.date, document.locale))}</td>
          <td style="text-align:center;">${this.escapeHtml(record.checkIn ?? '-')}</td>
          <td style="text-align:center;">${this.escapeHtml(record.checkOut ?? '-')}</td>
          <td style="text-align:center;">${this.escapeHtml(record.breakMinutes ? `${record.breakMinutes} min` : '-')}</td>
          <td style="text-align:center;">${this.escapeHtml(record.totalHours != null ? `${record.totalHours.toFixed(2)}h` : '-')}</td>
          <td>${this.escapeHtml(this.attendanceStatusLabel(record.status))}${record.note ? ` — ${this.escapeHtml(record.note)}` : ''}</td>
        </tr>`,
          )
          .join('')
      : `<tr><td colspan="6" style="text-align:center;color:#64748b;">Nenhum registro de presença no período.</td></tr>`;

    const body = `
      <h1>Relatório de Presença</h1>
      <div class="team-doc-grid">
        <div><strong>Colaborador/Prestador:</strong> ${this.escapeHtml(member.displayName)}</div>
        <div><strong>Cargo:</strong> ${this.escapeHtml(member.role)}</div>
        <div><strong>Empresa:</strong> ${this.escapeHtml(agency.publicName)}</div>
        <div><strong>Período:</strong> ${this.escapeHtml(period.label)} (${this.escapeHtml(period.startDate)} a ${this.escapeHtml(period.endDate)})</div>
      </div>
      <table class="team-doc-table">
        <thead>
          <tr><th>Data</th><th>Entrada</th><th>Saída</th><th>Intervalo</th><th>Total</th><th>Status</th></tr>
        </thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="team-doc-totals">
        <div><span>Horas trabalhadas</span><strong>${attendance.aggregates.totalWorkedHours.toFixed(2)}h</strong></div>
        <div><span>Horas previstas</span><strong>${attendance.aggregates.expectedHours.toFixed(2)}h</strong></div>
        <div><span>Horas extras</span><strong>${attendance.aggregates.overtimeHours.toFixed(2)}h</strong></div>
        <div><span>Saldo</span><strong>${attendance.aggregates.balanceHours.toFixed(2)}h</strong></div>
      </div>
      ${this.buildSignatureBlockHtml({
        memberLabel: signature.memberName,
        memberRole: signature.memberRole,
        agencyLabel: signature.agencySignerName,
        agencyRole: signature.agencySignerRole,
        city: signature.city,
        date: signature.date,
      })}
    `;

    return this.wrapTeamDocumentHtml({ title: 'Relatório de Presença', bodyHtml: body, pageSize: 'A4', agency, presentation: input.presentation });
  }

  buildTeamPayslipHtml(input: RenderTeamPayslipInput): string {
    const buildVia = (label: string) => `
      <div class="team-doc-payslip-via">
        <h2>${this.escapeHtml(label)}</h2>
        <div class="team-doc-grid">
          <div><strong>Empresa:</strong> ${this.escapeHtml(input.agency.publicName)}</div>
          <div><strong>CNPJ/Tax ID:</strong> ${this.escapeHtml(input.agency.taxId)}</div>
          <div><strong>Colaborador:</strong> ${this.escapeHtml(input.member.displayName)}</div>
          <div><strong>Cargo:</strong> ${this.escapeHtml(input.member.role)}</div>
          <div><strong>Vínculo:</strong> ${this.escapeHtml(input.member.department)}</div>
          <div><strong>Período:</strong> ${this.escapeHtml(input.period.label)}</div>
        </div>
        <table class="team-doc-table">
          <thead><tr><th>Provento/Desconto</th><th style="text-align:right;">Valor</th></tr></thead>
          <tbody>
            ${(input.earnings?.length ? input.earnings : [{ name: 'Salário/valor base', amount: input.payment.baseAmount }])
              .map(
                (item) => `<tr><td>${this.escapeHtml(item.name)}</td><td style="text-align:right;">${this.escapeHtml(this.formatTeamMoney(item.amount, input.payment.currency, input.document.locale))}</td></tr>`,
              )
              .join('')}
            ${input.benefits
              .map(
                (item) => `
            <tr>
              <td>${this.escapeHtml(item.name)}</td>
              <td style="text-align:right;">${this.escapeHtml(this.formatTeamMoney(item.amount, input.payment.currency, input.document.locale))}</td>
            </tr>`,
              )
              .join('')}
            ${input.deductions
              .map(
                (item) => `
            <tr>
              <td>(-) ${this.escapeHtml(item.name)}</td>
              <td style="text-align:right;">-${this.escapeHtml(this.formatTeamMoney(item.amount, input.payment.currency, input.document.locale))}</td>
            </tr>`,
              )
              .join('')}
          </tbody>
        </table>
        <div class="team-doc-totals">
          <div><span>Valor bruto</span><strong>${this.escapeHtml(this.formatTeamMoney(input.payment.grossAmount, input.payment.currency, input.document.locale))}</strong></div>
          <div><span>Valor líquido</span><strong>${this.escapeHtml(this.formatTeamMoney(input.payment.netAmount, input.payment.currency, input.document.locale))}</strong></div>
        </div>
        ${this.buildSignatureBlockHtml({
          memberLabel: input.signature.memberName,
          memberRole: input.signature.memberRole,
          agencyLabel: input.signature.agencySignerName,
          agencyRole: input.signature.agencySignerRole,
          city: input.signature.city,
          date: input.signature.date,
        })}
      </div>`;

    const body = `
      <p class="team-doc-disclaimer">${this.escapeHtml(input.payment.notes)}</p>
      <table class="team-doc-payslip-split">
        <tr>
          <td style="width:50%;">${buildVia('Via da empresa')}</td>
          <td style="width:50%;">${buildVia('Via do colaborador')}</td>
        </tr>
      </table>`;

    return this.wrapTeamDocumentHtml({ title: 'Holerite', bodyHtml: body, pageSize: input.pageSize, agency: input.agency, presentation: input.presentation });
  }

  buildTeamPaymentStatementHtml(input: RenderTeamPaymentStatementInput): string {
    const body = `
      <h1>Demonstrativo Financeiro</h1>
      <div class="team-doc-grid">
        <div><strong>Contratante:</strong> ${this.escapeHtml(input.agency.publicName)}</div>
        <div><strong>Tax ID:</strong> ${this.escapeHtml(input.agency.taxId)}</div>
        <div><strong>Prestador:</strong> ${this.escapeHtml(input.member.displayName)}</div>
        <div><strong>Documento:</strong> ${this.escapeHtml(input.member.document)}</div>
        <div><strong>Período:</strong> ${this.escapeHtml(input.period.label)}</div>
        <div><strong>Contrato:</strong> ${this.escapeHtml(input.contract.number)}</div>
        <div><strong>Forma de pagamento:</strong> ${this.escapeHtml(input.payment.paymentMethod)}</div>
      </div>
      <table class="team-doc-table">
        <thead><tr><th>Item</th><th style="text-align:right;">Valor</th></tr></thead>
        <tbody>
          ${(input.earnings?.length ? input.earnings : [{ name: 'Valor base', amount: input.payment.baseAmount }])
            .map(
              (item) => `<tr><td>${this.escapeHtml(item.name)}</td><td style="text-align:right;">${this.escapeHtml(this.formatTeamMoney(item.amount, input.payment.currency, input.document.locale))}</td></tr>`,
            )
            .join('')}
          ${input.benefits
            .map(
              (item) => `
          <tr>
            <td>${this.escapeHtml(item.name)}</td>
            <td style="text-align:right;">${this.escapeHtml(this.formatTeamMoney(item.amount, input.payment.currency, input.document.locale))}</td>
          </tr>`,
            )
            .join('')}
          ${input.deductions
            .map(
              (item) => `
          <tr>
            <td>(-) ${this.escapeHtml(item.name)}</td>
            <td style="text-align:right;">-${this.escapeHtml(this.formatTeamMoney(item.amount, input.payment.currency, input.document.locale))}</td>
          </tr>`,
            )
            .join('')}
        </tbody>
      </table>
      <div class="team-doc-totals">
        <div><span>Valor bruto</span><strong>${this.escapeHtml(this.formatTeamMoney(input.payment.grossAmount, input.payment.currency, input.document.locale))}</strong></div>
        <div><span>Valor líquido</span><strong>${this.escapeHtml(this.formatTeamMoney(input.payment.netAmount, input.payment.currency, input.document.locale))}</strong></div>
      </div>
      <p class="team-doc-disclaimer">${this.escapeHtml(input.payment.notes)}</p>
      ${this.buildSignatureBlockHtml({
        memberLabel: input.signature.memberName,
        memberRole: input.signature.memberRole,
        agencyLabel: input.signature.agencySignerName,
        agencyRole: input.signature.agencySignerRole,
        city: input.signature.city,
        date: input.signature.date,
      })}
    `;

    return this.wrapTeamDocumentHtml({ title: 'Demonstrativo Financeiro', bodyHtml: body, pageSize: 'A4', agency: input.agency, presentation: input.presentation });
  }

  buildTeamBenefitAcknowledgmentHtml(input: RenderTeamBenefitAcknowledgmentInput): string {
    const total = input.benefits.reduce((sum, item) => sum + item.amount, 0);
    const rows = input.benefits
      .map(
        (item) => `
          <tr>
            <td>${this.escapeHtml(item.name)}</td>
            <td style="text-align:right;">${this.escapeHtml(this.formatTeamMoney(item.amount, input.payment.currency, input.document.locale))}</td>
          </tr>`,
      )
      .join('');

    const body = `
      <h1>Declaração de Recebimento de Benefícios</h1>
      <div class="team-doc-grid">
        <div><strong>Empresa:</strong> ${this.escapeHtml(input.agency.publicName)}</div>
        <div><strong>CNPJ/Tax ID:</strong> ${this.escapeHtml(input.agency.taxId)}</div>
        <div><strong>Colaborador:</strong> ${this.escapeHtml(input.member.displayName)}</div>
        <div><strong>Documento:</strong> ${this.escapeHtml(input.member.document)}</div>
        <div><strong>Período:</strong> ${this.escapeHtml(input.period.label)}</div>
      </div>
      <p>Declaro, para os devidos fins, que recebi os benefícios abaixo referentes ao período informado:</p>
      <table class="team-doc-table">
        <thead><tr><th>Benefício</th><th style="text-align:right;">Valor</th></tr></thead>
        <tbody>${rows}</tbody>
      </table>
      <div class="team-doc-totals">
        <div><span>Total de benefícios</span><strong>${this.escapeHtml(this.formatTeamMoney(total, input.payment.currency, input.document.locale))}</strong></div>
      </div>
      ${this.buildSignatureBlockHtml({
        memberLabel: input.signature.memberName,
        memberRole: input.signature.memberRole,
        agencyLabel: input.signature.agencySignerName,
        agencyRole: input.signature.agencySignerRole,
        city: input.signature.city,
        date: input.signature.date,
      })}
    `;

    return this.wrapTeamDocumentHtml({
      title: 'Declaração de Recebimento de Benefícios',
      bodyHtml: body,
      pageSize: 'A4',
      agency: input.agency,
      presentation: input.presentation,
    });
  }

  private wrapTeamDocumentHtml(input: {
    title: string;
    bodyHtml: string;
    pageSize: 'A4' | 'LETTER';
    agency: TeamDocumentAgency;
    presentation?: TeamDocumentPresentation;
  }): string {
    const presentation = input.presentation ?? {};
    const header = presentation.headerPreset === 'none' ? '' : `
      <header class="team-doc-header">
        ${presentation.showLogo !== false && presentation.logoUrl ? `<img src="${this.escapeHtml(presentation.logoUrl)}" alt="${this.escapeHtml(input.agency.publicName)}"/>` : ''}
        ${presentation.showCompanyData !== false ? `<div><strong>${this.escapeHtml(input.agency.publicName)}</strong><br/>${this.escapeHtml(input.agency.taxId)}${input.agency.email ? `<br/>${this.escapeHtml(input.agency.email)}` : ''}</div>` : ''}
        ${presentation.showDocumentNumber && presentation.documentNumber ? `<span>${this.escapeHtml(presentation.documentNumber)}</span>` : ''}
      </header>`;
    const footerLabel = presentation.footerPreset === 'legal'
      ? 'Documento informativo — valide as obrigações fiscais e trabalhistas aplicáveis.'
      : presentation.footerPreset === 'company'
        ? input.agency.publicName
        : presentation.showPoweredByLyra === false
          ? ''
          : 'Gerado por Lyra Agency';
    const footer = presentation.footerPreset === 'none' || !footerLabel
      ? ''
      : `<footer class="team-doc-footer">${this.escapeHtml(footerLabel)}</footer>`;
    return `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${this.escapeHtml(input.title)}</title>
  <style>
    @page { size: ${input.pageSize === 'LETTER' ? 'Letter' : 'A4'}; margin: 16mm; }
    body { font-family: Arial, Helvetica, sans-serif; color: #0F172A; font-size: 12px; }
    h1 { font-size: 18px; margin: 0 0 12px; }
    h2 { font-size: 14px; margin: 0 0 8px; }
    .team-doc-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 4px 16px; margin-bottom: 16px; font-size: 11px; }
    .team-doc-table { width: 100%; border-collapse: collapse; margin-bottom: 16px; }
    .team-doc-table th, .team-doc-table td { border: 1px solid #CBD5E1; padding: 6px 8px; font-size: 11px; }
    .team-doc-table th { background: #F1F5F9; text-align: left; }
    .team-doc-totals { display: flex; gap: 24px; margin-bottom: 16px; }
    .team-doc-totals div { display: flex; flex-direction: column; }
    .team-doc-totals span { color: #64748B; font-size: 10px; }
    .team-doc-totals strong { font-size: 13px; }
    .team-doc-signature { width: 100%; margin-top: 64px; font-size: 11px; border: none; }
    .team-doc-signature td { padding-top: 40px; border: none; }
    .team-doc-payslip-split { width: 100%; border-collapse: collapse; }
    .team-doc-payslip-via { border: 1px dashed #CBD5E1; padding: 12px; }
    .team-doc-disclaimer { color: #64748B; font-size: 10px; margin-bottom: 12px; }
    .team-doc-header { display:flex; align-items:flex-start; justify-content:space-between; gap:16px; padding-bottom:12px; margin-bottom:18px; border-bottom:1px solid #CBD5E1; color:#475569; font-size:10px; }
    .team-doc-header img { max-width:140px; max-height:48px; object-fit:contain; }
    .team-doc-header span { margin-left:auto; font-weight:700; }
    .team-doc-footer { margin-top:24px; padding-top:8px; border-top:1px solid #E2E8F0; color:#64748B; font-size:9px; text-align:center; }
  </style>
</head>
<body>${header}${input.bodyHtml}${footer}</body>
</html>`;
  }

  private formatTeamMoney(amount: number, currency: string, locale = 'pt-BR'): string {
    try {
      return new Intl.NumberFormat(locale, {
        style: 'currency',
        currency: currency || 'BRL',
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      }).format(amount);
    } catch {
      return `${currency || 'BRL'} ${amount.toFixed(2)}`;
    }
  }

  private formatTeamDate(value: string | null | undefined, locale = 'pt-BR'): string {
    if (!value) return '-';

    const dateParts = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
    if (dateParts) {
      const date = new Date(Number(dateParts[1]), Number(dateParts[2]) - 1, Number(dateParts[3]));
      return new Intl.DateTimeFormat(locale).format(date);
    }

    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat(locale).format(date);
  }

  private attendanceStatusLabel(status?: string): string {
    switch (status) {
      case 'absence':
        return 'Falta/ausência';
      case 'late':
        return 'Atraso';
      case 'present':
        return 'Presente';
      default:
        return status || 'Presente';
    }
  }
}
