import {
  BadRequestException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, Not, Repository } from 'typeorm';
import {
  TeamAttendanceEntry,
  TeamMember,
  TeamPayment,
  TeamPaymentBatch,
  TeamPaymentDocument,
  TeamPaymentItem,
} from '../entities';
import {
  CreateTeamPaymentDocumentDto,
  CreateTeamPaymentDto,
  CreateTeamPaymentItemDto,
  GenerateTeamPaymentsDto,
  ListTeamPaymentsQueryDto,
  UpdateTeamPaymentDto,
  UpdateTeamPaymentItemDto,
} from '../dto';
import {
  TeamMemberStatus,
  TeamPaymentBatchStatus,
  TeamPaymentCalculationMode,
  TeamPaymentDocumentType,
  TeamPaymentItemType,
  TeamPaymentStatus,
} from '../enums';
import { FinanceBillingService } from '../../finance/services/finance-billing.service';
import {
  FinanceAllocationTargetType,
  FinanceBillStatus,
  FinancePaymentDirection,
  FinancePaymentMethod,
  FinancePaymentStatus,
} from '../../finance/enums';
import type { FinanceRequestContext } from '../../finance/services/finance-context';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

const AGENCY_CONNECTION = 'agency';

function money(value: unknown): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function toNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function isCheckIn(type: unknown) {
  return String(type).toLowerCase() === 'check_in';
}

function isCheckOut(type: unknown) {
  return String(type).toLowerCase() === 'check_out';
}

function toFinanceCtx(ctx: RequestContext): FinanceRequestContext {
  return {
    tenantId: ctx.tenantId,
    workspaceId: ctx.workspaceId,
    userId: ctx.userId || null,
  };
}

@Injectable()
export class TeamPaymentsService {
  private readonly logger = new Logger(TeamPaymentsService.name);

  constructor(
    @InjectRepository(TeamPaymentBatch, AGENCY_CONNECTION)
    private readonly batchRepository: Repository<TeamPaymentBatch>,

    @InjectRepository(TeamPayment, AGENCY_CONNECTION)
    private readonly paymentRepository: Repository<TeamPayment>,

    @InjectRepository(TeamPaymentItem, AGENCY_CONNECTION)
    private readonly itemRepository: Repository<TeamPaymentItem>,

    @InjectRepository(TeamPaymentDocument, AGENCY_CONNECTION)
    private readonly documentRepository: Repository<TeamPaymentDocument>,

    @InjectRepository(TeamMember, AGENCY_CONNECTION)
    private readonly memberRepository: Repository<TeamMember>,

    @InjectRepository(TeamAttendanceEntry, AGENCY_CONNECTION)
    private readonly attendanceRepository: Repository<TeamAttendanceEntry>,

    private readonly financeBillingService: FinanceBillingService,
    private readonly pdfRendererService: DocumentPdfRendererService,
  ) {}

