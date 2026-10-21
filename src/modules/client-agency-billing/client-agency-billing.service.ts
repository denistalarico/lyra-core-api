import type { ClientAreaCompanyScope } from '../client-area/client-area-company-hooks.registry';
import {
  clientContractDocumentTypes,
  isClientSignedDocument,
} from './client-contract-document.view';
import { ContactEntity } from '../contacts/entities/contact.entity';
import {
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, In, Not } from 'typeorm';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { isUuid } from '../client-area/client-area.types';
import { toCompanyAwareScope } from '../client-area/client-area-scope';
import { ClientInvoiceOwnershipResolver } from '../finance/services/client-invoice-ownership.resolver';
import { FinanceInvoice, FinanceInvoiceLine } from '../finance/entities';
import { FinanceInvoiceStatus } from '../finance/enums';
import { FinanceService } from '../finance/services/finance.service';
import { DocumentLayoutsService } from '../document-layouts/document-layouts.service';
import { DocumentPdfRendererService } from '../document-layouts/document-pdf-renderer.service';
import {
  ContractRecord,
  ContractDocument,
  ContractDefaults,
} from '../contracts/entities';
import { ContractTargetType } from '../contracts/enums';
import { readClientContractTerms } from '../contracts/contract-term-reader';
import { isSignedContract } from '../contracts/contract-term';
import { ContractsService } from '../contracts/services/contracts.service';

export function billingOwnerScope(context: ClientAreaContext) {
  if ((context.accountRole ?? context.role) !== 'client_owner')
    throw new ForbiddenException('Owner required.');
  return toCompanyAwareScope(context);
}
export const invoiceView = (row: FinanceInvoice) => ({
  id: row.id,
  invoiceNumber: row.invoiceNumber,
  status: row.status,
  currency: row.currency,
  issueDate: row.issueDate,
  dueDate: row.dueDate,
  periodStart: row.periodStart,
  periodEnd: row.periodEnd,
  subtotalAmount: row.subtotalAmount,
  taxAmount: row.taxAmount,
  discountAmount: row.discountAmount,
  totalAmount: row.totalAmount,
  paidAmount: row.paidAmount,
  writtenOffAmount: row.writtenOffAmount ?? '0.00',
  balanceDue: row.balanceDue,
  issuedAt: row.issuedAt,
  paidAt: row.paidAt,
  cancelledAt: row.cancelledAt,
});
const lineView = (row: FinanceInvoiceLine) => ({
  id: row.id,
  description: row.description,
  quantity: row.quantity,
  unitPrice: row.unitPrice,
  discountAmount: row.discountAmount,
  taxAmount: row.taxAmount,
  totalAmount: row.totalAmount,
});

@Injectable()
export class ClientAgencyBillingService {
  constructor(
    @InjectDataSource('agency') private readonly db: DataSource,
    private readonly ownership: ClientInvoiceOwnershipResolver,
    private readonly layouts: DocumentLayoutsService,
    private readonly renderer: DocumentPdfRendererService,
    private readonly contracts: ContractsService,
    private readonly finance: FinanceService,
  ) {}

