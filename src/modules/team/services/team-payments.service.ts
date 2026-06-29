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
  TeamConfigOption,
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
  MarkTeamPaymentPaidDto,
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
import { FinanceBill } from '../../finance/entities';
import {
  FinanceAllocationTargetType,
  FinanceBillStatus,
  FinancePaymentDirection,
  FinancePaymentMethod,
  FinancePaymentStatus,
} from '../../finance/enums';
import type { FinanceRequestContext } from '../../finance/services/finance-context';
import { DocumentPdfRendererService } from '../../document-layouts/document-pdf-renderer.service';
import { AgencyContactsService } from '../../agency/agency-contacts.service';

type RequestContext = {
  tenantId: string;
  workspaceId: string;
  userId: string;
};

/**
 * Normalized view of a Team "payment_finance_setting" config option. Defaults
 * preserve the historical behaviour: when no rule matches the worker type the
 * competence still generates a payable and requires no approval.
 */
type ResolvedFinanceRule = {
  id: string | null;
  createPayable: boolean;
  createExpense: boolean;
  requireApproval: boolean;
  categoryId: string | null;
  costCenterId: string | null;
  journalId: string | null;
  accountId: string | null;
  bankAccountId: string | null;
  appliesTo: string | null;
};

const AGENCY_CONNECTION = 'agency';

const WORKER_TYPE_NAME_ALIASES: Record<string, string[]> = {
  employee_full_time: ['employee_full_time', 'funcionario integral', 'full time'],
  employee_part_time: ['employee_part_time', 'funcionario parcial', 'meio periodo', 'part time'],
  contractor: ['contractor', 'prestador', 'contratado'],
  freelancer: ['freelancer', 'autonomo'],
  mei_contractor: ['mei_contractor', 'mei'],
  vendor: ['vendor', 'fornecedor'],
  intern: ['intern', 'estagiario'],
  partner: ['partner', 'socio', 'parceiro'],
  external_collaborator: ['external_collaborator', 'colaborador externo'],
};

function money(value: unknown): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toFixed(2) : '0.00';
}

function readMonthlyDueDay(member: TeamMember) {
  const metadata = (member.metadata ?? {}) as Record<string, unknown>;
  const payment = metadata.payment as Record<string, unknown> | undefined;
  const teamContract = metadata.teamContract as Record<string, unknown> | undefined;
  const raw = payment?.monthlyDueDay ?? teamContract?.monthlyDueDay;
  const parsed = Number(raw);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(31, Math.max(1, Math.trunc(parsed)));
}

function buildDueDateFromCompetence(competenceEnd: string, dueDay: number | null) {
  if (!dueDay) return null;
  const reference = new Date(competenceEnd);
  if (Number.isNaN(reference.getTime())) return null;
  const year = reference.getUTCFullYear();
  const month = reference.getUTCMonth();
  const lastDay = new Date(Date.UTC(year, month + 1, 0)).getUTCDate();
  const day = Math.min(dueDay, lastDay);
  return new Date(Date.UTC(year, month, day)).toISOString().slice(0, 10);
}

function toNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function normalizeWorkerTypeName(value: unknown): string {
  return String(value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ' ')
    .trim();
}