  listBatches(ctx: RequestContext) {
    return this.batchRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: { competenceStart: 'DESC', createdAt: 'DESC' },
    });
  }

  async listPayments(ctx: RequestContext, query: ListTeamPaymentsQueryDto) {
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
    };

    if (query.batchId) where.batchId = query.batchId;
    if (query.memberId) where.memberId = query.memberId;
    if (query.status) where.status = query.status;

    if (query.activeOnly === 'true') {
      where.status = Not(TeamPaymentStatus.Archived);
    }

    if (query.competenceStart && query.competenceEnd) {
      where.competenceStart = Between(query.competenceStart, query.competenceEnd);
    }

    if (query.departmentId) {
      const members = await this.memberRepository.find({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          departmentId: query.departmentId,
        },
        select: ['id'],
      });
      const memberIds = members.map((m) => m.id);
      if (memberIds.length === 0) return [];
      where.memberId = In(memberIds);
    }

    return this.paymentRepository.find({
      where,
      relations: { member: true, items: true, documents: true },
      order: { competenceStart: 'DESC', createdAt: 'DESC' },
    });
  }

  async getPayment(ctx: RequestContext, id: string) {
    const payment = await this.paymentRepository.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      relations: { member: true, items: true, documents: true, batch: true },
    });

    if (!payment) {
      throw new NotFoundException('Team payment not found');
    }

    return payment;
  }

  async createPayment(ctx: RequestContext, dto: CreateTeamPaymentDto) {
    await this.ensureMember(ctx, dto.memberId);

    const payment = this.paymentRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      batchId: dto.batchId ?? null,
      memberId: dto.memberId,
      contractId: dto.contractId ?? null,
      financeBillId: null,
      financePaymentId: null,
      competenceStart: dto.competenceStart,
      competenceEnd: dto.competenceEnd,
      dueDate: dto.dueDate ?? null,
      status: dto.status ?? TeamPaymentStatus.Draft,
      calculationMode: dto.calculationMode ?? TeamPaymentCalculationMode.Manual,
      baseAmount: money(dto.baseAmount),
      workedHours: money(dto.workedHours),
      overtimeHours: money(dto.overtimeHours),
      workedDays: money(dto.workedDays),
      grossAmount: money(dto.grossAmount),
      benefitsTotal: money(dto.benefitsTotal),
      discountsTotal: money(dto.discountsTotal),
      netAmount: money(dto.netAmount),
      currency: dto.currency ?? 'BRL',
      notes: dto.notes ?? null,
      metadata: dto.metadata ?? {},
    });

    return this.paymentRepository.save(payment);
  }

  async updatePayment(ctx: RequestContext, id: string, dto: UpdateTeamPaymentDto) {
    const payment = await this.getPayment(ctx, id);

    Object.assign(payment, {
      ...dto,
      dueDate: dto.dueDate === undefined ? payment.dueDate : dto.dueDate,
      notes: dto.notes === undefined ? payment.notes : dto.notes,
      metadata: dto.metadata === undefined ? payment.metadata : dto.metadata ?? {},
    });

    if (dto.baseAmount !== undefined) payment.baseAmount = money(dto.baseAmount);
    if (dto.workedHours !== undefined) payment.workedHours = money(dto.workedHours);
    if (dto.overtimeHours !== undefined) payment.overtimeHours = money(dto.overtimeHours);
    if (dto.workedDays !== undefined) payment.workedDays = money(dto.workedDays);
    if (dto.grossAmount !== undefined) payment.grossAmount = money(dto.grossAmount);
    if (dto.benefitsTotal !== undefined) payment.benefitsTotal = money(dto.benefitsTotal);
    if (dto.discountsTotal !== undefined) payment.discountsTotal = money(dto.discountsTotal);
    if (dto.netAmount !== undefined) payment.netAmount = money(dto.netAmount);

    return this.paymentRepository.save(payment);
  }

  async archivePayment(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);
    payment.status = TeamPaymentStatus.Archived;
    return this.paymentRepository.save(payment);
  }

  async deletePayment(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);

    if (payment.financeBillId || payment.financePaymentId) {
      throw new BadRequestException(
        'Este pagamento possui registro financeiro vinculado. Arquive o pagamento ou remova o registro no Finance antes de excluir.',
      );
    }

    await this.paymentRepository.delete({
      id,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
    });

    return { deleted: true, id };
  }

  async confirmPayment(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);

    if (![TeamPaymentStatus.Draft, TeamPaymentStatus.Scheduled].includes(payment.status)) {
      throw new BadRequestException('Apenas pagamentos em rascunho ou programados podem ser confirmados');
    }

    if (payment.financeBillId) {
      payment.status = TeamPaymentStatus.PaymentPending;
      return this.paymentRepository.save(payment);
    }

    payment.status = TeamPaymentStatus.Confirmed;
    payment.metadata = {
      ...(payment.metadata ?? {}),
      confirmedAt: new Date().toISOString(),
      confirmedById: ctx.userId || null,
    };

    const saved = await this.paymentRepository.save(payment);

    try {
      const bill = await this.createFinanceBillForPayment(ctx, saved);
      saved.financeBillId = bill.id;
      saved.status = TeamPaymentStatus.PaymentPending;
      saved.metadata = {
        ...(saved.metadata ?? {}),
        financeCreatedAt: new Date().toISOString(),
        financeCreatedById: ctx.userId || null,
        financeSource: 'team_payment',
      };
      return this.paymentRepository.save(saved);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Finance bill creation failed for payment ${id}: ${msg}`);
      saved.metadata = {
        ...(saved.metadata ?? {}),
        financeIntegrationError: msg,
        financeIntegrationPending: true,
      };
      return this.paymentRepository.save(saved);
    }
  }

  async markPaid(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);

    payment.status = TeamPaymentStatus.Paid;
    payment.paidAt = new Date();
    payment.metadata = {
      ...(payment.metadata ?? {}),
      paidManuallyAt: new Date().toISOString(),
      paidManuallyById: ctx.userId || null,
    };

    const saved = await this.paymentRepository.save(payment);

    if (saved.financeBillId && !saved.financePaymentId) {
      try {
        const financeCtx = toFinanceCtx(ctx);
        const financePayment = await this.financeBillingService.createPayment(financeCtx, {
          direction: FinancePaymentDirection.Vendor,
          status: FinancePaymentStatus.Completed,
          method: FinancePaymentMethod.Manual,
          paymentDate: new Date().toISOString().slice(0, 10),
          amount: money(toNumber(saved.netAmount)),
          currency: saved.currency ?? 'BRL',
          description: `Pagamento equipe - ${saved.member?.displayName ?? saved.memberId} - ${saved.competenceStart}`,
        });

        await this.financeBillingService.allocatePayment(financeCtx, financePayment.id, {
          targetType: FinanceAllocationTargetType.Bill,
          targetId: saved.financeBillId,
          amount: money(toNumber(saved.netAmount)),
        });

        saved.financePaymentId = financePayment.id;
        saved.metadata = {
          ...(saved.metadata ?? {}),
          financePaymentCreatedAt: new Date().toISOString(),
        };
        return this.paymentRepository.save(saved);
      } catch (error) {
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Finance payment creation failed for payment ${id}: ${msg}`);
        saved.metadata = {
          ...(saved.metadata ?? {}),
          financePaymentPending: true,
          financePaymentError: msg,
        };
        return this.paymentRepository.save(saved);
      }
    }

    return saved;
  }

  async cancelPayment(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);

    if (payment.financeBillId) {
      const financeCtx = toFinanceCtx(ctx);
      try {
        const bill = await this.financeBillingService.getBill(financeCtx, payment.financeBillId);
        if (
          bill.status === FinanceBillStatus.Paid ||
          bill.status === FinanceBillStatus.PartiallyPaid
        ) {
          throw new BadRequestException(
            'Este pagamento possui registro financeiro vinculado e já foi pago total ou parcialmente. Cancele ou ajuste o lançamento no Finance antes.',
          );
        }
        if (bill.status !== FinanceBillStatus.Cancelled) {
          await this.financeBillingService.cancelBill(financeCtx, payment.financeBillId);
        }
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Could not cancel finance bill for payment ${id}: ${msg}`);
      }
    }

    payment.status = TeamPaymentStatus.Cancelled;
    return this.paymentRepository.save(payment);
  }

  async backToDraft(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);

    if (payment.financeBillId || payment.financePaymentId) {
      throw new BadRequestException(
        'Pagamentos com registro financeiro vinculado não podem voltar para rascunho.',
      );
    }

    payment.status = TeamPaymentStatus.Draft;
    return this.paymentRepository.save(payment);
  }

  async getPaymentFinanceStatus(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);

    const result: Record<string, unknown> = {
      hasFinanceRecord: Boolean(payment.financeBillId),
      financeBillId: payment.financeBillId ?? null,
      financePaymentId: payment.financePaymentId ?? null,
      financeCreatedAt: (payment.metadata as Record<string, unknown>)?.financeCreatedAt ?? null,
      financeCreatedById: (payment.metadata as Record<string, unknown>)?.financeCreatedById ?? null,
      financeSource: (payment.metadata as Record<string, unknown>)?.financeSource ?? null,
      financeIntegrationError: (payment.metadata as Record<string, unknown>)?.financeIntegrationError ?? null,
      financeIntegrationPending: (payment.metadata as Record<string, unknown>)?.financeIntegrationPending ?? false,
      financePaymentPending: (payment.metadata as Record<string, unknown>)?.financePaymentPending ?? false,
    };

    if (payment.financeBillId) {
      try {
        const bill = await this.financeBillingService.getBill(
          toFinanceCtx(ctx),
          payment.financeBillId,
        );
        result.financeBillStatus = bill.status;
        result.financeBillTotal = bill.totalAmount;
        result.financeBillBalanceDue = bill.balanceDue;
        result.financeBillDueDate = bill.dueDate;
        result.financeBillNumber = bill.billNumber;
      } catch {
        result.financeBillError = 'Registro não encontrado no Finance';
      }
    }

    return result;
  }

  async createItem(ctx: RequestContext, paymentId: string, dto: CreateTeamPaymentItemDto) {
    const payment = await this.getPayment(ctx, paymentId);

    const item = await this.itemRepository.save(
      this.itemRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        paymentId: payment.id,
        type: dto.type,
        name: dto.name,
        description: dto.description ?? null,
        amount: money(dto.amount),
        quantity: money(dto.quantity ?? 1),
        unitValue: money(dto.unitValue),
        metadata: dto.metadata ?? {},
      }),
    );

    await this.recalculatePayment(ctx, payment.id);
    return item;
  }

  async updateItem(
    ctx: RequestContext,
    paymentId: string,
    itemId: string,
    dto: UpdateTeamPaymentItemDto,
  ) {
    await this.getPayment(ctx, paymentId);

    const item = await this.itemRepository.findOne({
      where: {
        id: itemId,
        paymentId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!item) {
      throw new NotFoundException('Team payment item not found');
    }

    Object.assign(item, {
      ...dto,
      description: dto.description === undefined ? item.description : dto.description,
      metadata: dto.metadata === undefined ? item.metadata : dto.metadata ?? {},
    });

    if (dto.amount !== undefined) item.amount = money(dto.amount);
    if (dto.quantity !== undefined) item.quantity = money(dto.quantity);
    if (dto.unitValue !== undefined) item.unitValue = money(dto.unitValue);

    const saved = await this.itemRepository.save(item);
    await this.recalculatePayment(ctx, paymentId);

    return saved;
  }

  async deleteItem(ctx: RequestContext, paymentId: string, itemId: string) {
    await this.getPayment(ctx, paymentId);

    await this.itemRepository.delete({
      id: itemId,
      paymentId,
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
    });

    await this.recalculatePayment(ctx, paymentId);

    return { deleted: true, id: itemId };
  }

  async createDocument(
    ctx: RequestContext,
    paymentId: string,
    dto: CreateTeamPaymentDocumentDto,
  ) {
    const payment = await this.getPayment(ctx, paymentId);

    return this.documentRepository.save(
      this.documentRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        paymentId: payment.id,
        type: dto.type,
        title: dto.title,
        htmlContent: dto.htmlContent ?? this.renderPaymentStatement(payment),
        pdfFileKey: dto.pdfFileKey ?? null,
        status: dto.status ?? 'generated',
        generatedAt: new Date(),
        metadata: dto.metadata ?? {},
      }),
    );
  }

  async deleteDocument(ctx: RequestContext, paymentId: string, documentId: string) {
    await this.getPayment(ctx, paymentId);

    const doc = await this.documentRepository.findOne({
      where: {
        id: documentId,
        paymentId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!doc) throw new NotFoundException('Team payment document not found');

    // TODO: if doc.pdfFileKey, delete from storage when storage helper is available

    await this.documentRepository.delete({ id: documentId });
    return { deleted: true, id: documentId };
  }

  async generateDocumentPdf(ctx: RequestContext, paymentId: string, documentId: string) {
    await this.getPayment(ctx, paymentId);

    const doc = await this.documentRepository.findOne({
      where: {
        id: documentId,
        paymentId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!doc) throw new NotFoundException('Team payment document not found');
    if (!doc.htmlContent) throw new BadRequestException('Document has no HTML content to render');

    return this.pdfRendererService.renderHtmlToPdf(doc.htmlContent);
  }

  async generatePayments(ctx: RequestContext, dto: GenerateTeamPaymentsDto) {
    const members = await this.memberRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        status: TeamMemberStatus.Active,
        ...(dto.memberIds?.length ? { id: In(dto.memberIds) } : {}),
        ...(dto.departmentId ? { departmentId: dto.departmentId } : {}),
      },
      order: { displayName: 'ASC' },
    });

    const batch = await this.batchRepository.save(
      this.batchRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        competenceStart: dto.competenceStart,
        competenceEnd: dto.competenceEnd,
        status: TeamPaymentBatchStatus.Generated,
        generatedAt: new Date(),
        generatedById: ctx.userId || null,
        notes: dto.notes ?? null,
        metadata: dto.metadata ?? {},
      }),
    );

    const payments: TeamPayment[] = [];

    for (const member of members) {
      const calculated = await this.calculateMemberPayment(ctx, member, dto);
      const payment = await this.paymentRepository.save(
        this.paymentRepository.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          batchId: batch.id,
          memberId: member.id,
          contractId: member.contractId ?? null,
          financeBillId: null,
          financePaymentId: null,
          competenceStart: dto.competenceStart,
          competenceEnd: dto.competenceEnd,
          dueDate: dto.dueDate ?? null,
          status: TeamPaymentStatus.Draft,
          calculationMode: calculated.calculationMode,
          baseAmount: calculated.baseAmount,
          workedHours: calculated.workedHours,
          overtimeHours: calculated.overtimeHours,
          workedDays: calculated.workedDays,
          grossAmount: calculated.grossAmount,
          benefitsTotal: '0.00',
          discountsTotal: '0.00',
          netAmount: calculated.grossAmount,
          currency: member.currency ?? 'BRL',
          notes: null,
          metadata: {
            generatedFromBatch: true,
            workerType: member.workerType,
            workMode: member.workMode,
          },
        }),
      );

      await this.itemRepository.save(
        this.itemRepository.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          paymentId: payment.id,
          type: TeamPaymentItemType.Base,
          name: 'Base de pagamento',
          description: 'Item gerado automaticamente pela competência.',
          amount: calculated.grossAmount,
          quantity: '1.00',
          unitValue: calculated.grossAmount,
          metadata: {
            calculationMode: calculated.calculationMode,
          },
        }),
      );

      payments.push(payment);
    }

    return {
      batch,
      payments,
      total: payments.length,
    };
  }

  private async createFinanceBillForPayment(ctx: RequestContext, payment: TeamPayment) {
    const financeCtx = toFinanceCtx(ctx);
    const memberName = payment.member?.displayName ?? 'membro';
    const descBase = `Pagamento de equipe - ${memberName} - ${payment.competenceStart} a ${payment.competenceEnd}`;

    const items = payment.items ?? [];
    const positiveItems = items.filter(
      (i) => i.type !== TeamPaymentItemType.Discount,
    );
    const discountItems = items.filter((i) => i.type === TeamPaymentItemType.Discount);

    let lines: Array<{ description: string; quantity?: string; unitPrice?: string }>;

    if (positiveItems.length > 0) {
      lines = positiveItems.map((item) => ({
        description: item.name,
        quantity: '1',
        unitPrice: money(toNumber(item.amount)),
      }));
    } else {
      lines = [
        {
          description: descBase,
          quantity: '1',
          unitPrice: money(toNumber(payment.netAmount)),
        },
      ];
    }

    const discountNote =
      discountItems.length > 0
        ? ` | Descontos: ${discountItems.map((d) => `${d.name} (-${money(toNumber(d.amount))})`).join(', ')}`
        : '';

    return this.financeBillingService.createBill(financeCtx, {
      currency: payment.currency ?? 'BRL',
      dueDate: payment.dueDate ?? null,
      periodStart: payment.competenceStart,
      periodEnd: payment.competenceEnd,
      issueDate: new Date().toISOString().slice(0, 10),
      notes: `${descBase}${discountNote}`,
      metadata: {
        sourceModule: 'team',
        sourceType: 'team_payment',
        sourceId: payment.id,
        memberId: payment.memberId,
        batchId: payment.batchId ?? null,
      },
      lines,
    });
  }

  private async calculateMemberPayment(
    ctx: RequestContext,
    member: TeamMember,
    dto: GenerateTeamPaymentsDto,
  ) {
    const entries = await this.attendanceRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        memberId: member.id,
        occurredAt: Between(
          new Date(`${dto.competenceStart}T00:00:00.000Z`),
          new Date(`${dto.competenceEnd}T23:59:59.999Z`),
        ),
      },
      order: { occurredAt: 'ASC' },
    });

    let open: TeamAttendanceEntry | null = null;
    let workedMs = 0;
    const workedDaysSet = new Set<string>();

    for (const entry of entries) {
      if (isCheckIn(entry.type)) {
        open = entry;
      }

      if (isCheckOut(entry.type) && open) {
        const start = new Date(open.occurredAt).getTime();
        const end = new Date(entry.occurredAt).getTime();

        if (end > start) {
          workedMs += end - start;
          workedDaysSet.add(new Date(open.occurredAt).toISOString().slice(0, 10));
        }

        open = null;
      }
    }

    const workedHours = workedMs / 1000 / 60 / 60;
    const workedDays = workedDaysSet.size;

    const explicitMode = dto.calculationMode;
    const hasHourlyCost = toNumber(member.hourlyCost) > 0;
    const hasMonthlyCost = toNumber(member.monthlyCost) > 0;

    const calculationMode =
      explicitMode ??
      (hasMonthlyCost
        ? TeamPaymentCalculationMode.Monthly
        : hasHourlyCost
          ? TeamPaymentCalculationMode.Hourly
          : TeamPaymentCalculationMode.Manual);

    let gross = 0;
    let base = 0;

    if (calculationMode === TeamPaymentCalculationMode.Monthly) {
      base = toNumber(member.monthlyCost);
      gross = base;
    } else if (calculationMode === TeamPaymentCalculationMode.Hourly) {
      base = toNumber(member.hourlyCost);
      gross = base * workedHours;
    } else if (calculationMode === TeamPaymentCalculationMode.Daily) {
      base = toNumber(member.hourlyCost);
      gross = base * workedDays;
    }

    return {
      calculationMode,
      baseAmount: money(base),
      workedHours: money(workedHours),
      overtimeHours: '0.00',
      workedDays: money(workedDays),
      grossAmount: money(gross),
    };
  }

  private async recalculatePayment(ctx: RequestContext, paymentId: string) {
    const payment = await this.getPayment(ctx, paymentId);
    const items = await this.itemRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        paymentId,
      },
    });

    const gross = items
      .filter((item) =>
        [TeamPaymentItemType.Base, TeamPaymentItemType.Overtime, TeamPaymentItemType.Adjustment].includes(item.type),
      )
      .reduce((sum, item) => sum + toNumber(item.amount), 0);

    const benefits = items
      .filter((item) => item.type === TeamPaymentItemType.Benefit)
      .reduce((sum, item) => sum + toNumber(item.amount), 0);

    const discounts = items
      .filter((item) => item.type === TeamPaymentItemType.Discount)
      .reduce((sum, item) => sum + toNumber(item.amount), 0);

    payment.grossAmount = money(gross);
    payment.benefitsTotal = money(benefits);
    payment.discountsTotal = money(discounts);
    payment.netAmount = money(gross + benefits - discounts);

    return this.paymentRepository.save(payment);
  }

  private async ensureMember(ctx: RequestContext, memberId: string) {
    const member = await this.memberRepository.findOne({
      where: {
        id: memberId,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!member) {
      throw new NotFoundException('Team member not found');
    }

    return member;
  }

  private renderPaymentStatement(payment: TeamPayment) {
    return `
      <article>
        <h1>Demonstrativo de pagamento</h1>
        <p><strong>Membro:</strong> ${payment.member?.displayName ?? payment.memberId}</p>
        <p><strong>Competência:</strong> ${payment.competenceStart} até ${payment.competenceEnd}</p>
        <p><strong>Valor bruto:</strong> ${payment.currency} ${payment.grossAmount}</p>
        <p><strong>Benefícios:</strong> ${payment.currency} ${payment.benefitsTotal}</p>
        <p><strong>Descontos:</strong> ${payment.currency} ${payment.discountsTotal}</p>
        <p><strong>Valor líquido:</strong> ${payment.currency} ${payment.netAmount}</p>
      </article>
    `.trim();
  }
}