  async invoices(context: ClientAreaContext) {
    return this.invoicesInScope(billingOwnerScope(context));
  }
  async invoicesInScope(scope: ClientAreaCompanyScope) {
    const owners = await this.ownership.resolve(scope);
    const customers = [
      scope.agencyClientId,
      ...[...owners]
        .filter(([, clientId]) => clientId === scope.agencyClientId)
        .map(([id]) => id),
    ];
    const rows = await this.db.getRepository(FinanceInvoice).find({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        customerId: In(customers),
        status: Not(FinanceInvoiceStatus.Draft),
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    return { invoices: rows.map(invoiceView) };
  }
  async visibleInvoice(context: ClientAreaContext, id: string) {
    const scope = billingOwnerScope(context);
    if (!isUuid(id)) throw new NotFoundException();
    const row = await this.db.getRepository(FinanceInvoice).findOne({
      where: {
        id,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        status: Not(FinanceInvoiceStatus.Draft),
      },
    });
    const owners = await this.ownership.resolve(scope);
    if (
      !row ||
      (owners.get(row.customerId ?? '') ?? row.customerId) !==
        scope.agencyClientId
    )
      throw new NotFoundException('Invoice not found.');
    return row;
  }
  async invoice(context: ClientAreaContext, id: string) {
    const row = await this.visibleInvoice(context, id),
      scope = toCompanyAwareScope(context);
    const lines = await this.db.getRepository(FinanceInvoiceLine).find({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        invoiceId: id,
      },
      order: { createdAt: 'ASC' },
    });
    const payments = await this.db.query<
      {
        amount: string;
        currency: string;
        paymentDate: string;
        status: string;
        method: string;
      }[]
    >(
      `SELECT a.amount, p.currency, p.payment_date AS "paymentDate", p.status, p.method FROM finance_payment_allocations a JOIN finance_payments p ON p.id=a.payment_id AND p.tenant_id=a.tenant_id AND p.workspace_id=a.workspace_id WHERE a.tenant_id=$1 AND a.workspace_id=$2 AND a.target_type='invoice' AND a.target_id=$3 ORDER BY p.payment_date DESC, a.id`,
      [scope.tenantId, scope.workspaceId, id],
    );
    return {
      invoice: invoiceView(row),
      lines: lines.map(lineView),
      payments: payments.map((p) => ({
        amount: p.amount,
        currency: p.currency,
        paymentDate: p.paymentDate,
        status: p.status,
        method: p.method,
      })),
    };
  }
  async invoicePdf(context: ClientAreaContext, id: string) {
    const row = await this.visibleInvoice(context, id),
      scope = { ...toCompanyAwareScope(context), userId: context.userId };
    const details = await this.invoice(context, id);
    const customer = row.customerId
      ? await this.db.getRepository(ContactEntity).findOne({
          where: {
            id: row.customerId,
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
          },
        })
      : null;
    const customerName =
      customer?.displayName?.trim() ||
      (typeof row.metadata?.customerName === 'string'
        ? row.metadata.customerName.trim()
        : '') ||
      'Cliente';
    const invoice = Object.assign(new FinanceInvoice(), invoiceView(row), {
      terms: row.terms,
      notes: null,
      metadata: { customerName },
    });
    const lines = details.lines.map((line) =>
      Object.assign(new FinanceInvoiceLine(), line),
    );
    const layout = await this.layouts.getDefaultLayout(scope);
    const template =
      (await this.layouts.getSystemTemplateForType(
        layout.layoutType,
        'invoice',
      )) ??
      (await this.layouts.getSystemTemplateForType(layout.layoutType, 'quote'));
    if (!template)
      throw new NotFoundException('Document layout template not found.');
    const accounts = (await this.finance.listBankAccounts(scope)).filter(
      (account) => account.active !== false,
    );
    const paymentAccount =
      accounts.find(
        (account) => account.isPrimary && account.bankDetails?.pixKey?.trim(),
      ) ??
      accounts.find((account) => account.bankDetails?.pixKey?.trim()) ??
      accounts.find((account) => account.isPrimary) ??
      accounts[0] ??
      null;
    return {
      buffer: await this.renderer.renderInvoicePdf({
        invoice,
        lines,
        layout,
        template,
        paymentAccount,
      }),
      fileName: `invoice-${row.invoiceNumber.replace(/[^a-zA-Z0-9-_]/g, '-')}.pdf`,
    };
  }
  async contractHistory(context: ClientAreaContext) {
    return this.contractHistoryInScope(billingOwnerScope(context));
  }
  async contractHistoryInScope(scope: ClientAreaCompanyScope) {
    const records = await this.db.getRepository(ContractRecord).find({
      where: {
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        targetType: ContractTargetType.Client,
        targetId: scope.agencyClientId,
      },
      order: { createdAt: 'DESC', id: 'DESC' },
    });
    const documents = records.length
      ? await this.db.getRepository(ContractDocument).find({
          where: {
            tenantId: scope.tenantId,
            workspaceId: scope.workspaceId,
            contractId: In(records.map((row) => row.id)),
            type: In(clientContractDocumentTypes),
          },
          order: { createdAt: 'DESC' },
        })
      : [];
    const history = records
      .filter((row) =>
        isSignedContract({
          ...row,
          documents: documents.filter((doc) => doc.contractId === row.id),
        }),
      )
      .map((row) => ({
        id: row.id,
        title: row.title,
        status: row.status,
        documentKind: row.documentKind,
        parentContractId: row.parentContractId,
        validFrom: row.validFrom,
        validUntil: row.validUntil,
        signedAt: row.signedAt,
        documents: documents
          .filter((doc) => isClientSignedDocument(row, doc))
          .map((doc) => ({
            id: doc.id,
            type: doc.type,
            fileName: doc.fileName,
            sizeBytes: doc.sizeBytes,
            createdAt: doc.createdAt,
          })),
      }));
    const terms = await readClientContractTerms(
      this.db.getRepository(ContractRecord),
      this.db.getRepository(ContractDefaults),
      scope,
      [scope.agencyClientId],
    );
    const term = terms.get(scope.agencyClientId);
    const current =
      term && history.some((row) => row.id === term.contractId)
        ? {
            contractId: term.contractId,
            state: term.state,
            title: term.title,
            validFrom: term.validFrom,
            validUntil: term.validUntil,
            daysUntilEnd: term.daysUntilEnd,
            autoRenewal: term.autoRenewal,
            monthlyValue: term.monthlyValue,
            dueDay: term.dueDay,
            currency: term.currency,
            terminatesAt: term.terminatesAt,
          }
        : null;
    return { current, history };
  }
  async contractPdf(
    context: ClientAreaContext,
    contractId: string,
    documentId: string,
  ) {
    const scope = billingOwnerScope(context);
    if (!isUuid(contractId) || !isUuid(documentId))
      throw new NotFoundException();
    const record = await this.db.getRepository(ContractRecord).findOne({
      where: {
        id: contractId,
        tenantId: scope.tenantId,
        workspaceId: scope.workspaceId,
        targetType: ContractTargetType.Client,
        targetId: scope.agencyClientId,
      },
    });
    const doc =
      record &&
      (await this.db.getRepository(ContractDocument).findOne({
        where: {
          id: documentId,
          contractId,
          tenantId: scope.tenantId,
          workspaceId: scope.workspaceId,
          type: In(clientContractDocumentTypes),
        },
      }));
    if (!doc || !record || !isClientSignedDocument(record, doc))
      throw new NotFoundException('Document not found.');
    return this.contracts.getContractDocumentFile(
      scope,
      contractId,
      documentId,
    );
  }
}