function matchesWorkerTypeOption(option: TeamConfigOption, workerType: string): boolean {
  const configuredKey = option.metadata?.workerType ?? option.metadata?.workerTypeKey;
  if (configuredKey === workerType) return true;

  const normalizedName = normalizeWorkerTypeName(option.name);
  return (WORKER_TYPE_NAME_ALIASES[workerType] ?? [workerType])
    .map(normalizeWorkerTypeName)
    .includes(normalizedName);
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

    @InjectRepository(TeamConfigOption, AGENCY_CONNECTION)
    private readonly configOptionRepository: Repository<TeamConfigOption>,

    // Read-only access to bills for the Team→Finance idempotency guard. The
    // bill lifecycle itself stays entirely in FinanceBillingService.
    @InjectRepository(FinanceBill, AGENCY_CONNECTION)
    private readonly financeBillRepository: Repository<FinanceBill>,

    private readonly financeBillingService: FinanceBillingService,
    private readonly pdfRendererService: DocumentPdfRendererService,
    private readonly agencyContactsService: AgencyContactsService,
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

    const rule = await this.resolveFinanceRuleConfig(ctx, saved.member?.workerType);

    // Treatment 1 — "Não integrar com Finance" (no payable). A direct expense
    // (gerarDespesa sem conta a pagar) is not supported in this flow: the only
    // safe cost-recognition path is a payable that posts through
    // FinancePostingService, so we record the payment in Team only and flag the
    // reason instead of double-posting.
    if (!rule.createPayable) {
      saved.metadata = {
        ...(saved.metadata ?? {}),
        financeSettingId: rule.id,
        financeIntegrationSkipped: true,
        financeSkipReason: rule.createExpense ? 'expense_only_unsupported' : 'not_integrated',
      };
      return this.paymentRepository.save(saved);
    }

    // Treatment 2 — payable required but the rule demands human approval first.
    // Do NOT touch Finance until the competence is approved.
    if (rule.requireApproval) {
      saved.metadata = {
        ...(saved.metadata ?? {}),
        financeSettingId: rule.id,
        financeApprovalRequired: true,
        financeApprovalStatus: 'pending_approval',
        financeIntegrationSkipped: false,
      };
      return this.paymentRepository.save(saved);
    }

    // Treatment 3 — payable required, no approval gate → integrate immediately.
    return this.runFinanceIntegration(ctx, saved, rule);
  }

  /**
   * Approve a competence whose finance rule requires approval, then create the
   * payable. No-op-safe: if a bill already exists it just reconciles status.
   */
  async approvePayment(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);

    if (payment.financeBillId) {
      payment.status = TeamPaymentStatus.PaymentPending;
      payment.metadata = {
        ...(payment.metadata ?? {}),
        financeApprovalStatus: 'approved',
      };
      return this.paymentRepository.save(payment);
    }

    if (payment.status !== TeamPaymentStatus.Confirmed) {
      throw new BadRequestException(
        'Apenas competências confirmadas e aguardando aprovação podem ser aprovadas.',
      );
    }

    const rule = await this.resolveFinanceRuleConfig(ctx, payment.member?.workerType);
    if (!rule.createPayable) {
      throw new BadRequestException(
        'A regra financeira deste vínculo não gera conta a pagar.',
      );
    }

    payment.metadata = {
      ...(payment.metadata ?? {}),
      financeSettingId: rule.id,
      financeApprovalRequired: true,
      financeApprovalStatus: 'approved',
      financeApprovedAt: new Date().toISOString(),
      financeApprovedById: ctx.userId || null,
    };
    // Persist the approval before integrating so an integration failure does
    // not lose the approval decision.
    const approved = await this.paymentRepository.save(payment);

    return this.runFinanceIntegration(ctx, approved, rule);
  }

  /**
   * Retry/reprocess the Finance integration for a confirmed competence that has
   * no bill yet (e.g. previous integration error). Idempotent via occurrenceKey.
   */
  async sendPaymentToFinance(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);

    if (payment.financeBillId) {
      payment.status = TeamPaymentStatus.PaymentPending;
      return this.paymentRepository.save(payment);
    }

    if (payment.status !== TeamPaymentStatus.Confirmed) {
      throw new BadRequestException(
        'Apenas competências confirmadas podem ser enviadas ao Finance.',
      );
    }

    const rule = await this.resolveFinanceRuleConfig(ctx, payment.member?.workerType);
    if (!rule.createPayable) {
      throw new BadRequestException(
        'A regra financeira deste vínculo não gera conta a pagar.',
      );
    }
    if (
      rule.requireApproval &&
      (payment.metadata as Record<string, unknown>)?.financeApprovalStatus !== 'approved'
    ) {
      throw new BadRequestException(
        'Esta competência exige aprovação antes de ser enviada ao Finance.',
      );
    }

    return this.runFinanceIntegration(ctx, payment, rule);
  }

  /**
   * Shared Finance integration step: creates (or reuses) the payable and links
   * it to the competence. Never throws on Finance errors — records them on the
   * payment so the UI can surface "Erro de integração" and offer a retry.
   */
  private async runFinanceIntegration(
    ctx: RequestContext,
    payment: TeamPayment,
    rule: ResolvedFinanceRule,
  ) {
    try {
      const bill = await this.createFinanceBillForPayment(ctx, payment, rule);
      payment.financeBillId = bill.id;
      payment.status = TeamPaymentStatus.PaymentPending;
      payment.metadata = {
        ...(payment.metadata ?? {}),
        financeSettingId: rule.id,
        financeCreatedAt: new Date().toISOString(),
        financeCreatedById: ctx.userId || null,
        financeSource: 'team_payment',
        financeIntegrationSkipped: false,
        financeIntegrationPending: false,
        financeIntegrationError: null,
      };
      return this.paymentRepository.save(payment);
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      this.logger.warn(`Finance bill creation failed for payment ${payment.id}: ${msg}`);
      payment.metadata = {
        ...(payment.metadata ?? {}),
        financeSettingId: rule.id,
        financeIntegrationError: msg,
        financeIntegrationPending: true,
      };
      return this.paymentRepository.save(payment);
    }
  }

  async markPaid(ctx: RequestContext, id: string, dto: MarkTeamPaymentPaidDto = {}) {
    const payment = await this.getPayment(ctx, id);

    if (![TeamPaymentStatus.Confirmed, TeamPaymentStatus.PaymentPending].includes(payment.status)) {
      throw new BadRequestException('Apenas pagamentos confirmados ou pendentes podem ser pagos.');
    }

    const today = new Intl.DateTimeFormat('en-CA', {
      timeZone: 'America/Sao_Paulo',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date());
    const paymentDate = dto.paymentDate ?? today;
    if (paymentDate > today) {
      throw new BadRequestException('A data do pagamento não pode ser posterior à data atual.');
    }

    const requestedAmount = dto.amount === undefined
      ? toNumber(payment.netAmount)
      : toNumber(dto.amount);
    if (requestedAmount <= 0) {
      throw new BadRequestException('O valor do pagamento deve ser maior que zero.');
    }

    if (payment.financeBillId) {
      try {
        const financeCtx = toFinanceCtx(ctx);
        const contactId = await this.ensureMemberContact(ctx, payment.member);
        const billBefore = await this.financeBillingService.getBill(financeCtx, payment.financeBillId);
        if (contactId && billBefore.vendorId !== contactId) {
          await this.financeBillingService.updateBill(financeCtx, payment.financeBillId, { vendorId: contactId });
        }
        const balanceDue = toNumber(billBefore.balanceDue);
        if (requestedAmount > balanceDue + 0.005) {
          throw new BadRequestException('O valor do pagamento não pode superar o saldo devedor.');
        }

        const financePayment = await this.financeBillingService.createPayment(financeCtx, {
          direction: FinancePaymentDirection.Vendor,
          status: FinancePaymentStatus.Completed,
          method: FinancePaymentMethod.Manual,
          paymentDate,
          amount: money(requestedAmount),
          currency: payment.currency ?? 'BRL',
          bankAccountId: dto.bankAccountId ?? null,
          contactId,
          description: dto.description?.trim() || `Pagamento equipe - ${payment.member?.displayName ?? payment.memberId} - ${payment.competenceStart}`,
        });

        await this.financeBillingService.allocatePayment(financeCtx, financePayment.id, {
          targetType: FinanceAllocationTargetType.Bill,
          targetId: payment.financeBillId,
          amount: money(requestedAmount),
        });

        const billAfter = await this.financeBillingService.getBill(financeCtx, payment.financeBillId);
        const isFullyPaid = billAfter.status === FinanceBillStatus.Paid || toNumber(billAfter.balanceDue) <= 0.005;
        const previousIds = Array.isArray(payment.metadata?.financePaymentIds)
          ? payment.metadata.financePaymentIds.filter((value): value is string => typeof value === 'string')
          : payment.financePaymentId ? [payment.financePaymentId] : [];

        payment.financePaymentId = financePayment.id;
        payment.status = isFullyPaid ? TeamPaymentStatus.Paid : TeamPaymentStatus.PaymentPending;
        payment.paidAt = isFullyPaid ? new Date(`${paymentDate}T12:00:00.000Z`) : null;
        payment.metadata = {
          ...(payment.metadata ?? {}),
          financePaymentIds: [...new Set([...previousIds, financePayment.id])],
          financePaymentCreatedAt: new Date().toISOString(),
          financePaymentPending: !isFullyPaid,
          paidManuallyAt: isFullyPaid ? new Date().toISOString() : null,
          paidManuallyById: ctx.userId || null,
        };
        return this.paymentRepository.save(payment);
      } catch (error) {
        if (error instanceof BadRequestException) throw error;
        const msg = error instanceof Error ? error.message : String(error);
        this.logger.warn(`Finance payment creation failed for payment ${id}: ${msg}`);
        payment.metadata = {
          ...(payment.metadata ?? {}),
          financePaymentPending: true,
          financePaymentError: msg,
        };
        return this.paymentRepository.save(payment);
      }
    }

    if (requestedAmount + 0.005 < toNumber(payment.netAmount)) {
      throw new BadRequestException('Pagamentos parciais exigem uma conta a pagar vinculada no Finance.');
    }
    payment.status = TeamPaymentStatus.Paid;
    payment.paidAt = new Date(`${paymentDate}T12:00:00.000Z`);
    payment.metadata = {
      ...(payment.metadata ?? {}),
      paidManuallyAt: new Date().toISOString(),
      paidManuallyById: ctx.userId || null,
      manualPaymentAmount: money(requestedAmount),
      manualPaymentDescription: dto.description?.trim() || null,
    };
    return this.paymentRepository.save(payment);
  }

  async revertPayment(ctx: RequestContext, id: string) {
    const payment = await this.getPayment(ctx, id);

    if (payment.status !== TeamPaymentStatus.Paid) {
      throw new BadRequestException('Apenas pagamentos pagos podem voltar para provisório.');
    }

    if (payment.financePaymentId) {
      const paymentIds = Array.isArray(payment.metadata?.financePaymentIds)
        ? payment.metadata.financePaymentIds.filter((value): value is string => typeof value === 'string')
        : [payment.financePaymentId];
      await Promise.all(
        [...new Set(paymentIds)].map((financePaymentId) =>
          this.financeBillingService.updatePayment(
            toFinanceCtx(ctx),
            financePaymentId,
            { status: FinancePaymentStatus.Pending },
          ),
        ),
      );
    }

    payment.status = TeamPaymentStatus.PaymentPending;
    payment.paidAt = null;
    payment.metadata = {
      ...(payment.metadata ?? {}),
      paymentRevertedAt: new Date().toISOString(),
      paymentRevertedById: ctx.userId || null,
      financePaymentPending: Boolean(payment.financePaymentId),
    };

    return this.paymentRepository.save(payment);
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

    const md = (payment.metadata ?? {}) as Record<string, unknown>;
    const result: Record<string, unknown> = {
      hasFinanceRecord: Boolean(payment.financeBillId),
      financeBillId: payment.financeBillId ?? null,
      financePaymentId: payment.financePaymentId ?? null,
      financeCreatedAt: md.financeCreatedAt ?? null,
      financeCreatedById: md.financeCreatedById ?? null,
      financeSource: md.financeSource ?? null,
      financeIntegrationError: md.financeIntegrationError ?? null,
      financeIntegrationPending: md.financeIntegrationPending ?? false,
      financeIntegrationSkipped: md.financeIntegrationSkipped ?? false,
      financeSkipReason: md.financeSkipReason ?? null,
      financeApprovalRequired: md.financeApprovalRequired ?? false,
      financeApprovalStatus: md.financeApprovalStatus ?? null,
      financePaymentPending: md.financePaymentPending ?? false,
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

    const benefits = (payment.items ?? []).filter(
      (item) => item.type === TeamPaymentItemType.Benefit && toNumber(item.amount) > 0,
    );
    if (dto.type === TeamPaymentDocumentType.BenefitsDeclaration && benefits.length === 0) {
      throw new BadRequestException(
        'Não é possível emitir a declaração: este pagamento não possui benefícios.',
      );
    }

    if (
      dto.type === TeamPaymentDocumentType.Payslip &&
      !(await this.isEmployeeWorkerType(ctx, payment.member?.workerType ?? ''))
    ) {
      throw new BadRequestException(
        'Holerite disponível somente para vínculos marcados como funcionário.',
      );
    }

    const requestedTemplateId =
      typeof dto.metadata?.templateId === 'string' ? dto.metadata.templateId : null;
    const template = requestedTemplateId
      ? await this.configOptionRepository.findOne({
          where: {
            id: requestedTemplateId,
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            type: 'payment_document_template',
            status: 'active',
          },
        })
      : null;
    if (requestedTemplateId && !template) {
      throw new BadRequestException('Modelo de documento inválido ou inativo.');
    }

    if (template) {
      const templateDocumentType = String(template.metadata?.documentType ?? '');
      const expectedType =
        templateDocumentType === 'payslip'
          ? TeamPaymentDocumentType.Payslip
          : templateDocumentType === 'benefit_acknowledgment'
            ? TeamPaymentDocumentType.BenefitsDeclaration
            : templateDocumentType === 'payment_statement'
              ? TeamPaymentDocumentType.Statement
              : null;
      if (expectedType !== dto.type) {
        throw new BadRequestException('O modelo selecionado não corresponde ao tipo de documento.');
      }

      const relationships = template.metadata?.applicableRelationshipTypes;
      if (
        Array.isArray(relationships) &&
        relationships.length > 0 &&
        !relationships.includes(payment.member?.workerType)
      ) {
        throw new BadRequestException('O modelo selecionado não se aplica a este vínculo.');
      }
    }

    const htmlContent = dto.htmlContent ?? this.renderConfiguredPaymentDocument(payment, dto.type, template, dto.metadata);

    return this.documentRepository.save(
      this.documentRepository.create({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        paymentId: payment.id,
        type: dto.type,
        title: dto.title,
        htmlContent,
        pdfFileKey: dto.pdfFileKey ?? null,
        status: dto.status ?? 'generated',
        generatedAt: new Date(),
        metadata: {
          ...(dto.metadata ?? {}),
          templateId: template?.id ?? requestedTemplateId,
          systemKey: template?.metadata?.systemKey ?? null,
          signatureRequired: template?.metadata?.signatureRequired ?? true,
        },
      }),
    );
  }

  private async isEmployeeWorkerType(ctx: RequestContext, workerType: string): Promise<boolean> {
    const configuredTypes = await this.configOptionRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: 'worker_type',
        status: 'active',
      },
    });
    const configuredType = configuredTypes.find((option) =>
      matchesWorkerTypeOption(option, workerType),
    );

    return typeof configuredType?.metadata?.isEmployee === 'boolean'
      ? configuredType.metadata.isEmployee
      : ['employee_full_time', 'employee_part_time'].includes(workerType);
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
    const recurringTemplates = await this.configOptionRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        status: 'active',
        type: In(['payment_benefit_template', 'payment_discount_template']),
      },
    });

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
          dueDate:
            dto.dueDate ??
            buildDueDateFromCompetence(
              dto.competenceEnd,
              readMonthlyDueDay(member),
            ),
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

      const configuredItems = recurringTemplates.flatMap((template) => {
        const metadata = (template.metadata ?? {}) as Record<string, unknown>;
        const relationships = metadata.applicableRelationshipTypes;
        if (metadata.recurring !== true) return [];
        if (Array.isArray(relationships) && relationships.length > 0 && !relationships.includes(member.workerType)) {
          return [];
        }
        const defaultAmount = toNumber(metadata.defaultAmount);
        const defaultPercentage = toNumber(metadata.defaultPercentage);
        const amount = defaultAmount > 0
          ? defaultAmount
          : defaultPercentage > 0
            ? (toNumber(calculated.baseAmount) * defaultPercentage) / 100
            : 0;
        if (amount <= 0) return [];

        return [this.itemRepository.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          paymentId: payment.id,
          type: template.type === 'payment_benefit_template'
            ? TeamPaymentItemType.Benefit
            : TeamPaymentItemType.Discount,
          name: template.name,
          description: template.description,
          amount: money(amount),
          quantity: '1.00',
          unitValue: money(amount),
          metadata: { templateId: template.id, templateSnapshot: metadata },
        })];
      });
      if (configuredItems.length > 0) await this.itemRepository.save(configuredItems);

      payments.push(await this.recalculatePayment(ctx, payment.id));
    }

    return {
      batch,
      payments,
      total: payments.length,
    };
  }

  /** Stable origin key for one competence — anchors Finance idempotency. */
  private teamPaymentOccurrenceKey(payment: TeamPayment) {
    return `team_payment:${payment.id}`;
  }

  private async createFinanceBillForPayment(
    ctx: RequestContext,
    payment: TeamPayment,
    rule: ResolvedFinanceRule,
  ) {
    const financeCtx = toFinanceCtx(ctx);
    const memberName = payment.member?.displayName ?? 'membro';
    const descBase = `Pagamento de equipe - ${memberName} - ${payment.competenceStart} a ${payment.competenceEnd}`;
    const occurrenceKey = this.teamPaymentOccurrenceKey(payment);
    const competencePeriod = payment.competenceStart?.slice(0, 7) ?? null;

    // Idempotency guard: never create a second payable for the same competence.
    // Protects re-confirm, approve and reprocess from duplicating cost even if
    // the financeBillId was not persisted on a previous attempt.
    const existing = await this.financeBillRepository
      .createQueryBuilder('bill')
      .where('bill.tenantId = :tenantId', { tenantId: ctx.tenantId })
      .andWhere('bill.workspaceId = :workspaceId', { workspaceId: ctx.workspaceId })
      .andWhere("bill.metadata ->> 'teamPaymentOccurrenceKey' = :key", { key: occurrenceKey })
      .andWhere('bill.status != :cancelled', { cancelled: FinanceBillStatus.Cancelled })
      .getOne();
    if (existing) {
      return this.financeBillingService.getBill(financeCtx, existing.id);
    }

    const items = payment.items ?? [];
    const positiveItems = items.filter(
      (i) => i.type !== TeamPaymentItemType.Discount,
    );
    const discountItems = items.filter((i) => i.type === TeamPaymentItemType.Discount);

    // Shared per-line classification so every line is traceable back to the
    // exact Team item and keeps the rule's category/cost center.
    const lineMeta = (item: TeamPaymentItem | null, itemType: string) => ({
      sourceModule: 'team',
      sourceType: 'team_payment',
      teamPaymentId: payment.id,
      teamPaymentLineId: item?.id ?? null,
      memberId: payment.memberId,
      competencePeriod,
      financialRuleId: rule.id,
      itemType,
    });
    const lineDefaults = (item: TeamPaymentItem | null, itemType: string) => ({
      categoryId: rule.categoryId,
      costCenterId: rule.costCenterId,
      metadata: lineMeta(item, itemType),
    });

    let lines: Array<{
      description: string;
      quantity?: string;
      unitPrice?: string;
      categoryId?: string | null;
      costCenterId?: string | null;
      metadata?: Record<string, unknown>;
    }>;

    if (positiveItems.length > 0) {
      lines = [
        ...positiveItems.map((item) => ({
          description: item.name,
          quantity: '1',
          // Discounts stay negative so the payable total equals the net amount;
          // they are never turned into a positive expense line.
          unitPrice: money(toNumber(item.amount)),
          ...lineDefaults(item, item.type),
        })),
        ...discountItems.map((item) => ({
          description: `Desconto — ${item.name}`,
          quantity: '1',
          unitPrice: money(-toNumber(item.amount)),
          ...lineDefaults(item, item.type),
        })),
      ];
    } else {
      lines = [
        {
          description: descBase,
          quantity: '1',
          unitPrice: money(toNumber(payment.netAmount)),
          ...lineDefaults(null, 'net'),
        },
      ];
    }

    const discountNote =
      discountItems.length > 0
        ? ` | Descontos: ${discountItems.map((d) => `${d.name} (-${money(toNumber(d.amount))})`).join(', ')}`
        : '';

    const contactId = await this.ensureMemberContact(ctx, payment.member);

    try {
      return await this.financeBillingService.createBill(financeCtx, {
        vendorId: contactId,
        currency: payment.currency ?? 'BRL',
        dueDate: payment.dueDate ?? null,
        periodStart: payment.competenceStart,
        periodEnd: payment.competenceEnd,
        issueDate: new Date().toISOString().slice(0, 10),
        notes: `${descBase}${discountNote}`,
        categoryId: rule.categoryId,
        costCenterId: rule.costCenterId,
        metadata: {
          sourceModule: 'team',
          sourceType: 'team_payment',
          sourceId: payment.id,
          teamPaymentId: payment.id,
          teamPaymentOccurrenceKey: occurrenceKey,
          occurrenceKey,
          memberId: payment.memberId,
          batchId: payment.batchId ?? null,
          competencePeriod,
          competenceStart: payment.competenceStart,
          competenceEnd: payment.competenceEnd,
          financeSettingId: rule.id,
          financialRuleId: rule.id,
          // Destination (company) bank hint only — the collaborator's personal
          // bank data is never stored as a Finance bank account.
          companyBankAccountId: rule.bankAccountId,
        },
        lines,
      });
    } catch (error) {
      // Unique-index race for the same occurrence (UQ_finance_bills_team_payment_
      // occurrence): a concurrent confirm/approve already created the payable.
      // Reconcile by returning the existing bill instead of surfacing an error.
      if ((error as { code?: string })?.code === '23505') {
        const raced = await this.financeBillRepository
          .createQueryBuilder('bill')
          .where('bill.tenantId = :tenantId', { tenantId: ctx.tenantId })
          .andWhere('bill.workspaceId = :workspaceId', { workspaceId: ctx.workspaceId })
          .andWhere("bill.metadata ->> 'teamPaymentOccurrenceKey' = :key", { key: occurrenceKey })
          .getOne();
        if (raced) {
          return this.financeBillingService.getBill(financeCtx, raced.id);
        }
      }
      throw error;
    }
  }

  private async findFinanceRule(ctx: RequestContext, workerType?: string | null) {
    const financeRules = await this.configOptionRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: 'payment_finance_setting',
        status: 'active',
      },
    });
    const matches = financeRules.filter((rule) => {
      const relationships = (rule.metadata ?? {}).relationshipTypes;
      return Array.isArray(relationships) && relationships.includes(workerType);
    });
    // Prefer the salary/custom (base pay) rule when several rules target the
    // same worker type for different "Aplica-se a" buckets.
    return (
      matches.find((rule) => {
        const appliesTo = (rule.metadata ?? {}).appliesTo;
        return appliesTo === 'salary' || appliesTo === 'custom' || appliesTo == null;
      }) ?? matches[0]
    );
  }

  private async resolveFinanceRuleConfig(
    ctx: RequestContext,
    workerType?: string | null,
  ): Promise<ResolvedFinanceRule> {
    const rule = await this.findFinanceRule(ctx, workerType);
    const md = (rule?.metadata ?? {}) as Record<string, unknown>;
    const bool = (value: unknown, fallback: boolean) =>
      typeof value === 'boolean' ? value : fallback;
    const strId = (value: unknown) =>
      typeof value === 'string' && value ? value : null;

    return {
      id: rule?.id ?? null,
      // No rule → still generate a payable (preserves historical behaviour).
      createPayable: bool(md.createPayable, true),
      createExpense: bool(md.createExpense, false),
      // Only block when a rule explicitly requires approval.
      requireApproval: rule ? bool(md.requireApprovalBeforeFinance, false) : false,
      categoryId: strId(md.defaultCategoryId),
      costCenterId: strId(md.defaultCostCenterId),
      journalId: strId(md.defaultJournalId),
      accountId: strId(md.defaultFinanceAccountId),
      bankAccountId: strId(md.defaultBankAccountId),
      appliesTo: typeof md.appliesTo === 'string' ? md.appliesTo : null,
    };
  }

  private async ensureMemberContact(ctx: RequestContext, member?: TeamMember | null) {
    if (!member) return null;
    if (member.contactId) return member.contactId;

    const contact = await this.agencyContactsService.createContact(ctx, {
      type: 'person',
      displayName: member.displayName,
      legalName: member.legalName ?? undefined,
      jobTitle: member.jobTitle ?? member.roleName ?? undefined,
      source: 'other',
      businessMode: 'agency_service',
      lifecycleStage: 'internal',
      status: 'active',
      notes: `Contato criado automaticamente a partir do membro da equipe ${member.id}.`,
    });
    member.contactId = contact.id;
    await this.memberRepository.save(member);
    return contact.id;
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

  private renderConfiguredPaymentDocument(
    payment: TeamPayment,
    type: TeamPaymentDocumentType,
    template: TeamConfigOption | null,
    requestMetadata?: Record<string, unknown>,
  ) {
    const templateMetadata = (template?.metadata ?? {}) as Record<string, unknown>;
    const renderer = String(
      templateMetadata.templateRenderer ??
        (type === TeamPaymentDocumentType.Payslip
          ? 'payslip'
          : type === TeamPaymentDocumentType.BenefitsDeclaration
            ? 'benefit_acknowledgment'
            : type === TeamPaymentDocumentType.Statement
              ? 'payment_statement'
              : ''),
    );
    const memberMetadata = (payment.member?.metadata ?? {}) as Record<string, unknown>;
    const agencySnapshot = (requestMetadata?.agencySnapshot ?? {}) as Record<string, unknown>;
    const items = payment.items ?? [];
    const benefits = items
      .filter((item) => item.type === TeamPaymentItemType.Benefit && toNumber(item.amount) > 0)
      .map((item) => ({ name: item.name, amount: toNumber(item.amount) }));
    const deductions = items
      .filter((item) => item.type === TeamPaymentItemType.Discount && toNumber(item.amount) > 0)
      .map((item) => ({ name: item.name, amount: toNumber(item.amount) }));
    const earnings = items
      .filter((item) => [TeamPaymentItemType.Base, TeamPaymentItemType.Overtime, TeamPaymentItemType.Adjustment].includes(item.type) && toNumber(item.amount) !== 0)
      .map((item) => ({ name: item.name, amount: toNumber(item.amount) }));
    const locale = String(templateMetadata.countryScope) === 'US' ? 'en-US' : 'pt-BR';
    const date = (value: string | null | undefined) => {
      if (!value) return '';
      const match = value.match(/^(\d{4})-(\d{2})-(\d{2})$/);
      return match ? `${match[3]}/${match[2]}/${match[1]}` : value;
    };
    const periodLabel = new Intl.DateTimeFormat(locale, { month: 'long', year: 'numeric' }).format(
      new Date(`${payment.competenceStart}T12:00:00Z`),
    );
    const common = {
      agency: {
        legalName: String(agencySnapshot.legalName ?? agencySnapshot.tradeName ?? 'Agência'),
        publicName: String(agencySnapshot.tradeName ?? agencySnapshot.legalName ?? 'Agência'),
        taxId: String(agencySnapshot.taxId ?? ''),
        address: String(agencySnapshot.address ?? agencySnapshot.addressLine ?? ''),
        email: String(agencySnapshot.email ?? agencySnapshot.billingEmail ?? agencySnapshot.supportEmail ?? ''),
        phone: String(agencySnapshot.phone ?? ''),
        signerName: String(agencySnapshot.signerName ?? 'Responsável financeiro'),
        signerRole: String(agencySnapshot.signerRole ?? 'Responsável da agência'),
      },
      member: {
        displayName: payment.member?.displayName ?? payment.memberId,
        legalName: payment.member?.legalName ?? payment.member?.displayName ?? payment.memberId,
        document: String(memberMetadata.personalTaxId ?? memberMetadata.document ?? ''),
        role: payment.member?.jobTitle ?? payment.member?.roleName ?? '',
        department: String(memberMetadata.departmentName ?? payment.member?.workerType ?? ''),
      },
      period: {
        label: periodLabel,
        startDate: date(payment.competenceStart),
        endDate: date(payment.competenceEnd),
        paymentDate: date(payment.paidAt ? payment.paidAt.toISOString().slice(0, 10) : payment.dueDate),
      },
      payment: {
        currency: payment.currency,
        baseAmount: toNumber(payment.baseAmount),
        grossAmount: toNumber(payment.grossAmount),
        netAmount: toNumber(payment.netAmount),
        paymentMethod: String(payment.metadata?.paymentMethod ?? 'Transferência bancária'),
        notes: payment.notes ?? 'Documento informativo. Não substitui cálculo fiscal ou trabalhista oficial.',
      },
      benefits,
      earnings,
      deductions,
      signature: {
        memberName: payment.member?.displayName ?? payment.memberId,
        memberRole: payment.member?.jobTitle ?? payment.member?.roleName ?? '',
        agencySignerName: String(agencySnapshot.signerName ?? 'Responsável financeiro'),
        agencySignerRole: String(agencySnapshot.signerRole ?? 'Responsável da agência'),
        city: String(agencySnapshot.city ?? ''),
        date: new Intl.DateTimeFormat(locale).format(new Date()),
      },
      document: { name: template?.name ?? 'Documento de pagamento', locale },
      presentation: {
        headerPreset: String(templateMetadata.headerPreset ?? 'classic'),
        footerPreset: String(templateMetadata.footerPreset ?? 'lyra'),
        showLogo: templateMetadata.showLogo !== false,
        logoUrl: typeof agencySnapshot.logoUrl === 'string'
          ? agencySnapshot.logoUrl
          : typeof agencySnapshot.avatarUrl === 'string'
            ? agencySnapshot.avatarUrl
            : null,
        showCompanyData: templateMetadata.showCompanyData !== false,
        showDocumentNumber: templateMetadata.showDocumentNumber === true,
        documentNumber: `PAY-${payment.id.slice(0, 8).toUpperCase()}`,
        showPoweredByLyra: templateMetadata.showPoweredByLyra !== false,
      },
    };

    if (renderer === 'payslip') {
      return this.pdfRendererService.buildTeamPayslipHtml({
        ...common,
        pageSize: templateMetadata.defaultPageSize === 'LETTER' ? 'LETTER' : 'A4',
      });
    }
    if (renderer === 'benefit_acknowledgment') {
      return this.pdfRendererService.buildTeamBenefitAcknowledgmentHtml(common);
    }
    if (renderer === 'payment_statement') {
      return this.pdfRendererService.buildTeamPaymentStatementHtml({
        ...common,
        contract: {
          number: String(payment.contractId ?? ''),
          paymentTerms: String(payment.metadata?.paymentTerms ?? ''),
        },
      });
    }

    return this.renderPaymentStatement(payment);
  }
}
