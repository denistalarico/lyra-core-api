import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository } from 'typeorm';
import {
  BillRecurrenceConfigDto,
  CreateFinanceBillDto,
  CreateFinanceBillRecurrenceDto,
  CreateFinanceInvoiceDto,
  CreateFinancePaymentDto,
  CreateFinanceRecurringProfileDto,
  FinanceBillRecurrenceLineInputDto,
  AllocateFinancePaymentDto,
  UpdateFinanceBillDto,
  UpdateFinanceBillRecurrenceDto,
  UpdateFinanceInvoiceDto,
  UpdateFinanceRecurringProfileDto,
} from '../dto';
import {
  FinanceBankAccount,
  FinanceBill,
  FinanceBillLine,
  FinanceBillRecurrence,
  FinanceInvoice,
  FinanceInvoiceLine,
  FinancePayment,
  FinancePaymentAllocation,
  FinanceRecurringProfile,
  FinanceSetting,
} from '../entities';
import type { FinanceBillRecurrenceLineTemplate } from '../entities';
import {
  FinanceAllocationTargetType,
  FinanceBillRecurrenceFrequency,
  FinanceBillRecurrenceStatus,
  FinanceBillStatus,
  FinanceInvoiceStatus,
  FinancePaymentDirection,
  FinancePaymentMethod,
  FinancePaymentStatus,
  FinanceRecurringInterval,
  FinanceRecurringProfileStatus,
} from '../enums';
import { FinanceRequestContext } from './finance-context';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';
import { FinanceJournalEntryService } from './finance-journal-entry.service';
import { FinancePostingService } from './finance-posting.service';
import { FinanceNotificationPublisher } from './finance-notification.publisher';
import { FinanceTeamPaymentReconciliationService } from './finance-team-payment-reconciliation.service';

function toMoney(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;
  const parsed = Number(value);
  if (Number.isNaN(parsed)) return 0;
  return parsed;
}

function money(value: number): string {
  return value.toFixed(2);
}

function validateId(value: string | null | undefined, name = 'id') {
  if (!value || value === 'null') {
    throw new BadRequestException(`Invalid ${name}`);
  }
}

type ScheduledPaymentTarget = {
  targetType: FinanceAllocationTargetType;
  targetId: string;
};

@Injectable()
export class FinanceBillingService {
  private readonly logger = new Logger(FinanceBillingService.name);

  constructor(
    @InjectRepository(FinanceInvoice, 'agency')
    private readonly invoicesRepo: Repository<FinanceInvoice>,

    @InjectRepository(FinanceInvoiceLine, 'agency')
    private readonly invoiceLinesRepo: Repository<FinanceInvoiceLine>,

    @InjectRepository(FinanceBill, 'agency')
    private readonly billsRepo: Repository<FinanceBill>,

    @InjectRepository(FinanceBillLine, 'agency')
    private readonly billLinesRepo: Repository<FinanceBillLine>,

    @InjectRepository(FinancePayment, 'agency')
    private readonly paymentsRepo: Repository<FinancePayment>,

    @InjectRepository(FinancePaymentAllocation, 'agency')
    private readonly paymentAllocationsRepo: Repository<FinancePaymentAllocation>,

    @InjectRepository(FinanceBankAccount, 'agency')
    private readonly bankAccountsRepo: Repository<FinanceBankAccount>,

    @InjectRepository(FinanceRecurringProfile, 'agency')
    private readonly recurringProfilesRepo: Repository<FinanceRecurringProfile>,

    @InjectRepository(FinanceBillRecurrence, 'agency')
    private readonly billRecurrencesRepo: Repository<FinanceBillRecurrence>,

    @InjectRepository(FinanceSetting, 'agency')
    private readonly settingsRepo: Repository<FinanceSetting>,

    @InjectDataSource('agency')
    private readonly dataSource: DataSource,

    private readonly documentNumberingService: FinanceDocumentNumberingService,
    private readonly journalEntryService: FinanceJournalEntryService,
    private readonly postingService: FinancePostingService,
    private readonly financeNotificationPublisher: FinanceNotificationPublisher,
    private readonly financeTeamPaymentReconciliationService: FinanceTeamPaymentReconciliationService,
  ) {}

  private async reconcileTeamPaymentsForBills(
    ctx: FinanceRequestContext,
    billIds: Iterable<string>,
  ) {
    const uniqueBillIds = [...new Set(billIds)];
    if (uniqueBillIds.length === 0) return;
    try {
      await this.financeTeamPaymentReconciliationService.reconcileBills(
        ctx,
        uniqueBillIds,
      );
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      this.logger.warn(
        `Team payment reconciliation failed for Finance bills ${uniqueBillIds.join(', ')}: ${message}`,
      );
    }
  }

  listInvoices(ctx: FinanceRequestContext) {
    return this.invoicesRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  async getInvoice(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!invoice) throw new NotFoundException('Finance invoice not found');

    const lines = await this.invoiceLinesRepo.find({
      where: {
        invoiceId: id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: { createdAt: 'ASC' },
    });

    return { ...invoice, lines };
  }

  async getPublicInvoiceById(id: string) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({ where: { id } });

    if (!invoice) throw new NotFoundException('Finance invoice not found');

    const lines = await this.invoiceLinesRepo.find({
      where: {
        invoiceId: id,
        tenantId: invoice.tenantId,
        workspaceId: invoice.workspaceId,
      },
      order: { createdAt: 'ASC' },
    });

    return { ...invoice, lines };
  }

