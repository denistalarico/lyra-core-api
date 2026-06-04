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
      : `Proposta comercial ${quote.quoteNumber}`;
  }

  private escapeCssValue(value: string) {
    return value.replace(/[<>{};]/g, '');
  }
}
