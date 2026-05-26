import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import {
  CreateFinanceBillDto,
  CreateFinanceInvoiceDto,
  CreateFinancePaymentDto,
  CreateFinanceRecurringProfileDto,
  AllocateFinancePaymentDto,
  UpdateFinanceBillDto,
  UpdateFinanceInvoiceDto,
  UpdateFinanceRecurringProfileDto,
} from '../dto';
import {
  FinanceBill,
  FinanceBillLine,
  FinanceInvoice,
  FinanceInvoiceLine,
  FinancePayment,
  FinancePaymentAllocation,
  FinanceRecurringProfile,
} from '../entities';
import {
  FinanceAllocationTargetType,
  FinanceBillStatus,
  FinanceInvoiceStatus,
  FinancePaymentDirection,
  FinancePaymentStatus,
  FinanceRecurringProfileStatus,
} from '../enums';
import { FinanceRequestContext } from './finance-context';

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

@Injectable()
export class FinanceBillingService {
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

    @InjectRepository(FinanceRecurringProfile, 'agency')
    private readonly recurringProfilesRepo: Repository<FinanceRecurringProfile>,

    @InjectDataSource('agency')
    private readonly dataSource: DataSource,
  ) {}

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
      where: { invoiceId: id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { createdAt: 'ASC' },
    });

    return { ...invoice, lines };
  }

  async createInvoice(ctx: FinanceRequestContext, dto: CreateFinanceInvoiceDto) {
    if (!dto.lines?.length) {
      throw new BadRequestException('Invoice must have at least one line');
    }

    const invoiceNumber =
      dto.invoiceNumber ?? (await this.generateDocumentNumber(ctx, 'INV'));

    const totals = this.calculateInvoiceTotals(dto.lines);

    return this.dataSource.transaction(async (manager) => {
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

      const lines = dto.lines.map((line) => {
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
        });
      });

      await manager.getRepository(FinanceInvoiceLine).save(lines);

      return this.getInvoice(ctx, invoice.id);
    });
  }

  async updateInvoice(ctx: FinanceRequestContext, id: string, dto: UpdateFinanceInvoiceDto) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!invoice) throw new NotFoundException('Finance invoice not found');

    Object.assign(invoice, dto);
    return this.invoicesRepo.save(invoice);
  }

  async issueInvoice(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!invoice) throw new NotFoundException('Finance invoice not found');

    invoice.status = FinanceInvoiceStatus.Issued;
    invoice.issuedAt = new Date();

    if (!invoice.issueDate) {
      invoice.issueDate = new Date().toISOString().slice(0, 10);
    }

    return this.invoicesRepo.save(invoice);
  }

  async cancelInvoice(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'invoice id');
    const invoice = await this.invoicesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!invoice) throw new NotFoundException('Finance invoice not found');

    invoice.status = FinanceInvoiceStatus.Cancelled;
    invoice.cancelledAt = new Date();

    return this.invoicesRepo.save(invoice);
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
      where: { billId: id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { createdAt: 'ASC' },
    });

    return { ...bill, lines };
  }

  async createBill(ctx: FinanceRequestContext, dto: CreateFinanceBillDto) {
    if (!dto.lines?.length) {
      throw new BadRequestException('Bill must have at least one line');
    }

    const billNumber = dto.billNumber ?? (await this.generateDocumentNumber(ctx, 'BILL'));
    const totals = this.calculateBillTotals(dto.lines);

    return this.dataSource.transaction(async (manager) => {
      const bill = await manager.getRepository(FinanceBill).save(
        manager.getRepository(FinanceBill).create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          vendorId: dto.vendorId ?? null,
          billNumber,
          status: FinanceBillStatus.Open,
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

      const lines = dto.lines.map((line) => {
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
        });
      });

      await manager.getRepository(FinanceBillLine).save(lines);

      return this.getBill(ctx, bill.id);
    });
  }

  async updateBill(ctx: FinanceRequestContext, id: string, dto: UpdateFinanceBillDto) {
    validateId(id, 'bill id');
    const bill = await this.billsRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!bill) throw new NotFoundException('Finance bill not found');

    Object.assign(bill, dto);

    if (dto.metadata !== undefined) {
      bill.metadata = dto.metadata;
    }

    return this.billsRepo.save(bill);
  }

  async cancelBill(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'bill id');
    const bill = await this.billsRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
    });

    if (!bill) throw new NotFoundException('Finance bill not found');

    bill.status = FinanceBillStatus.Cancelled;
    bill.cancelledAt = new Date();

    return this.billsRepo.save(bill);
  }

  listPayments(ctx: FinanceRequestContext) {
    return this.paymentsRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { paymentDate: 'DESC', createdAt: 'DESC' },
    });
  }

  createPayment(ctx: FinanceRequestContext, dto: CreateFinancePaymentDto) {
    const payment = this.paymentsRepo.create({
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
    });

    return this.paymentsRepo.save(payment);
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
      throw new BadRequestException('Allocation amount must be greater than zero');
    }

    const paymentAmount = toMoney(payment.amount);
    const allocatedAmount = toMoney(payment.allocatedAmount);
    const remainingPaymentAmount = paymentAmount - allocatedAmount;

    if (amount > remainingPaymentAmount) {
      throw new BadRequestException('Allocation amount exceeds remaining payment amount');
    }

    return this.dataSource.transaction(async (manager) => {
      if (dto.targetType === FinanceAllocationTargetType.Invoice) {
        if (payment.direction !== FinancePaymentDirection.Customer) {
          throw new BadRequestException('Invoice allocations require a customer payment');
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
          throw new BadRequestException('Allocation amount exceeds invoice balance');
        }

        invoice.paidAmount = money(toMoney(invoice.paidAmount) + amount);
        invoice.balanceDue = money(invoiceBalance - amount);

        if (toMoney(invoice.balanceDue) <= 0) {
          invoice.status = FinanceInvoiceStatus.Paid;
          invoice.paidAt = new Date();
          invoice.balanceDue = '0.00';
        } else {
          invoice.status = FinanceInvoiceStatus.PartiallyPaid;
        }

        await manager.getRepository(FinanceInvoice).save(invoice);
      }

      if (dto.targetType === FinanceAllocationTargetType.Bill) {
        if (payment.direction !== FinancePaymentDirection.Vendor) {
          throw new BadRequestException('Bill allocations require a vendor payment');
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
          throw new BadRequestException('Allocation amount exceeds bill balance');
        }

        bill.paidAmount = money(toMoney(bill.paidAmount) + amount);
        bill.balanceDue = money(billBalance - amount);

        if (toMoney(bill.balanceDue) <= 0) {
          bill.status = FinanceBillStatus.Paid;
          bill.paidAt = new Date();
          bill.balanceDue = '0.00';
        } else {
          bill.status = FinanceBillStatus.PartiallyPaid;
        }

        await manager.getRepository(FinanceBill).save(bill);
      }

      const allocation = await manager.getRepository(FinancePaymentAllocation).save(
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

      return {
        status: 'ok',
        allocation,
        payment: {
          id: payment.id,
          amount: payment.amount,
          allocatedAmount: payment.allocatedAmount,
          remainingAmount: money(toMoney(payment.amount) - toMoney(payment.allocatedAmount)),
        },
      };
    });
  }

  listRecurringProfiles(ctx: FinanceRequestContext) {
    return this.recurringProfilesRepo.find({
      where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      order: { createdAt: 'DESC' },
    });
  }

  createRecurringProfile(ctx: FinanceRequestContext, dto: CreateFinanceRecurringProfileDto) {
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

    if (!profile) throw new NotFoundException('Finance recurring profile not found');

    Object.assign(profile, dto);
    return this.recurringProfilesRepo.save(profile);
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

  private async generateDocumentNumber(ctx: FinanceRequestContext, prefix: string) {
    const count =
      prefix === 'INV'
        ? await this.invoicesRepo.count({
            where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
          })
        : await this.billsRepo.count({
            where: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
          });

    const next = count + 1;
    return `${prefix}-${String(next).padStart(5, '0')}`;
  }
}
