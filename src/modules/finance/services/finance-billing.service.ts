import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
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
  FinanceSetting,
} from '../entities';
import {
  FinanceAllocationTargetType,
  FinanceBillStatus,
  FinanceInvoiceStatus,
  FinancePaymentDirection,
  FinancePaymentStatus,
  FinanceRecurringInterval,
  FinanceRecurringProfileStatus,
} from '../enums';
import { FinanceRequestContext } from './finance-context';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';

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

    @InjectRepository(FinanceSetting, 'agency')
    private readonly settingsRepo: Repository<FinanceSetting>,

    @InjectDataSource('agency')
    private readonly dataSource: DataSource,

    private readonly documentNumberingService: FinanceDocumentNumberingService,
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
      where: {
        invoiceId: id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: { createdAt: 'ASC' },
    });

    return { ...invoice, lines };
  }

  async createInvoice(
    ctx: FinanceRequestContext,
    dto: CreateFinanceInvoiceDto,
  ) {
    if (!dto.lines?.length) {
      throw new BadRequestException('Invoice must have at least one line');
    }

    const invoiceNumber =
      dto.invoiceNumber ?? (await this.generateDocumentNumber(ctx, 'INV'));
    const totals = this.calculateInvoiceTotals(dto.lines);

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

      return invoice.id;
    });

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
    if (!dto.lines?.length) {
      throw new BadRequestException('Bill must have at least one line');
    }

    const billNumber =
      dto.billNumber ?? (await this.generateDocumentNumber(ctx, 'BILL'));
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

    return this.dataSource.transaction(async (manager) => {
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

    return this.dataSource.transaction(async (manager) => {
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