  async createInvoice(
    ctx: FinanceRequestContext,
    dto: CreateFinanceInvoiceDto,
  ) {
    // New invoices are born as drafts and carry no number: the sequence is
    // only consumed when the invoice is issued (see issueInvoice), so an
    // abandoned draft never burns a number.
    const invoiceNumber = dto.invoiceNumber ?? '';
    const invoiceLines = dto.lines ?? [];
    const totals = this.calculateInvoiceTotals(invoiceLines);

    const invoiceId = await this.dataSource.transaction(async (manager) => {
      const invoice = await manager.getRepository(FinanceInvoice).save(
        manager.getRepository(FinanceInvoice).create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          customerId: dto.customerId ?? null,
          sourceModule: dto.sourceModule ?? null,
          sourceId: dto.sourceId ?? null,
          invoiceNumber,
          status: FinanceInvoiceStatus.Draft,
          currency: dto.currency ?? 'BRL',
          issueDate: dto.issueDate ?? null,
          dueDate: dto.dueDate ?? null,
          periodStart: dto.periodStart ?? null,
          periodEnd: dto.periodEnd ?? null,
          subtotalAmount: money(totals.subtotal),
          taxAmount: money(totals.tax),
          discountAmount: money(totals.discount),
          totalAmount: money(totals.total),
          paidAmount: '0.00',
          balanceDue: money(totals.total),
          terms: dto.terms ?? null,
          notes: dto.notes ?? null,
          metadata: dto.metadata ?? {},
        }),
      );

      const lines = invoiceLines.map((line) => {
        const quantity = toMoney(line.quantity ?? '1');
        const unitPrice = toMoney(line.unitPrice ?? '0');
        const discount = toMoney(line.discountAmount ?? '0');
        const tax = toMoney(line.taxAmount ?? '0');
        const total = quantity * unitPrice - discount + tax;

        return manager.getRepository(FinanceInvoiceLine).create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          invoiceId: invoice.id,
          productId: line.productId ?? null,
          serviceId: line.serviceId ?? null,
          description: line.description,
          quantity: quantity.toFixed(4),
          unitPrice: money(unitPrice),
          discountAmount: money(discount),
          taxAmount: money(tax),
          totalAmount: money(total),
          categoryId: line.categoryId ?? null,
          costCenterId: line.costCenterId ?? null,
          metadata: line.metadata ?? {},
        });
      });

      if (lines.length > 0) {
        await manager.getRepository(FinanceInvoiceLine).save(lines);
      }

      return invoice.id;
    });

    // A draft invoice forecasts no "previsto" payment until it is issued
    // (see issueInvoice / updateInvoice), so none is created here.
    return this.getInvoice(ctx, invoiceId);
  }

  async updateInvoice(
    ctx: FinanceRequestContext,
    id: string,
    dto: UpdateFinanceInvoiceDto,
  ) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!invoice) throw new NotFoundException('Finance invoice not found');

    const previousStatus = invoice.status;

    const shouldSettleFromStatusPatch =
      dto.status === FinanceInvoiceStatus.Paid &&
      previousStatus !== FinanceInvoiceStatus.Paid &&
      toMoney(invoice.balanceDue) > 0;

    // Merge metadata deeply instead of overwriting
    if (dto.metadata !== undefined) {
      invoice.metadata = { ...invoice.metadata, ...dto.metadata };
    }
    const { metadata: _meta, status: requestedStatus, ...rest } = dto;
    Object.assign(invoice, rest);
    if (!shouldSettleFromStatusPatch && requestedStatus !== undefined) {
      invoice.status = requestedStatus;
    }
    if (
      shouldSettleFromStatusPatch &&
      invoice.status === FinanceInvoiceStatus.Draft
    ) {
      invoice.status = FinanceInvoiceStatus.Issued;
      invoice.issuedAt = invoice.issuedAt ?? new Date();
      invoice.issueDate =
        invoice.issueDate ?? new Date().toISOString().slice(0, 10);
    }

    // Issuing through a generic PATCH also consumes the number if the draft
    // never had one.
    if (
      previousStatus !== FinanceInvoiceStatus.Issued &&
      invoice.status === FinanceInvoiceStatus.Issued &&
      !invoice.invoiceNumber
    ) {
      invoice.invoiceNumber = await this.generateDocumentNumber(ctx, 'INV');
    }

    const saved = await this.invoicesRepo.save(invoice);

    // Keep the ledger in sync when the status changes through a generic PATCH
    // (the dedicated /issue and /cancel endpoints are the primary paths).
    // Posting is idempotent, so a transition that was already posted is a no-op.
    if (
      previousStatus !== FinanceInvoiceStatus.Issued &&
      saved.status === FinanceInvoiceStatus.Issued
    ) {
      await this.postingService.postInvoiceConfirmed(ctx, saved.id);
      // Forecast the receivable once, on issue. Skipped when this same PATCH
      // is settling the invoice straight to paid (which registers its own
      // completed payment below).
      if (!shouldSettleFromStatusPatch) {
        await this.ensureScheduledPaymentForInvoice(ctx, saved);
      }
    }

    if (
      previousStatus !== FinanceInvoiceStatus.Cancelled &&
      saved.status === FinanceInvoiceStatus.Cancelled
    ) {
      await this.postingService.reverseInvoice(ctx, saved.id);
    }

    // No tenant-validated recipient source exists yet (only the actor, who
    // is self-suppressed), so these calls currently resolve to zero
    // recipients and the publisher is a no-op. Kept wired for when a real
    // recipient source (e.g. invoice owner membership) is available.
    if (
      previousStatus !== FinanceInvoiceStatus.Issued &&
      saved.status === FinanceInvoiceStatus.Issued
    ) {
      await this.financeNotificationPublisher.publishInvoiceIssued({
        resource: saved,
        actorUserId: ctx.userId,
        recipients: [],
      });
    }

    if (shouldSettleFromStatusPatch) {
      await this.settleInvoiceBalance(ctx, saved, {
        source: 'status_patch_paid',
      });
      return this.getInvoice(ctx, id);
    }

    if (
      previousStatus !== FinanceInvoiceStatus.Paid &&
      saved.status === FinanceInvoiceStatus.Paid
    ) {
      await this.financeNotificationPublisher.publishInvoicePaid({
        resource: saved,
        actorUserId: ctx.userId,
        recipients: [],
      });
    }

    return this.getInvoice(ctx, id);
  }

  private async recalcInvoiceTotals(
    ctx: FinanceRequestContext,
    invoiceId: string,
  ) {
    const lines = await this.invoiceLinesRepo.find({
      where: {
        invoiceId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    let subtotal = 0,
      tax = 0,
      discount = 0;
    for (const l of lines) {
      const qty = toMoney(l.quantity);
      const price = toMoney(l.unitPrice);
      subtotal += qty * price;
      discount += toMoney(l.discountAmount);
      tax += toMoney(l.taxAmount);
    }
    const total = subtotal - discount + tax;
    await this.invoicesRepo.update(
      { id: invoiceId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      {
        subtotalAmount: money(subtotal),
        taxAmount: money(tax),
        discountAmount: money(discount),
        totalAmount: money(total),
        balanceDue: money(total),
      },
    );
  }

  async addInvoiceLine(
    ctx: FinanceRequestContext,
    invoiceId: string,
    dto: import('../dto').AddFinanceInvoiceLineDto,
  ) {
    validateId(invoiceId, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: {
        id: invoiceId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!invoice) throw new NotFoundException('Finance invoice not found');

    const qty = toMoney(dto.quantity ?? '1');
    const price = toMoney(dto.unitPrice ?? '0');
    const discount = toMoney(dto.discountAmount ?? '0');
    const tax = toMoney(dto.taxAmount ?? '0');
    const total = qty * price - discount + tax;

    const line = await this.invoiceLinesRepo.save(
      this.invoiceLinesRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        invoiceId,
        description: dto.description,
        quantity: qty.toFixed(4),
        unitPrice: money(price),
        discountAmount: money(discount),
        taxAmount: money(tax),
        totalAmount: money(total),
        categoryId: dto.categoryId ?? null,
        costCenterId: dto.costCenterId ?? null,
        metadata: dto.metadata ?? {},
      }),
    );

    await this.recalcInvoiceTotals(ctx, invoiceId);
    return this.getInvoice(ctx, invoiceId);
  }

  async updateInvoiceLine(
    ctx: FinanceRequestContext,
    invoiceId: string,
    lineId: string,
    dto: import('../dto').UpdateFinanceInvoiceLineDto,
  ) {
    validateId(invoiceId, 'invoice id');
    validateId(lineId, 'line id');
    const line = await this.invoiceLinesRepo.findOne({
      where: {
        id: lineId,
        invoiceId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!line) throw new NotFoundException('Invoice line not found');

    if (dto.description !== undefined) line.description = dto.description;
    if (dto.quantity !== undefined)
      line.quantity = toMoney(dto.quantity).toFixed(4);
    if (dto.unitPrice !== undefined)
      line.unitPrice = money(toMoney(dto.unitPrice));
    if (dto.discountAmount !== undefined)
      line.discountAmount = money(toMoney(dto.discountAmount));
    if (dto.taxAmount !== undefined)
      line.taxAmount = money(toMoney(dto.taxAmount));
    if (dto.categoryId !== undefined) line.categoryId = dto.categoryId ?? null;
    if (dto.costCenterId !== undefined)
      line.costCenterId = dto.costCenterId ?? null;
    if (dto.metadata !== undefined)
      line.metadata = { ...line.metadata, ...dto.metadata };

    const qty = toMoney(line.quantity);
    const price = toMoney(line.unitPrice);
    const discount = toMoney(line.discountAmount);
    const tax = toMoney(line.taxAmount);
    line.totalAmount = money(qty * price - discount + tax);

    await this.invoiceLinesRepo.save(line);
    await this.recalcInvoiceTotals(ctx, invoiceId);
    return this.getInvoice(ctx, invoiceId);
  }

  async removeInvoiceLine(
    ctx: FinanceRequestContext,
    invoiceId: string,
    lineId: string,
  ) {
    validateId(invoiceId, 'invoice id');
    validateId(lineId, 'line id');
    const line = await this.invoiceLinesRepo.findOne({
      where: {
        id: lineId,
        invoiceId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!line) throw new NotFoundException('Invoice line not found');

    await this.invoiceLinesRepo.remove(line);
    await this.recalcInvoiceTotals(ctx, invoiceId);
    return this.getInvoice(ctx, invoiceId);
  }

  async deleteInvoice(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    if (!invoice) throw new NotFoundException('Finance invoice not found');
    await this.invoiceLinesRepo.delete({
      invoiceId: id,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
    });
    await this.invoicesRepo.remove(invoice);
    return { success: true, id };
  }

  async revertInvoiceToDraft(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    if (!invoice) throw new NotFoundException('Finance invoice not found');
    invoice.status = FinanceInvoiceStatus.Draft;
    await this.invoicesRepo.save(invoice);
    return this.getInvoice(ctx, id);
  }

  async issueInvoice(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!invoice) throw new NotFoundException('Finance invoice not found');

    const previousStatus = invoice.status;
    const wasIssued = previousStatus === FinanceInvoiceStatus.Issued;

    invoice.status = FinanceInvoiceStatus.Issued;
    invoice.issuedAt = new Date();

    if (!invoice.issueDate) {
      invoice.issueDate = new Date().toISOString().slice(0, 10);
    }

    // Issuing is what actually consumes the number: generate it now if the
    // draft never had one.
    if (!invoice.invoiceNumber) {
      invoice.invoiceNumber = await this.generateDocumentNumber(ctx, 'INV');
    }

    // Confirming an invoice and recognising it in the ledger are atomic:
    // if the automatic posting fails, the status change rolls back.
    const saved = await this.dataSource.transaction(async (manager) => {
      const persisted = await manager
        .getRepository(FinanceInvoice)
        .save(invoice);
      if (!wasIssued) {
        await this.postingService.postInvoiceConfirmed(
          ctx,
          persisted.id,
          manager,
        );
      }
      return persisted;
    });

    if (!wasIssued) {
      // Forecast the receivable as a "previsto" payment once, on issue.
      await this.ensureScheduledPaymentForInvoice(ctx, saved);
      // See updateInvoice: no validated recipient source yet, resolves to no-op.
      await this.financeNotificationPublisher.publishInvoiceIssued({
        resource: saved,
        actorUserId: ctx.userId,
        recipients: [],
      });
    }

    return this.getInvoice(ctx, id);
  }

  async cancelInvoice(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!invoice) throw new NotFoundException('Finance invoice not found');

    const wasCancelled = invoice.status === FinanceInvoiceStatus.Cancelled;

    invoice.status = FinanceInvoiceStatus.Cancelled;
    invoice.cancelledAt = new Date();

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(FinanceInvoice).save(invoice);
      if (!wasCancelled) {
        await this.postingService.reverseInvoice(ctx, invoice.id, manager);
      }
    });

    return this.getInvoice(ctx, id);
  }

  listBills(ctx: FinanceRequestContext) {
    return this.billsRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  async getBill(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'bill id');
    const bill = await this.billsRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!bill) throw new NotFoundException('Finance bill not found');

    const lines = await this.billLinesRepo.find({
      where: {
        billId: id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: { createdAt: 'ASC' },
    });

    return { ...bill, lines };
  }

  async createBill(ctx: FinanceRequestContext, dto: CreateFinanceBillDto) {
    const status = dto.status ?? FinanceBillStatus.Open;
    const billLines = dto.lines ?? [];

    // A draft can be created empty — this backs the "new bill" flow that opens
    // the detail page directly and lets the user fill everything there. A bill
    // that is created already open still needs at least one line.
    if (status !== FinanceBillStatus.Draft && billLines.length === 0) {
      throw new BadRequestException('Bill must have at least one line');
    }

    // Drafts carry no document number: the sequence is only consumed on
    // confirm, so an abandoned draft never burns a number.
    const billNumber =
      dto.billNumber ??
      (status === FinanceBillStatus.Draft
        ? ''
        : await this.generateDocumentNumber(ctx, 'BILL'));
    const totals = this.calculateBillTotals(billLines);

    const billId = await this.dataSource.transaction(async (manager) => {
      const bill = await manager.getRepository(FinanceBill).save(
        manager.getRepository(FinanceBill).create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          vendorId: dto.vendorId ?? null,
          billNumber,
          status,
          currency: dto.currency ?? 'BRL',
          issueDate: dto.issueDate ?? null,
          dueDate: dto.dueDate ?? null,
          periodStart: dto.periodStart ?? null,
          periodEnd: dto.periodEnd ?? null,
          subtotalAmount: money(totals.subtotal),
          taxAmount: money(totals.tax),
          totalAmount: money(totals.total),
          paidAmount: '0.00',
          balanceDue: money(totals.total),
          categoryId: dto.categoryId ?? null,
          costCenterId: dto.costCenterId ?? null,
          notes: dto.notes ?? null,
        }),
      );

      const lines = billLines.map((line) => {
        const quantity = toMoney(line.quantity ?? '1');
        const unitPrice = toMoney(line.unitPrice ?? '0');
        const tax = toMoney(line.taxAmount ?? '0');
        const total = quantity * unitPrice + tax;

        return manager.getRepository(FinanceBillLine).create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          billId: bill.id,
          description: line.description,
          quantity: quantity.toFixed(4),
          unitPrice: money(unitPrice),
          taxAmount: money(tax),
          totalAmount: money(total),
          categoryId: line.categoryId ?? dto.categoryId ?? null,
          costCenterId: line.costCenterId ?? dto.costCenterId ?? null,
          metadata: line.metadata ?? {},
        });
      });

      if (lines.length > 0) {
        await manager.getRepository(FinanceBillLine).save(lines);
      }

      // Draft bills do not post. If created already open, recognise the
      // payable in the ledger atomically with its creation.
      if (status === FinanceBillStatus.Open) {
        await this.postingService.postBillConfirmed(ctx, bill.id, manager);
      }

      return bill.id;
    });

    // If the user marked the bill as recurring, create a recurrence profile
    // from it. The current bill already followed the normal flow above; the
    // recurrence only governs FUTURE bills and never posts directly.
    if (dto.recurrence) {
      await this.createRecurrenceFromBill(ctx, billId, dto, dto.recurrence);
    }

    const bill = await this.getBill(ctx, billId);
    // A "previsto" payment is only forecast for a bill that is already open.
    // Drafts forecast nothing until they are confirmed (see updateBill).
    if (status === FinanceBillStatus.Open) {
      await this.ensureScheduledPaymentForBillSafely(ctx, bill);
    }
    return bill;
  }

  async updateBill(
    ctx: FinanceRequestContext,
    id: string,
    dto: UpdateFinanceBillDto,
  ) {
    validateId(id, 'bill id');
    const bill = await this.billsRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!bill) throw new NotFoundException('Finance bill not found');

    const previousStatus = bill.status;

    const shouldSettleFromStatusPatch =
      dto.status === FinanceBillStatus.Paid &&
      previousStatus !== FinanceBillStatus.Paid &&
      toMoney(bill.balanceDue) > 0;

    const { metadata, status: requestedStatus, ...rest } = dto;
    Object.assign(bill, rest);
    if (!shouldSettleFromStatusPatch && requestedStatus !== undefined) {
      bill.status = requestedStatus;
    }
    if (
      shouldSettleFromStatusPatch &&
      bill.status === FinanceBillStatus.Draft
    ) {
      bill.status = FinanceBillStatus.Open;
    }

    if (metadata !== undefined) {
      bill.metadata = { ...bill.metadata, ...metadata };
    }

    // Confirming a draft (draft → open) is what actually issues the number:
    // generate it now if the draft never had one.
    if (
      previousStatus === FinanceBillStatus.Draft &&
      bill.status === FinanceBillStatus.Open &&
      !bill.billNumber
    ) {
      bill.billNumber = await this.generateDocumentNumber(ctx, 'BILL');
    }

    const isConfirming =
      previousStatus === FinanceBillStatus.Draft &&
      bill.status === FinanceBillStatus.Open;
    const isCancelling =
      previousStatus !== FinanceBillStatus.Cancelled &&
      bill.status === FinanceBillStatus.Cancelled;

    if (isConfirming) {
      const lineCount = await this.billLinesRepo.count({
        where: {
          billId: id,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      });
      if (lineCount === 0 || toMoney(bill.totalAmount) <= 0) {
        throw new BadRequestException(
          'Adicione ao menos um item com valor maior que zero antes de confirmar a conta.',
        );
      }
    }

    // Status and accounting entry must succeed or fail together. Previously the
    // PATCH persisted `open` before posting, leaving a half-confirmed bill when
    // account/journal validation failed.
    const saved = await this.dataSource.transaction(async (manager) => {
      const persisted = await manager.getRepository(FinanceBill).save(bill);
      if (isConfirming) {
        await this.postingService.postBillConfirmed(ctx, persisted.id, manager);
      }
      if (isCancelling) {
        await this.postingService.reverseBill(ctx, persisted.id, manager);
      }
      return persisted;
    });

    // Posting is idempotent; only acts on the first transition into each state.
    if (isConfirming) {
      // Forecast the payable as a "previsto" payment once, on confirmation.
      // Skipped when the same PATCH is settling the bill straight to paid,
      // which registers its own completed payment below.
      if (!shouldSettleFromStatusPatch) {
        await this.ensureScheduledPaymentForBillSafely(ctx, saved);
      }
    }

    if (isCancelling) {
      await this.reconcileTeamPaymentsForBills(ctx, [saved.id]);
    }

    if (dto.vendorId !== undefined) {
      const scheduled = await this.findScheduledPaymentForTarget(ctx, saved.id);
      if (
        scheduled &&
        scheduled.status !== FinancePaymentStatus.Completed &&
        scheduled.status !== FinancePaymentStatus.Cancelled
      ) {
        scheduled.contactId = saved.vendorId;
        await this.paymentsRepo.save(scheduled);
      }
    }

    if (shouldSettleFromStatusPatch) {
      await this.settleBillBalance(ctx, saved, {
        source: 'status_patch_paid',
      });
      return this.getBill(ctx, saved.id);
    }

    return this.getBill(ctx, saved.id);
  }

  async cancelBill(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'bill id');
    const bill = await this.billsRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!bill) throw new NotFoundException('Finance bill not found');

    const wasCancelled = bill.status === FinanceBillStatus.Cancelled;

    bill.status = FinanceBillStatus.Cancelled;
    bill.cancelledAt = new Date();

    const saved = await this.dataSource.transaction(async (manager) => {
      const persisted = await manager.getRepository(FinanceBill).save(bill);
      if (!wasCancelled) {
        await this.postingService.reverseBill(ctx, persisted.id, manager);
      }
      return persisted;
    });

    await this.reconcileTeamPaymentsForBills(ctx, [saved.id]);
    return this.getBill(ctx, saved.id);
  }

  async deleteBill(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'bill id');
    const bill = await this.billsRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    if (!bill) throw new NotFoundException('Finance bill not found');

    const allocations = await this.paymentAllocationsRepo.count({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        targetType: FinanceAllocationTargetType.Bill,
        targetId: id,
      },
    });
    if (allocations > 0) {
      throw new BadRequestException(
        'Esta conta possui pagamentos registrados. Reverta ou arquive os pagamentos antes de excluí-la.',
      );
    }

    await this.dataSource.transaction(async (manager) => {
      await this.postingService.reverseBill(ctx, id, manager);
      await manager
        .getRepository(FinancePayment)
        .createQueryBuilder()
        .delete()
        .where('tenant_id = :tenantId', { tenantId: ctx.tenantId })
        .andWhere('workspace_id = :workspaceId', {
          workspaceId: ctx.workspaceId,
        })
        .andWhere("metadata ->> 'sourceId' = :id", { id })
        .andWhere('status <> :completed', {
          completed: FinancePaymentStatus.Completed,
        })
        .execute();
      await manager.getRepository(FinanceBillLine).delete({
        billId: id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      });
      await manager.getRepository(FinanceBill).remove(bill);
    });
    return { success: true, id };
  }

  private async recalcBillTotals(ctx: FinanceRequestContext, billId: string) {
    const lines = await this.billLinesRepo.find({
      where: { billId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    let subtotal = 0,
      tax = 0;
    for (const l of lines) {
      subtotal += toMoney(l.quantity) * toMoney(l.unitPrice);
      tax += toMoney(l.taxAmount);
    }
    const total = subtotal + tax;
    await this.billsRepo.update(
      { id: billId, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      {
        subtotalAmount: money(subtotal),
        taxAmount: money(tax),
        totalAmount: money(total),
        balanceDue: money(total),
      },
    );
  }

  async addBillLine(
    ctx: FinanceRequestContext,
    billId: string,
    dto: import('../dto').AddFinanceBillLineDto,
  ) {
    validateId(billId, 'bill id');
    const bill = await this.billsRepo.findOne({
      where: {
        id: billId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!bill) throw new NotFoundException('Finance bill not found');

    const qty = toMoney(dto.quantity ?? '1');
    const price = toMoney(dto.unitPrice ?? '0');
    const tax = toMoney(dto.taxAmount ?? '0');
    const total = qty * price + tax;

    await this.billLinesRepo.save(
      this.billLinesRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        billId,
        description: dto.description,
        quantity: qty.toFixed(4),
        unitPrice: money(price),
        taxAmount: money(tax),
        totalAmount: money(total),
        categoryId: dto.categoryId ?? null,
        costCenterId: dto.costCenterId ?? null,
        metadata: dto.metadata ?? {},
      }),
    );

    await this.recalcBillTotals(ctx, billId);
    return this.getBill(ctx, billId);
  }

  async updateBillLine(
    ctx: FinanceRequestContext,
    billId: string,
    lineId: string,
    dto: import('../dto').UpdateFinanceBillLineDto,
  ) {
    validateId(billId, 'bill id');
    validateId(lineId, 'line id');
    const line = await this.billLinesRepo.findOne({
      where: {
        id: lineId,
        billId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!line) throw new NotFoundException('Bill line not found');

    if (dto.description !== undefined) line.description = dto.description;
    if (dto.quantity !== undefined)
      line.quantity = toMoney(dto.quantity).toFixed(4);
    if (dto.unitPrice !== undefined)
      line.unitPrice = money(toMoney(dto.unitPrice));
    if (dto.taxAmount !== undefined)
      line.taxAmount = money(toMoney(dto.taxAmount));
    if (dto.categoryId !== undefined) line.categoryId = dto.categoryId ?? null;
    if (dto.costCenterId !== undefined)
      line.costCenterId = dto.costCenterId ?? null;
    if (dto.metadata !== undefined)
      line.metadata = { ...line.metadata, ...dto.metadata };

    line.totalAmount = money(
      toMoney(line.quantity) * toMoney(line.unitPrice) +
        toMoney(line.taxAmount),
    );
    await this.billLinesRepo.save(line);
    await this.recalcBillTotals(ctx, billId);
    return this.getBill(ctx, billId);
  }

  async removeBillLine(
    ctx: FinanceRequestContext,
    billId: string,
    lineId: string,
  ) {
    validateId(billId, 'bill id');
    validateId(lineId, 'line id');
    const line = await this.billLinesRepo.findOne({
      where: {
        id: lineId,
        billId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!line) throw new NotFoundException('Bill line not found');
    await this.billLinesRepo.remove(line);
    await this.recalcBillTotals(ctx, billId);
    return this.getBill(ctx, billId);
  }

  // ── Bill recurrences (contas a pagar recorrentes) ────────────────────────
  //
  // A recurrence NEVER posts to the ledger. It only generates new bills, and
  // the existing bill flow recognises them when they are confirmed/opened.
  // Generated bills default to Draft (Bill has a Draft status), so no posting
  // happens until the user confirms them.

  listBillRecurrences(ctx: FinanceRequestContext) {
    return this.billRecurrencesRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  async getBillRecurrence(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'bill recurrence id');
    const recurrence = await this.billRecurrencesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    if (!recurrence)
      throw new NotFoundException('Finance bill recurrence not found');
    return recurrence;
  }

  /** Standalone recurrence creation (its own line template, no source bill). */
  async createBillRecurrence(
    ctx: FinanceRequestContext,
    dto: CreateFinanceBillRecurrenceDto,
  ) {
    if (!dto.lines?.length) {
      throw new BadRequestException(
        'Bill recurrence must have at least one line',
      );
    }

    const template = this.buildRecurrenceLineTemplate(
      dto.lines,
      dto.categoryId ?? null,
      dto.costCenterId ?? null,
    );
    const intervalCount = Math.max(1, dto.intervalCount ?? 1);
    const isActive = dto.active !== false;
    const nextGenerationDate =
      dto.nextGenerationDate ??
      this.computeNextGenerationDate(
        dto.startDate,
        dto.frequency,
        intervalCount,
        dto.generationDay ?? null,
      );

    const recurrence = this.billRecurrencesRepo.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      sourceBillId: dto.sourceBillId ?? null,
      vendorId: dto.vendorId ?? null,
      name: dto.name,
      description: dto.description ?? null,
      currency: dto.currency ?? 'BRL',
      amount: money(this.recurrenceTemplateTotals(template)),
      status: isActive
        ? FinanceBillRecurrenceStatus.Active
        : FinanceBillRecurrenceStatus.Paused,
      frequency: dto.frequency,
      intervalCount,
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      occurrencesLimit: dto.occurrencesLimit ?? null,
      occurrencesCreated: 0,
      nextGenerationDate,
      generationDay: dto.generationDay ?? null,
      dueDay: dto.dueDay ?? null,
      generateAsStatus: dto.generateAsStatus ?? FinanceBillStatus.Draft,
      categoryId: dto.categoryId ?? null,
      costCenterId: dto.costCenterId ?? null,
      lineTemplate: template,
      active: isActive,
      metadata: dto.metadata ?? {},
      createdById: ctx.userId,
      updatedById: ctx.userId,
    });

    return this.billRecurrencesRepo.save(recurrence);
  }

  /** Create a recurrence from a just-created bill (the "Repetir esta conta" flow). */
  private async createRecurrenceFromBill(
    ctx: FinanceRequestContext,
    billId: string,
    billDto: CreateFinanceBillDto,
    config: BillRecurrenceConfigDto,
  ) {
    const template = this.buildRecurrenceLineTemplate(
      billDto.lines,
      billDto.categoryId ?? null,
      billDto.costCenterId ?? null,
    );
    const intervalCount = Math.max(1, config.intervalCount ?? 1);
    const isActive = config.active !== false;
    const name =
      config.description?.trim() ||
      billDto.lines[0]?.description?.trim() ||
      `Recorrência ${billId.slice(0, 8)}`;
    const nextGenerationDate =
      config.nextGenerationDate ??
      this.computeNextGenerationDate(
        config.startDate,
        config.frequency,
        intervalCount,
        config.generationDay ?? null,
      );

    const recurrence = await this.billRecurrencesRepo.save(
      this.billRecurrencesRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        sourceBillId: billId,
        vendorId: billDto.vendorId ?? null,
        name,
        description: config.description ?? null,
        currency: billDto.currency ?? 'BRL',
        amount: money(this.recurrenceTemplateTotals(template)),
        status: isActive
          ? FinanceBillRecurrenceStatus.Active
          : FinanceBillRecurrenceStatus.Paused,
        frequency: config.frequency,
        intervalCount,
        startDate: config.startDate,
        endDate: config.endDate ?? null,
        occurrencesLimit: config.occurrencesLimit ?? null,
        occurrencesCreated: 0,
        nextGenerationDate,
        generationDay: config.generationDay ?? null,
        dueDay: config.dueDay ?? null,
        generateAsStatus: config.generateAsStatus ?? FinanceBillStatus.Draft,
        categoryId: billDto.categoryId ?? null,
        costCenterId: billDto.costCenterId ?? null,
        lineTemplate: template,
        active: isActive,
        metadata: {},
        createdById: ctx.userId,
        updatedById: ctx.userId,
      }),
    );

    // Back-link the source bill so the detail page can surface the recurrence.
    const sourceBill = await this.billsRepo.findOne({
      where: {
        id: billId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (sourceBill) {
      sourceBill.metadata = {
        ...sourceBill.metadata,
        recurrenceId: recurrence.id,
        recurrenceSource: true,
      };
      await this.billsRepo.save(sourceBill);
    }

    return recurrence;
  }

  async updateBillRecurrence(
    ctx: FinanceRequestContext,
    id: string,
    dto: UpdateFinanceBillRecurrenceDto,
  ) {
    const recurrence = await this.getBillRecurrence(ctx, id);

    if (dto.name !== undefined) recurrence.name = dto.name;
    if (dto.description !== undefined)
      recurrence.description = dto.description ?? null;
    if (dto.frequency !== undefined) recurrence.frequency = dto.frequency;
    if (dto.intervalCount !== undefined)
      recurrence.intervalCount = Math.max(1, dto.intervalCount);
    if (dto.endDate !== undefined) recurrence.endDate = dto.endDate ?? null;
    if (dto.occurrencesLimit !== undefined)
      recurrence.occurrencesLimit = dto.occurrencesLimit ?? null;
    if (dto.nextGenerationDate !== undefined)
      recurrence.nextGenerationDate = dto.nextGenerationDate ?? null;
    if (dto.generationDay !== undefined)
      recurrence.generationDay = dto.generationDay ?? null;
    if (dto.dueDay !== undefined) recurrence.dueDay = dto.dueDay ?? null;
    if (dto.generateAsStatus !== undefined)
      recurrence.generateAsStatus = dto.generateAsStatus;
    if (dto.vendorId !== undefined) recurrence.vendorId = dto.vendorId ?? null;
    if (dto.categoryId !== undefined)
      recurrence.categoryId = dto.categoryId ?? null;
    if (dto.costCenterId !== undefined)
      recurrence.costCenterId = dto.costCenterId ?? null;
    if (dto.metadata !== undefined)
      recurrence.metadata = { ...recurrence.metadata, ...dto.metadata };

    if (dto.lines !== undefined) {
      recurrence.lineTemplate = this.buildRecurrenceLineTemplate(
        dto.lines,
        recurrence.categoryId,
        recurrence.costCenterId,
      );
      recurrence.amount = money(
        this.recurrenceTemplateTotals(recurrence.lineTemplate),
      );
    }

    if (dto.status !== undefined) {
      recurrence.status = dto.status;
      recurrence.active = dto.status === FinanceBillRecurrenceStatus.Active;
    }
    if (dto.active !== undefined) {
      recurrence.active = dto.active;
      // Keep the lifecycle in sync with the simple on/off flag.
      if (
        !dto.active &&
        recurrence.status === FinanceBillRecurrenceStatus.Active
      ) {
        recurrence.status = FinanceBillRecurrenceStatus.Paused;
      }
      if (
        dto.active &&
        recurrence.status === FinanceBillRecurrenceStatus.Paused
      ) {
        recurrence.status = FinanceBillRecurrenceStatus.Active;
      }
    }

    recurrence.updatedById = ctx.userId;
    return this.billRecurrencesRepo.save(recurrence);
  }

  async pauseBillRecurrence(ctx: FinanceRequestContext, id: string) {
    const recurrence = await this.getBillRecurrence(ctx, id);
    recurrence.status = FinanceBillRecurrenceStatus.Paused;
    recurrence.active = false;
    recurrence.updatedById = ctx.userId;
    return this.billRecurrencesRepo.save(recurrence);
  }

  async resumeBillRecurrence(ctx: FinanceRequestContext, id: string) {
    const recurrence = await this.getBillRecurrence(ctx, id);
    recurrence.status = FinanceBillRecurrenceStatus.Active;
    recurrence.active = true;
    if (!recurrence.nextGenerationDate) {
      recurrence.nextGenerationDate = this.computeNextGenerationDate(
        recurrence.startDate,
        recurrence.frequency,
        recurrence.intervalCount,
        recurrence.generationDay,
      );
    }
    recurrence.updatedById = ctx.userId;
    return this.billRecurrencesRepo.save(recurrence);
  }

  /** "Gerar agora" — generate one bill for the current/next due occurrence. */
  async generateBillFromRecurrence(ctx: FinanceRequestContext, id: string) {
    const recurrence = await this.getBillRecurrence(ctx, id);

    if (
      recurrence.status === FinanceBillRecurrenceStatus.Cancelled ||
      recurrence.status === FinanceBillRecurrenceStatus.Completed
    ) {
      throw new BadRequestException(
        'Cancelled or completed recurrences cannot generate bills',
      );
    }

    const settings = await this.getFinanceSettings(ctx);
    const generationDate =
      recurrence.nextGenerationDate ??
      recurrence.startDate ??
      new Date().toISOString().slice(0, 10);

    return this.generateBillForRecurrence(
      ctx,
      recurrence,
      generationDate,
      settings,
    );
  }

  /** Run all active recurrences whose nextGenerationDate is due (manual scheduler). */
  async generateDueBillRecurrences(ctx: FinanceRequestContext) {
    const today = new Date().toISOString().slice(0, 10);
    const settings = await this.getFinanceSettings(ctx);

    const recurrences = await this.billRecurrencesRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        status: FinanceBillRecurrenceStatus.Active,
        active: true,
      },
      order: { nextGenerationDate: 'ASC', createdAt: 'ASC' },
    });

    const due = recurrences.filter((recurrence) => {
      const date = recurrence.nextGenerationDate ?? recurrence.startDate;
      return Boolean(date) && date <= today;
    });

    const generated: Array<{
      recurrenceId: string;
      billId: string;
      occurrenceKey: string;
      competencePeriod: string;
      nextGenerationDate: string | null;
    }> = [];
    const skipped: Array<{ recurrenceId: string; reason: string }> = [];

    // Generate at most one occurrence per recurrence per run (no mass backfill).
    for (const recurrence of due) {
      try {
        const generationDate =
          recurrence.nextGenerationDate ?? recurrence.startDate;
        const result = await this.generateBillForRecurrence(
          ctx,
          recurrence,
          generationDate,
          settings,
        );
        if (result.skipped) {
          skipped.push({
            recurrenceId: recurrence.id,
            reason: result.reason ?? 'skipped',
          });
        } else {
          generated.push({
            recurrenceId: recurrence.id,
            billId: result.billId,
            occurrenceKey: result.occurrenceKey,
            competencePeriod: result.competencePeriod,
            nextGenerationDate: result.nextGenerationDate,
          });
        }
      } catch (error) {
        skipped.push({
          recurrenceId: recurrence.id,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      status: 'ok',
      module: 'agency-finance',
      operation: 'generate_due_bill_recurrences',
      today,
      totalDue: due.length,
      generated,
      skipped,
      summary: { generated: generated.length, skipped: skipped.length },
    };
  }

  private async generateBillForRecurrence(
    ctx: FinanceRequestContext,
    recurrence: FinanceBillRecurrence,
    generationDate: string,
    settings: FinanceSetting,
  ): Promise<{
    skipped: boolean;
    reason?: string;
    billId: string;
    occurrenceKey: string;
    competencePeriod: string;
    nextGenerationDate: string | null;
  }> {
    const template = recurrence.lineTemplate ?? [];
    if (!template.length) {
      throw new BadRequestException(
        'Recurrence has no line template to generate from',
      );
    }

    const competencePeriod = generationDate.slice(0, 7);
    const occurrenceKey = `${recurrence.id}:${competencePeriod}`;

    // Idempotency: never generate two bills for the same occurrence. Backed by
    // the partial unique index on bills.metadata->>'recurrenceOccurrenceKey'.
    const existing = await this.billsRepo
      .createQueryBuilder('bill')
      .where('bill.tenantId = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('bill.workspaceId = :workspaceId', {
        workspaceId: ctx.workspaceId,
      })
      .andWhere("bill.metadata ->> 'recurrenceOccurrenceKey' = :key", {
        key: occurrenceKey,
      })
      .getOne();

    if (existing) {
      return {
        skipped: true,
        reason: 'already_generated_for_period',
        billId: existing.id,
        occurrenceKey,
        competencePeriod,
        nextGenerationDate: recurrence.nextGenerationDate,
      };
    }

    const accrualDate = `${competencePeriod}-01`;
    const periodEnd = this.lastDayOfMonth(competencePeriod);
    const dueDate = this.computeRecurrenceDueDate(
      generationDate,
      recurrence.dueDay,
      settings,
    );
    const generateStatus =
      recurrence.generateAsStatus === FinanceBillStatus.Open
        ? FinanceBillStatus.Open
        : FinanceBillStatus.Draft;
    const billNumber = await this.generateDocumentNumber(ctx, 'BILL');

    let billId: string;
    try {
      billId = await this.dataSource.transaction(async (manager) => {
        const totals = this.recurrenceTemplateTotals(template);
        const taxTotal = template.reduce((s, l) => s + toMoney(l.taxAmount), 0);
        const subtotal = totals - taxTotal;

        const bill = await manager.getRepository(FinanceBill).save(
          manager.getRepository(FinanceBill).create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            vendorId: recurrence.vendorId ?? null,
            billNumber,
            status: generateStatus,
            currency: recurrence.currency ?? settings.baseCurrency ?? 'BRL',
            issueDate: generationDate,
            dueDate,
            periodStart: accrualDate,
            periodEnd,
            subtotalAmount: money(subtotal),
            taxAmount: money(taxTotal),
            totalAmount: money(totals),
            paidAmount: '0.00',
            balanceDue: money(totals),
            categoryId: recurrence.categoryId ?? null,
            costCenterId: recurrence.costCenterId ?? null,
            notes: recurrence.description ?? null,
            metadata: {
              recurrenceId: recurrence.id,
              recurrenceName: recurrence.name,
              recurrenceOccurrenceKey: occurrenceKey,
              generatedFromRecurrenceId: recurrence.id,
              competencePeriod,
              accrualDate,
              generatedBy: ctx.userId,
              generatedAt: new Date().toISOString(),
            },
          }),
        );

        const lines = template.map((line) =>
          manager.getRepository(FinanceBillLine).create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            billId: bill.id,
            description: line.description,
            quantity: toMoney(line.quantity).toFixed(4),
            unitPrice: money(toMoney(line.unitPrice)),
            taxAmount: money(toMoney(line.taxAmount)),
            totalAmount: money(
              toMoney(line.quantity) * toMoney(line.unitPrice) +
                toMoney(line.taxAmount),
            ),
            categoryId: line.categoryId ?? recurrence.categoryId ?? null,
            costCenterId: line.costCenterId ?? recurrence.costCenterId ?? null,
            metadata: line.metadata ?? {},
          }),
        );
        await manager.getRepository(FinanceBillLine).save(lines);

        // Draft bills do NOT post: recognition happens only on confirm/open.
        if (generateStatus === FinanceBillStatus.Open) {
          await this.postingService.postBillConfirmed(ctx, bill.id, manager);
        }

        return bill.id;
      });
    } catch (error) {
      // Unique-index race for the same occurrence → treat as idempotent skip.
      if ((error as { code?: string })?.code === '23505') {
        // Concurrent run already created this occurrence (unique-index race).
        return {
          skipped: true,
          reason: 'already_generated_for_period',
          billId: '',
          occurrenceKey,
          competencePeriod,
          nextGenerationDate: recurrence.nextGenerationDate,
        };
      }
      throw error;
    }

    // Advance the recurrence and close it out when limits/end date are reached.
    recurrence.occurrencesCreated += 1;
    recurrence.lastGeneratedAt = new Date();
    recurrence.lastGeneratedBillId = billId;
    recurrence.nextGenerationDate = this.computeNextGenerationDate(
      generationDate,
      recurrence.frequency,
      recurrence.intervalCount,
      recurrence.generationDay,
    );

    const reachedLimit =
      recurrence.occurrencesLimit != null &&
      recurrence.occurrencesCreated >= recurrence.occurrencesLimit;
    const reachedEnd =
      recurrence.endDate != null &&
      recurrence.nextGenerationDate != null &&
      recurrence.nextGenerationDate > recurrence.endDate;
    if (reachedLimit || reachedEnd) {
      recurrence.status = FinanceBillRecurrenceStatus.Completed;
      recurrence.active = false;
    }

    await this.billRecurrencesRepo.save(recurrence);

    return {
      skipped: false,
      billId,
      occurrenceKey,
      competencePeriod,
      nextGenerationDate: recurrence.nextGenerationDate,
    };
  }

  private buildRecurrenceLineTemplate(
    lines: Array<
      FinanceBillRecurrenceLineInputDto | CreateFinanceBillDto['lines'][number]
    >,
    fallbackCategoryId: string | null,
    fallbackCostCenterId: string | null,
  ): FinanceBillRecurrenceLineTemplate[] {
    return lines.map((line) => {
      const quantity = toMoney(line.quantity ?? '1');
      const unitPrice = toMoney(line.unitPrice ?? '0');
      const tax = toMoney(line.taxAmount ?? '0');
      const metadata =
        'metadata' in line && line.metadata
          ? (line.metadata as Record<string, unknown>)
          : undefined;
      return {
        description: line.description,
        quantity: quantity.toFixed(4),
        unitPrice: money(unitPrice),
        taxAmount: money(tax),
        categoryId: line.categoryId ?? fallbackCategoryId ?? null,
        costCenterId: line.costCenterId ?? fallbackCostCenterId ?? null,
        ...(metadata ? { metadata } : {}),
      };
    });
  }

  private recurrenceTemplateTotals(
    template: FinanceBillRecurrenceLineTemplate[],
  ): number {
    return template.reduce(
      (sum, line) =>
        sum +
        toMoney(line.quantity) * toMoney(line.unitPrice) +
        toMoney(line.taxAmount),
      0,
    );
  }

  private daysInMonth(year: number, monthIndex: number): number {
    return new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
  }

  private addMonthsClamped(dateString: string, months: number): string {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    const day = date.getUTCDate();
    date.setUTCDate(1);
    date.setUTCMonth(date.getUTCMonth() + months);
    const dim = this.daysInMonth(date.getUTCFullYear(), date.getUTCMonth());
    date.setUTCDate(Math.min(day, dim));
    return date.toISOString().slice(0, 10);
  }

  private applyDayOfMonth(dateString: string, day: number): string {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    const dim = this.daysInMonth(date.getUTCFullYear(), date.getUTCMonth());
    date.setUTCDate(Math.min(Math.max(1, day), dim));
    return date.toISOString().slice(0, 10);
  }

  private lastDayOfMonth(competencePeriod: string): string {
    const [year, month] = competencePeriod.split('-').map(Number);
    const dim = this.daysInMonth(year, month - 1);
    return `${competencePeriod}-${String(dim).padStart(2, '0')}`;
  }

  private isMonthBasedFrequency(
    frequency: FinanceBillRecurrenceFrequency,
  ): boolean {
    return (
      frequency === FinanceBillRecurrenceFrequency.Monthly ||
      frequency === FinanceBillRecurrenceFrequency.Quarterly ||
      frequency === FinanceBillRecurrenceFrequency.Semiannual ||
      frequency === FinanceBillRecurrenceFrequency.Yearly
    );
  }

  private advanceByFrequency(
    dateString: string,
    frequency: FinanceBillRecurrenceFrequency,
    intervalCount: number,
  ): string {
    const n = Math.max(1, intervalCount || 1);
    switch (frequency) {
      case FinanceBillRecurrenceFrequency.Weekly:
        return this.addDays(dateString, 7 * n);
      case FinanceBillRecurrenceFrequency.Biweekly:
        return this.addDays(dateString, 14 * n);
      case FinanceBillRecurrenceFrequency.Quarterly:
        return this.addMonthsClamped(dateString, 3 * n);
      case FinanceBillRecurrenceFrequency.Semiannual:
        return this.addMonthsClamped(dateString, 6 * n);
      case FinanceBillRecurrenceFrequency.Yearly:
        return this.addMonthsClamped(dateString, 12 * n);
      case FinanceBillRecurrenceFrequency.Monthly:
      default:
        return this.addMonthsClamped(dateString, n);
    }
  }

  private computeNextGenerationDate(
    fromDate: string,
    frequency: FinanceBillRecurrenceFrequency,
    intervalCount: number,
    generationDay: number | null,
  ): string {
    let next = this.advanceByFrequency(fromDate, frequency, intervalCount);
    if (generationDay && this.isMonthBasedFrequency(frequency)) {
      next = this.applyDayOfMonth(next, generationDay);
    }
    return next;
  }

  private computeRecurrenceDueDate(
    generationDate: string,
    dueDay: number | null,
    settings: FinanceSetting,
  ): string {
    if (dueDay) {
      let due = this.applyDayOfMonth(generationDate, dueDay);
      // If the due day already passed within the generation month, roll to next.
      if (due < generationDate) {
        due = this.applyDayOfMonth(
          this.addMonthsClamped(generationDate, 1),
          dueDay,
        );
      }
      return due;
    }
    return this.addDays(generationDate, settings.defaultPaymentTermsDays ?? 7);
  }

  listPayments(ctx: FinanceRequestContext) {
    return this.paymentsRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { paymentDate: 'DESC', createdAt: 'DESC' },
    });
  }

  private scheduledTargetMetadata(target: ScheduledPaymentTarget) {
    return {
      scheduledTarget: target,
      targetType: target.targetType,
      targetId: target.targetId,
    };
  }

  private readScheduledTarget(
    metadata: Record<string, unknown> | null | undefined,
  ): ScheduledPaymentTarget | null {
    const source =
      metadata?.scheduledTarget && typeof metadata.scheduledTarget === 'object'
        ? (metadata.scheduledTarget as Record<string, unknown>)
        : (metadata ?? {});
    const targetType = source.targetType;
    const targetId = source.targetId;
    if (
      (targetType === FinanceAllocationTargetType.Invoice ||
        targetType === FinanceAllocationTargetType.Bill) &&
      typeof targetId === 'string' &&
      targetId
    ) {
      return { targetType, targetId };
    }
    return null;
  }

  private async createScheduledPaymentForInvoice(
    ctx: FinanceRequestContext,
    invoice: FinanceInvoice,
  ) {
    const amount = toMoney(invoice.balanceDue);
    if (amount <= 0) return null;
    return this.createPayment(ctx, {
      direction: FinancePaymentDirection.Customer,
      status: FinancePaymentStatus.Pending,
      paymentDate:
        invoice.dueDate ??
        invoice.issueDate ??
        new Date().toISOString().slice(0, 10),
      amount: money(amount),
      currency: invoice.currency ?? 'BRL',
      contactId: invoice.customerId ?? null,
      description: `Recebimento previsto da fatura ${invoice.invoiceNumber}`,
      metadata: {
        ...this.scheduledTargetMetadata({
          targetType: FinanceAllocationTargetType.Invoice,
          targetId: invoice.id,
        }),
        sourceModule: 'finance_invoice',
        sourceId: invoice.id,
        sourceNumber: invoice.invoiceNumber,
        autoCreated: true,
      },
    });
  }

  private async createScheduledPaymentForBill(
    ctx: FinanceRequestContext,
    bill: FinanceBill,
  ) {
    const amount = toMoney(bill.balanceDue);
    if (amount <= 0) return null;
    return this.createPayment(ctx, {
      direction: FinancePaymentDirection.Vendor,
      status: FinancePaymentStatus.Pending,
      paymentDate:
        bill.dueDate ?? bill.issueDate ?? new Date().toISOString().slice(0, 10),
      amount: money(amount),
      currency: bill.currency ?? 'BRL',
      contactId: bill.vendorId ?? null,
      description: `Pagamento previsto da conta ${bill.billNumber}`,
      metadata: {
        ...this.scheduledTargetMetadata({
          targetType: FinanceAllocationTargetType.Bill,
          targetId: bill.id,
        }),
        sourceModule: 'finance_bill',
        sourceId: bill.id,
        sourceNumber: bill.billNumber,
        autoCreated: true,
      },
    });
  }

  /**
   * Locate the auto-created ("previsto") payment forecast for a bill/invoice,
   * if any. Matched by the sourceId + autoCreated marker written when it was
   * forecast, regardless of its current status — so we never forecast the same
   * document twice, and the settlement flow can reuse (complete) it instead of
   * creating a duplicate row.
   */
  private findScheduledPaymentForTarget(
    ctx: FinanceRequestContext,
    targetId: string,
  ) {
    return this.paymentsRepo
      .createQueryBuilder('payment')
      .where('payment.tenantId = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('payment.workspaceId = :workspaceId', {
        workspaceId: ctx.workspaceId,
      })
      .andWhere("payment.metadata ->> 'sourceId' = :targetId", { targetId })
      .andWhere("payment.metadata ->> 'autoCreated' = 'true'")
      .orderBy('payment.createdAt', 'ASC')
      .getOne();
  }

  private async ensureScheduledPaymentForBill(
    ctx: FinanceRequestContext,
    bill: FinanceBill,
  ) {
    const existing = await this.findScheduledPaymentForTarget(ctx, bill.id);
    if (existing) return existing;
    return this.createScheduledPaymentForBill(ctx, bill);
  }

  private async ensureScheduledPaymentForBillSafely(
    ctx: FinanceRequestContext,
    bill: FinanceBill,
  ) {
    try {
      return await this.ensureScheduledPaymentForBill(ctx, bill);
    } catch (error) {
      this.logger.error(
        `Bill ${bill.id} was confirmed, but its scheduled payment could not be created: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      return null;
    }
  }

  private async ensureScheduledPaymentForInvoice(
    ctx: FinanceRequestContext,
    invoice: FinanceInvoice,
  ) {
    const existing = await this.findScheduledPaymentForTarget(ctx, invoice.id);
    if (existing) return existing;
    return this.createScheduledPaymentForInvoice(ctx, invoice);
  }

  private async settleInvoiceBalance(
    ctx: FinanceRequestContext,
    invoice: FinanceInvoice,
    metadata: Record<string, unknown> = {},
  ) {
    const amount = toMoney(invoice.balanceDue);
    if (amount <= 0) return null;
    const payment = await this.createPayment(ctx, {
      direction: FinancePaymentDirection.Customer,
      status: FinancePaymentStatus.Completed,
      method: FinancePaymentMethod.Manual,
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: money(amount),
      currency: invoice.currency ?? 'BRL',
      contactId: invoice.customerId ?? null,
      description: `Pagamento da fatura ${invoice.invoiceNumber}`,
      metadata: {
        sourceModule: 'finance_invoice',
        sourceId: invoice.id,
        sourceNumber: invoice.invoiceNumber,
        ...metadata,
      },
    });
    await this.allocatePayment(ctx, payment.id, {
      targetType: FinanceAllocationTargetType.Invoice,
      targetId: invoice.id,
      amount: money(amount),
    });
    return payment;
  }

  private async settleBillBalance(
    ctx: FinanceRequestContext,
    bill: FinanceBill,
    metadata: Record<string, unknown> = {},
  ) {
    const amount = toMoney(bill.balanceDue);
    if (amount <= 0) return null;

    const scheduled = await this.findScheduledPaymentForTarget(ctx, bill.id);
    if (
      scheduled &&
      scheduled.status !== FinancePaymentStatus.Completed &&
      scheduled.status !== FinancePaymentStatus.Cancelled &&
      scheduled.status !== FinancePaymentStatus.Refunded
    ) {
      return this.updatePayment(ctx, scheduled.id, {
        status: FinancePaymentStatus.Completed,
        method: FinancePaymentMethod.Manual,
        contactId: bill.vendorId ?? null,
        paymentDate: new Date().toISOString().slice(0, 10),
        amount: money(amount),
        description: `Pagamento da conta ${bill.billNumber}`,
        metadata: {
          sourceModule: 'finance_bill',
          sourceId: bill.id,
          sourceNumber: bill.billNumber,
          ...metadata,
        },
      });
    }

    const payment = await this.createPayment(ctx, {
      direction: FinancePaymentDirection.Vendor,
      status: FinancePaymentStatus.Completed,
      method: FinancePaymentMethod.Manual,
      paymentDate: new Date().toISOString().slice(0, 10),
      amount: money(amount),
      currency: bill.currency ?? 'BRL',
      contactId: bill.vendorId ?? null,
      description: `Pagamento da conta ${bill.billNumber}`,
      metadata: {
        sourceModule: 'finance_bill',
        sourceId: bill.id,
        sourceNumber: bill.billNumber,
        ...metadata,
      },
    });
    await this.allocatePayment(ctx, payment.id, {
      targetType: FinanceAllocationTargetType.Bill,
      targetId: bill.id,
      amount: money(amount),
    });
    return payment;
  }

  private async settleCompletedScheduledPayment(
    ctx: FinanceRequestContext,
    payment: FinancePayment,
  ) {
    if (payment.status !== FinancePaymentStatus.Completed) return payment;
    const target = this.readScheduledTarget(payment.metadata);
    if (!target) return payment;
    const remaining =
      toMoney(payment.amount) - toMoney(payment.allocatedAmount);
    if (remaining <= 0) return payment;

    let targetBalance = 0;
    if (target.targetType === FinanceAllocationTargetType.Invoice) {
      const invoice = await this.invoicesRepo.findOne({
        where: {
          id: target.targetId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      });
      targetBalance = toMoney(invoice?.balanceDue);
    } else {
      const bill = await this.billsRepo.findOne({
        where: {
          id: target.targetId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      });
      targetBalance = toMoney(bill?.balanceDue);
    }

    const amount = Math.min(remaining, targetBalance);
    if (amount <= 0) return payment;
    await this.allocatePayment(ctx, payment.id, {
      targetType: target.targetType,
      targetId: target.targetId,
      amount: money(amount),
    });
    return (
      (await this.paymentsRepo.findOne({
        where: {
          id: payment.id,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      })) ?? payment
    );
  }

  private async recalculateTargetsForAllocations(
    ctx: FinanceRequestContext,
    allocations: FinancePaymentAllocation[],
  ) {
    const invoiceIds = new Set<string>();
    const billIds = new Set<string>();
    for (const allocation of allocations) {
      if (allocation.targetType === FinanceAllocationTargetType.Invoice) {
        invoiceIds.add(allocation.targetId);
      }
      if (allocation.targetType === FinanceAllocationTargetType.Bill) {
        billIds.add(allocation.targetId);
      }
    }
    for (const invoiceId of invoiceIds) {
      await this.recalculateInvoicePaymentState(ctx, invoiceId);
    }
    for (const billId of billIds) {
      await this.recalculateBillPaymentState(ctx, billId);
    }
    await this.reconcileTeamPaymentsForBills(ctx, billIds);
  }

  private async recalculateInvoicePaymentState(
    ctx: FinanceRequestContext,
    invoiceId: string,
  ) {
    const invoice = await this.invoicesRepo.findOne({
      where: {
        id: invoiceId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!invoice) return;
    const allocations = await this.paymentAllocationsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        targetType: FinanceAllocationTargetType.Invoice,
        targetId: invoiceId,
      },
    });
    const paymentIds = [
      ...new Set(allocations.map((allocation) => allocation.paymentId)),
    ];
    const payments = paymentIds.length
      ? await this.paymentsRepo.find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            id: In(paymentIds),
          },
        })
      : [];
    const completedPaymentIds = new Set(
      payments
        .filter((payment) => payment.status === FinancePaymentStatus.Completed)
        .map((payment) => payment.id),
    );
    const paid = allocations
      .filter((allocation) => completedPaymentIds.has(allocation.paymentId))
      .reduce((sum, allocation) => sum + toMoney(allocation.amount), 0);
    const total = toMoney(invoice.totalAmount);
    invoice.paidAmount = money(paid);
    invoice.balanceDue = money(Math.max(0, total - paid));
    if (
      ![FinanceInvoiceStatus.Cancelled, FinanceInvoiceStatus.Void].includes(
        invoice.status,
      )
    ) {
      if (paid <= 0) {
        invoice.status =
          invoice.issuedAt || invoice.issueDate
            ? FinanceInvoiceStatus.Issued
            : FinanceInvoiceStatus.Draft;
        invoice.paidAt = null;
      } else if (paid >= total) {
        invoice.status = FinanceInvoiceStatus.Paid;
        invoice.balanceDue = '0.00';
        invoice.paidAt = invoice.paidAt ?? new Date();
      } else {
        invoice.status = FinanceInvoiceStatus.PartiallyPaid;
        invoice.paidAt = null;
      }
    }
    await this.invoicesRepo.save(invoice);
  }

  private async recalculateBillPaymentState(
    ctx: FinanceRequestContext,
    billId: string,
  ) {
    const bill = await this.billsRepo.findOne({
      where: {
        id: billId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });
    if (!bill) return;
    const allocations = await this.paymentAllocationsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        targetType: FinanceAllocationTargetType.Bill,
        targetId: billId,
      },
    });
    const paymentIds = [
      ...new Set(allocations.map((allocation) => allocation.paymentId)),
    ];
    const payments = paymentIds.length
      ? await this.paymentsRepo.find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            id: In(paymentIds),
          },
        })
      : [];
    const completedPaymentIds = new Set(
      payments
        .filter((payment) => payment.status === FinancePaymentStatus.Completed)
        .map((payment) => payment.id),
    );
    const paid = allocations
      .filter((allocation) => completedPaymentIds.has(allocation.paymentId))
      .reduce((sum, allocation) => sum + toMoney(allocation.amount), 0);
    const total = toMoney(bill.totalAmount);
    bill.paidAmount = money(paid);
    bill.balanceDue = money(Math.max(0, total - paid));
    if (bill.status !== FinanceBillStatus.Cancelled) {
      if (paid <= 0) {
        bill.status = FinanceBillStatus.Open;
        bill.paidAt = null;
      } else if (paid >= total) {
        bill.status = FinanceBillStatus.Paid;
        bill.balanceDue = '0.00';
        bill.paidAt = bill.paidAt ?? new Date();
      } else {
        bill.status = FinanceBillStatus.PartiallyPaid;
        bill.paidAt = null;
      }
    }
    await this.billsRepo.save(bill);
  }

  async updatePayment(
    ctx: FinanceRequestContext,
    id: string,
    dto: import('../dto').UpdateFinancePaymentDto,
  ) {
    validateId(id, 'payment id');
    const payment = await this.paymentsRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    if (!payment) throw new NotFoundException('Finance payment not found');
    const previousStatus = payment.status;
    if (dto.metadata !== undefined) {
      payment.metadata = { ...payment.metadata, ...dto.metadata };
    }
    const { metadata: _meta, ...rest } = dto;
    Object.assign(payment, rest);
    let saved = await this.paymentsRepo.save(payment);

    // Leaving "completed" always removes the financial effect of the payment.
    // For an editable/provisional status, the old allocations are removed and
    // their target is preserved in metadata so completing this SAME payment
    // allocates it again without creating a duplicate payment row.
    const becameVoid =
      saved.status === FinancePaymentStatus.Cancelled ||
      saved.status === FinancePaymentStatus.Refunded;
    if (
      previousStatus === FinancePaymentStatus.Completed &&
      saved.status !== FinancePaymentStatus.Completed
    ) {
      const allocations = await this.paymentAllocationsRepo.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          paymentId: saved.id,
        },
      });
      await this.postingService.reversePayment(ctx, saved);

      if (!becameVoid && allocations.length > 0) {
        const firstTarget = allocations[0];
        const sameTarget = allocations.every(
          (allocation) =>
            allocation.targetType === firstTarget.targetType &&
            allocation.targetId === firstTarget.targetId,
        );
        if (sameTarget) {
          saved.metadata = {
            ...saved.metadata,
            ...this.scheduledTargetMetadata({
              targetType: firstTarget.targetType,
              targetId: firstTarget.targetId,
            }),
          };
        }
        await this.paymentAllocationsRepo.delete({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          paymentId: saved.id,
        });
        saved.allocatedAmount = '0.00';
        saved = await this.paymentsRepo.save(saved);
      }

      await this.recalculateTargetsForAllocations(ctx, allocations);
    }

    if (
      previousStatus !== FinancePaymentStatus.Completed &&
      saved.status === FinancePaymentStatus.Completed
    ) {
      saved = await this.settleCompletedScheduledPayment(ctx, saved);
    }

    // No tenant-validated recipient source exists yet (only the actor, who
    // is self-suppressed), so these calls currently resolve to zero
    // recipients and the publisher is a no-op.
    if (
      previousStatus !== FinancePaymentStatus.Completed &&
      saved.status === FinancePaymentStatus.Completed &&
      saved.direction === FinancePaymentDirection.Customer
    ) {
      await this.financeNotificationPublisher.publishPaymentReceived({
        resource: saved,
        actorUserId: ctx.userId,
        recipients: [],
      });
    }

    if (
      previousStatus !== FinancePaymentStatus.Failed &&
      saved.status === FinancePaymentStatus.Failed
    ) {
      await this.financeNotificationPublisher.publishPaymentFailed({
        resource: saved,
        actorUserId: ctx.userId,
        recipients: [],
      });
    }

    return saved;
  }

  async deletePayment(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'payment id');
    const payment = await this.paymentsRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });
    if (!payment) throw new NotFoundException('Finance payment not found');
    const allocations = await this.paymentAllocationsRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        paymentId: payment.id,
      },
    });
    // Keep the ledger consistent: reverse any settlement entries before the
    // payment row is removed (posted entries are never deleted).
    await this.postingService.reversePayment(ctx, payment);
    if (allocations.length > 0) {
      await this.paymentAllocationsRepo.delete({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        paymentId: payment.id,
      });
    }
    await this.paymentsRepo.remove(payment);
    await this.recalculateTargetsForAllocations(ctx, allocations);
    return { success: true, id };
  }

  async createPayment(
    ctx: FinanceRequestContext,
    dto: CreateFinancePaymentDto,
  ) {
    const payment = await this.paymentsRepo.save(
      this.paymentsRepo.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        direction: dto.direction,
        status: dto.status ?? FinancePaymentStatus.Completed,
        method: dto.method,
        contactId: dto.contactId ?? null,
        bankAccountId: dto.bankAccountId ?? null,
        paymentDate: dto.paymentDate,
        amount: dto.amount,
        allocatedAmount: '0.00',
        currency: dto.currency ?? 'BRL',
        externalProvider: dto.externalProvider ?? null,
        externalReference: dto.externalReference ?? null,
        description: dto.description ?? null,
        metadata: dto.metadata ?? {},
      }),
    );

    // The settlement (baixa) entry is intentionally NOT created here: a bare
    // payment is not yet tied to a receivable/payable. It is posted per
    // allocation in allocatePayment, which knows the invoice/bill and amount
    // and supports partial settlements. See FinancePostingService.

    // See updatePayment: no validated recipient source yet, resolves to no-op.
    if (
      payment.status === FinancePaymentStatus.Completed &&
      payment.direction === FinancePaymentDirection.Customer
    ) {
      await this.financeNotificationPublisher.publishPaymentReceived({
        resource: payment,
        actorUserId: ctx.userId,
        recipients: [],
      });
    }

    if (payment.status === FinancePaymentStatus.Failed) {
      await this.financeNotificationPublisher.publishPaymentFailed({
        resource: payment,
        actorUserId: ctx.userId,
        recipients: [],
      });
    }

    return this.settleCompletedScheduledPayment(ctx, payment);
  }

  async allocatePayment(
    ctx: FinanceRequestContext,
    paymentId: string,
    dto: AllocateFinancePaymentDto,
  ) {
    const payment = await this.paymentsRepo.findOne({
      where: {
        id: paymentId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!payment) {
      throw new NotFoundException('Finance payment not found');
    }

    if (payment.status !== FinancePaymentStatus.Completed) {
      throw new BadRequestException('Only completed payments can be allocated');
    }

    const amount = toMoney(dto.amount);

    if (amount <= 0) {
      throw new BadRequestException(
        'Allocation amount must be greater than zero',
      );
    }

    const paymentAmount = toMoney(payment.amount);
    const allocatedAmount = toMoney(payment.allocatedAmount);
    const remainingPaymentAmount = paymentAmount - allocatedAmount;

    if (amount > remainingPaymentAmount) {
      throw new BadRequestException(
        'Allocation amount exceeds remaining payment amount',
      );
    }

    let paidInvoice: FinanceInvoice | null = null;
    let paidBill: FinanceBill | null = null;

    const result = await this.dataSource.transaction(async (manager) => {
      if (dto.targetType === FinanceAllocationTargetType.Invoice) {
        if (payment.direction !== FinancePaymentDirection.Customer) {
          throw new BadRequestException(
            'Invoice allocations require a customer payment',
          );
        }

        const invoice = await manager.getRepository(FinanceInvoice).findOne({
          where: {
            id: dto.targetId,
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
          },
        });

        if (!invoice) {
          throw new NotFoundException('Finance invoice not found');
        }

        const invoiceBalance = toMoney(invoice.balanceDue);

        if (amount > invoiceBalance) {
          throw new BadRequestException(
            'Allocation amount exceeds invoice balance',
          );
        }

        invoice.paidAmount = money(toMoney(invoice.paidAmount) + amount);
        invoice.balanceDue = money(invoiceBalance - amount);

        if (toMoney(invoice.balanceDue) <= 0) {
          invoice.status = FinanceInvoiceStatus.Paid;
          invoice.paidAt = new Date();
          invoice.balanceDue = '0.00';
          paidInvoice = invoice;
        } else {
          invoice.status = FinanceInvoiceStatus.PartiallyPaid;
        }

        await manager.getRepository(FinanceInvoice).save(invoice);
      }

      if (dto.targetType === FinanceAllocationTargetType.Bill) {
        if (payment.direction !== FinancePaymentDirection.Vendor) {
          throw new BadRequestException(
            'Bill allocations require a vendor payment',
          );
        }

        const bill = await manager.getRepository(FinanceBill).findOne({
          where: {
            id: dto.targetId,
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
          },
        });

        if (!bill) {
          throw new NotFoundException('Finance bill not found');
        }

        const billBalance = toMoney(bill.balanceDue);

        if (amount > billBalance) {
          throw new BadRequestException(
            'Allocation amount exceeds bill balance',
          );
        }

        bill.paidAmount = money(toMoney(bill.paidAmount) + amount);
        bill.balanceDue = money(billBalance - amount);

        if (toMoney(bill.balanceDue) <= 0) {
          bill.status = FinanceBillStatus.Paid;
          bill.paidAt = new Date();
          bill.balanceDue = '0.00';
          paidBill = bill;
        } else {
          bill.status = FinanceBillStatus.PartiallyPaid;
        }

        await manager.getRepository(FinanceBill).save(bill);
      }

      const allocation = await manager
        .getRepository(FinancePaymentAllocation)
        .save(
          manager.getRepository(FinancePaymentAllocation).create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            paymentId: payment.id,
            targetType: dto.targetType,
            targetId: dto.targetId,
            amount: money(amount),
          }),
        );

      payment.allocatedAmount = money(allocatedAmount + amount);
      await manager.getRepository(FinancePayment).save(payment);

      // Settlement (baixa): one balanced entry per allocation. Customer →
      // DEBIT bank / CREDIT receivable; vendor → DEBIT payable / CREDIT bank.
      // Posted in the same transaction so the ledger matches the allocation.
      await this.postingService.postPaymentAllocationSettlement(
        ctx,
        payment,
        allocation,
        manager,
      );

      return {
        status: 'ok',
        allocation,
        payment: {
          id: payment.id,
          amount: payment.amount,
          allocatedAmount: payment.allocatedAmount,
          remainingAmount: money(
            toMoney(payment.amount) - toMoney(payment.allocatedAmount),
          ),
        },
      };
    });

    const invoiceToNotify = paidInvoice as FinanceInvoice | null;
    const billToNotify = paidBill as FinanceBill | null;

    // See updateInvoice: no validated recipient source yet, resolves to no-op.
    if (invoiceToNotify) {
      await this.financeNotificationPublisher.publishInvoicePaid({
        resource: invoiceToNotify,
        actorUserId: ctx.userId,
        recipients: [],
      });
    }

    if (billToNotify) {
      await this.financeNotificationPublisher.publishBillPaid({
        resource: billToNotify,
        actorUserId: ctx.userId,
        recipients: [],
      });
    }

    if (dto.targetType === FinanceAllocationTargetType.Bill) {
      await this.reconcileTeamPaymentsForBills(ctx, [dto.targetId]);
    }
    return result;
  }

  listRecurringProfiles(ctx: FinanceRequestContext) {
    return this.recurringProfilesRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  createRecurringProfile(
    ctx: FinanceRequestContext,
    dto: CreateFinanceRecurringProfileDto,
  ) {
    const profile = this.recurringProfilesRepo.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      customerId: dto.customerId ?? null,
      sourceModule: dto.sourceModule ?? null,
      sourceId: dto.sourceId ?? null,
      name: dto.name,
      status: dto.status ?? FinanceRecurringProfileStatus.Draft,
      interval: dto.interval,
      amount: dto.amount,
      currency: dto.currency ?? 'BRL',
      startDate: dto.startDate,
      endDate: dto.endDate ?? null,
      nextInvoiceDate: dto.nextInvoiceDate ?? dto.startDate,
      autoGenerateInvoice: dto.autoGenerateInvoice ?? true,
      categoryId: dto.categoryId ?? null,
      costCenterId: dto.costCenterId ?? null,
    });

    return this.recurringProfilesRepo.save(profile);
  }

  async updateRecurringProfile(
    ctx: FinanceRequestContext,
    id: string,
    dto: UpdateFinanceRecurringProfileDto,
  ) {
    const profile = await this.recurringProfilesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!profile) {
      throw new NotFoundException('Finance recurring profile not found');
    }

    Object.assign(profile, dto);
    return this.recurringProfilesRepo.save(profile);
  }

  async generateInvoiceFromRecurringProfile(
    ctx: FinanceRequestContext,
    profileId: string,
  ) {
    const profile = await this.recurringProfilesRepo.findOne({
      where: {
        id: profileId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!profile) {
      throw new NotFoundException('Finance recurring profile not found');
    }

    if (profile.status !== FinanceRecurringProfileStatus.Active) {
      throw new BadRequestException(
        'Only active recurring profiles can generate invoices',
      );
    }

    const invoiceDate =
      profile.nextInvoiceDate ??
      profile.startDate ??
      new Date().toISOString().slice(0, 10);

    return this.generateInvoiceForProfile(ctx, profile, invoiceDate);
  }

  async generateDueRecurringInvoices(ctx: FinanceRequestContext) {
    const today = new Date().toISOString().slice(0, 10);

    const profiles = await this.recurringProfilesRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        status: FinanceRecurringProfileStatus.Active,
      },
      order: {
        nextInvoiceDate: 'ASC',
        createdAt: 'ASC',
      },
    });

    const dueProfiles = profiles.filter((profile) => {
      const nextInvoiceDate = profile.nextInvoiceDate ?? profile.startDate;
      return Boolean(nextInvoiceDate) && nextInvoiceDate <= today;
    });

    const generated: Array<{
      recurringProfileId: string;
      invoiceId: string;
      invoiceNumber: string;
      invoiceDate: string;
      nextInvoiceDate: string | null;
    }> = [];
    const skipped: Array<{
      recurringProfileId: string;
      reason: string;
    }> = [];

    for (const profile of dueProfiles) {
      try {
        const invoiceDate = profile.nextInvoiceDate ?? profile.startDate;
        const result = await this.generateInvoiceForProfile(
          ctx,
          profile,
          invoiceDate,
        );

        generated.push({
          recurringProfileId: profile.id,
          invoiceId: result.invoice.id,
          invoiceNumber: result.invoice.invoiceNumber,
          invoiceDate,
          nextInvoiceDate: result.recurringProfile.nextInvoiceDate,
        });
      } catch (error) {
        skipped.push({
          recurringProfileId: profile.id,
          reason: error instanceof Error ? error.message : 'Unknown error',
        });
      }
    }

    return {
      status: 'ok',
      module: 'agency-finance',
      operation: 'generate_due_recurring_invoices',
      today,
      totalDue: dueProfiles.length,
      generated,
      skipped,
      summary: {
        generated: generated.length,
        skipped: skipped.length,
      },
    };
  }

  private async generateInvoiceForProfile(
    ctx: FinanceRequestContext,
    profile: FinanceRecurringProfile,
    invoiceDate: string,
  ) {
    const periodStart = invoiceDate;
    const periodEnd = this.calculatePeriodEnd(invoiceDate, profile.interval);

    const existingInvoice = await this.invoicesRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        sourceModule: 'finance_recurring_profile',
        sourceId: profile.id,
        periodStart,
      },
    });

    if (existingInvoice) {
      throw new BadRequestException(
        'Invoice already generated for this recurring profile period',
      );
    }

    const settings = await this.getFinanceSettings(ctx);
    const dueDate = this.addDays(
      invoiceDate,
      settings.defaultPaymentTermsDays ?? 7,
    );
    const invoiceNumber = await this.generateDocumentNumber(ctx, 'INV');

    const result = await this.dataSource.transaction(async (manager) => {
      const invoice = await manager.getRepository(FinanceInvoice).save(
        manager.getRepository(FinanceInvoice).create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          customerId: profile.customerId ?? null,
          sourceModule: 'finance_recurring_profile',
          sourceId: profile.id,
          invoiceNumber,
          status: FinanceInvoiceStatus.Draft,
          currency: profile.currency ?? settings.baseCurrency ?? 'BRL',
          issueDate: invoiceDate,
          dueDate,
          periodStart,
          periodEnd,
          subtotalAmount: money(toMoney(profile.amount)),
          taxAmount: '0.00',
          discountAmount: '0.00',
          totalAmount: money(toMoney(profile.amount)),
          paidAmount: '0.00',
          balanceDue: money(toMoney(profile.amount)),
          terms: settings.invoiceTerms ?? null,
          notes: `Generated from recurring profile: ${profile.name}`,
          metadata: {
            recurringProfileId: profile.id,
            recurringProfileName: profile.name,
            generatedBy: ctx.userId,
            generatedAt: new Date().toISOString(),
            originalSourceModule: profile.sourceModule,
            originalSourceId: profile.sourceId,
          },
        }),
      );

      await manager.getRepository(FinanceInvoiceLine).save(
        manager.getRepository(FinanceInvoiceLine).create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          invoiceId: invoice.id,
          productId: null,
          serviceId: null,
          description: profile.name,
          quantity: '1.0000',
          unitPrice: money(toMoney(profile.amount)),
          discountAmount: '0.00',
          taxAmount: '0.00',
          totalAmount: money(toMoney(profile.amount)),
          categoryId: profile.categoryId ?? null,
          costCenterId: profile.costCenterId ?? null,
          metadata: {
            recurringProfileId: profile.id,
          },
        }),
      );

      profile.lastInvoiceDate = invoiceDate;
      profile.nextInvoiceDate = this.calculateNextInvoiceDate(
        invoiceDate,
        profile.interval,
      );

      await manager.getRepository(FinanceRecurringProfile).save(profile);

      const invoiceWithLines = await this.getInvoice(ctx, invoice.id);

      return {
        status: 'ok',
        invoice: invoiceWithLines,
        recurringProfile: profile,
      };
    });

    // finance.recurring_charge_created is informational with
    // defaultDelivery=DISABLED in the catalog, and the processor does not
    // yet enforce that policy. Auto-firing on every cycle would create
    // per-period noise, and the previous recipient source (profile.metadata)
    // was client-supplied and untrusted. Disabled until the processor
    // respects defaultDelivery/preferences and a validated recipient source
    // exists. publishRecurringChargeCreated remains available on the
    // publisher for that future wiring.

    return result;
  }

  private async getFinanceSettings(ctx: FinanceRequestContext) {
    let settings = await this.settingsRepo.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!settings) {
      settings = await this.settingsRepo.save(
        this.settingsRepo.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          baseCurrency: 'BRL',
          fiscalCountry: 'BR',
          fiscalLocalization: 'br_agency_simplified',
          defaultPaymentTermsDays: 7,
        }),
      );
    }

    return settings;
  }

  private calculatePeriodEnd(
    startDate: string,
    interval: FinanceRecurringInterval,
  ) {
    const nextDate = this.calculateNextInvoiceDate(startDate, interval);
    const date = new Date(`${nextDate}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() - 1);

    return date.toISOString().slice(0, 10);
  }

  private calculateNextInvoiceDate(
    currentDate: string,
    interval: FinanceRecurringInterval,
  ) {
    const date = new Date(`${currentDate}T00:00:00.000Z`);

    switch (interval) {
      case FinanceRecurringInterval.Weekly:
        date.setUTCDate(date.getUTCDate() + 7);
        break;
      case FinanceRecurringInterval.Quarterly:
        date.setUTCMonth(date.getUTCMonth() + 3);
        break;
      case FinanceRecurringInterval.Semiannual:
        date.setUTCMonth(date.getUTCMonth() + 6);
        break;
      case FinanceRecurringInterval.Yearly:
        date.setUTCFullYear(date.getUTCFullYear() + 1);
        break;
      case FinanceRecurringInterval.Monthly:
      default:
        date.setUTCMonth(date.getUTCMonth() + 1);
        break;
    }

    return date.toISOString().slice(0, 10);
  }

  private addDays(dateString: string, days: number) {
    const date = new Date(`${dateString}T00:00:00.000Z`);
    date.setUTCDate(date.getUTCDate() + days);

    return date.toISOString().slice(0, 10);
  }

  private calculateInvoiceTotals(lines: CreateFinanceInvoiceDto['lines']) {
    return lines.reduce(
      (acc, line) => {
        const quantity = toMoney(line.quantity ?? '1');
        const unitPrice = toMoney(line.unitPrice ?? '0');
        const discount = toMoney(line.discountAmount ?? '0');
        const tax = toMoney(line.taxAmount ?? '0');
        const subtotal = quantity * unitPrice;
        const total = subtotal - discount + tax;

        acc.subtotal += subtotal;
        acc.discount += discount;
        acc.tax += tax;
        acc.total += total;

        return acc;
      },
      { subtotal: 0, discount: 0, tax: 0, total: 0 },
    );
  }

  private calculateBillTotals(lines: CreateFinanceBillDto['lines']) {
    return lines.reduce(
      (acc, line) => {
        const quantity = toMoney(line.quantity ?? '1');
        const unitPrice = toMoney(line.unitPrice ?? '0');
        const tax = toMoney(line.taxAmount ?? '0');
        const subtotal = quantity * unitPrice;
        const total = subtotal + tax;

        acc.subtotal += subtotal;
        acc.tax += tax;
        acc.total += total;

        return acc;
      },
      { subtotal: 0, tax: 0, total: 0 },
    );
  }

  private async generateDocumentNumber(
    ctx: FinanceRequestContext,
    prefix: string,
  ) {
    // Only already-numbered documents consume the sequence. Drafts are stored
    // with an empty number, so abandoned drafts never leave gaps and the count
    // stays aligned with the numbers actually issued.
    const count =
      prefix === 'INV'
        ? await this.invoicesRepo
            .createQueryBuilder('invoice')
            .where('invoice.tenantId = :tenantId', { tenantId: ctx.tenantId })
            .andWhere('invoice.workspaceId = :workspaceId', {
              workspaceId: ctx.workspaceId,
            })
            .andWhere('invoice.invoiceNumber IS NOT NULL')
            .andWhere("invoice.invoiceNumber <> ''")
            .getCount()
        : await this.billsRepo
            .createQueryBuilder('bill')
            .where('bill.tenantId = :tenantId', { tenantId: ctx.tenantId })
            .andWhere('bill.workspaceId = :workspaceId', {
              workspaceId: ctx.workspaceId,
            })
            .andWhere('bill.billNumber IS NOT NULL')
            .andWhere("bill.billNumber <> ''")
            .getCount();

    const next = count + 1;
    return `${prefix}-${String(next).padStart(5, '0')}`;
  }
}
