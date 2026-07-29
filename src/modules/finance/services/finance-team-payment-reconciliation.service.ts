import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Between, In, IsNull, Not, Repository } from 'typeorm';
import { TeamPayment } from '../../team/entities';
import { TeamPaymentStatus } from '../../team/enums';
import {
  FinanceBill,
  FinancePayment,
  FinancePaymentAllocation,
} from '../entities';
import {
  FinanceAllocationTargetType,
  FinanceBillStatus,
  FinancePaymentStatus,
} from '../enums';
import type { FinanceRequestContext } from './finance-context';

const AGENCY_CONNECTION = 'agency';
const MONEY_EPSILON = 0.005;

export type TeamPaymentReconciliationScope = {
  memberId?: string;
  batchId?: string;
  competenceStart?: string;
  competenceEnd?: string;
};

function toNumber(value: unknown): number {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number : 0;
}

function dateValue(value: Date | string | null | undefined): number {
  if (!value) return 0;
  const parsed = value instanceof Date ? value : new Date(value);
  const timestamp = parsed.getTime();
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sameDate(
  left: Date | string | null | undefined,
  right: Date | string | null | undefined,
): boolean {
  return dateValue(left) === dateValue(right);
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is string => typeof item === 'string'),
    ),
  ];
}

function sameStringArray(left: string[], right: string[]): boolean {
  return (
    left.length === right.length &&
    left.every((item, index) => item === right[index])
  );
}

function paymentDate(payment: FinancePayment): Date | null {
  if (payment.paymentDate) {
    return new Date(`${payment.paymentDate}T12:00:00.000Z`);
  }
  return payment.createdAt ?? null;
}

/**
 * Keeps Team's compensation lifecycle aligned with Finance, which remains the
 * source of truth once a competence has a linked payable.
 *
 * Reconciliation is intentionally batched: a Team list costs a fixed set of
 * Finance queries instead of one bill/payment query per collaborator.
 */
@Injectable()
export class FinanceTeamPaymentReconciliationService {
  constructor(
    @InjectRepository(TeamPayment, AGENCY_CONNECTION)
    private readonly teamPaymentsRepository: Repository<TeamPayment>,

    @InjectRepository(FinanceBill, AGENCY_CONNECTION)
    private readonly billsRepository: Repository<FinanceBill>,

    @InjectRepository(FinancePaymentAllocation, AGENCY_CONNECTION)
    private readonly allocationsRepository: Repository<FinancePaymentAllocation>,

    @InjectRepository(FinancePayment, AGENCY_CONNECTION)
    private readonly financePaymentsRepository: Repository<FinancePayment>,
  ) {}

  async reconcilePayment(
    ctx: FinanceRequestContext,
    teamPayment: TeamPayment,
  ): Promise<TeamPayment> {
    const [reconciled] = await this.reconcilePayments(ctx, [teamPayment]);
    return reconciled ?? teamPayment;
  }

  async reconcileWorkspacePayments(
    ctx: FinanceRequestContext,
    scope: TeamPaymentReconciliationScope = {},
  ): Promise<TeamPayment[]> {
    const where: Record<string, unknown> = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      financeBillId: Not(IsNull()),
      status: Not(
        In([TeamPaymentStatus.Cancelled, TeamPaymentStatus.Archived]),
      ),
    };
    if (scope.memberId) where.memberId = scope.memberId;
    if (scope.batchId) where.batchId = scope.batchId;
    if (scope.competenceStart && scope.competenceEnd) {
      where.competenceStart = Between(
        scope.competenceStart,
        scope.competenceEnd,
      );
    }

    const payments = await this.teamPaymentsRepository.find({ where });
    return this.reconcilePayments(ctx, payments);
  }

  async reconcileBills(
    ctx: FinanceRequestContext,
    financeBillIds: string[],
  ): Promise<TeamPayment[]> {
    const billIds = [...new Set(financeBillIds.filter(Boolean))];
    if (billIds.length === 0) return [];

    const payments = await this.teamPaymentsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        financeBillId: In(billIds),
        status: Not(
          In([TeamPaymentStatus.Cancelled, TeamPaymentStatus.Archived]),
        ),
      },
    });
    return this.reconcilePayments(ctx, payments);
  }

  async reconcilePayments(
    ctx: FinanceRequestContext,
    teamPayments: TeamPayment[],
  ): Promise<TeamPayment[]> {
    const candidates = teamPayments.filter(
      (payment) =>
        Boolean(payment.financeBillId) &&
        payment.status !== TeamPaymentStatus.Cancelled &&
        payment.status !== TeamPaymentStatus.Archived,
    );
    if (candidates.length === 0) return teamPayments;

    const billIds = [
      ...new Set(
        candidates
          .map((payment) => payment.financeBillId)
          .filter((id): id is string => Boolean(id)),
      ),
    ];
    const bills = await this.billsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        id: In(billIds),
      },
    });
    const billsById = new Map(bills.map((bill) => [bill.id, bill]));
    if (billsById.size === 0) return teamPayments;

    const allocations = await this.allocationsRepository.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        targetType: FinanceAllocationTargetType.Bill,
        targetId: In([...billsById.keys()]),
      },
    });
    const financePaymentIds = [
      ...new Set(allocations.map((allocation) => allocation.paymentId)),
    ];
    const financePayments = financePaymentIds.length
      ? await this.financePaymentsRepository.find({
          where: {
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            id: In(financePaymentIds),
          },
        })
      : [];
    const completedPaymentsById = new Map(
      financePayments
        .filter((payment) => payment.status === FinancePaymentStatus.Completed)
        .map((payment) => [payment.id, payment]),
    );
    const allocationsByBillId = new Map<string, FinancePaymentAllocation[]>();
    for (const allocation of allocations) {
      const current = allocationsByBillId.get(allocation.targetId) ?? [];
      current.push(allocation);
      allocationsByBillId.set(allocation.targetId, current);
    }

    const changed: TeamPayment[] = [];
    for (const teamPayment of candidates) {
      const bill = billsById.get(teamPayment.financeBillId as string);
      if (!bill) continue;

      const completedPayments = [
        ...new Map(
          (allocationsByBillId.get(bill.id) ?? [])
            .map((allocation) =>
              completedPaymentsById.get(allocation.paymentId),
            )
            .filter((payment): payment is FinancePayment => Boolean(payment))
            .map((payment) => [payment.id, payment]),
        ).values(),
      ].sort((left, right) => {
        const byPaymentDate = left.paymentDate.localeCompare(right.paymentDate);
        if (byPaymentDate !== 0) return byPaymentDate;
        const byCreatedAt =
          dateValue(left.createdAt) - dateValue(right.createdAt);
        if (byCreatedAt !== 0) return byCreatedAt;
        return left.id.localeCompare(right.id);
      });

      const total = toNumber(bill.totalAmount);
      const paid = toNumber(bill.paidAmount);
      const balance = toNumber(bill.balanceDue);
      const fullyPaid =
        bill.status !== FinanceBillStatus.Cancelled &&
        (bill.status === FinanceBillStatus.Paid ||
          (total > MONEY_EPSILON &&
            paid > MONEY_EPSILON &&
            balance <= MONEY_EPSILON));
      const nextStatus = fullyPaid
        ? TeamPaymentStatus.Paid
        : TeamPaymentStatus.PaymentPending;
      const latestFinancePayment = completedPayments.at(-1) ?? null;
      const nextFinancePaymentId = latestFinancePayment?.id ?? null;
      const nextFinancePaymentIds = completedPayments.map(
        (payment) => payment.id,
      );
      const currentFinancePaymentIds = stringArray(
        teamPayment.metadata?.financePaymentIds,
      );
      const nextPaidAt = fullyPaid
        ? (bill.paidAt ??
          (latestFinancePayment ? paymentDate(latestFinancePayment) : null) ??
          teamPayment.paidAt)
        : null;

      const stateChanged =
        teamPayment.status !== nextStatus ||
        teamPayment.financePaymentId !== nextFinancePaymentId ||
        !sameDate(teamPayment.paidAt, nextPaidAt) ||
        !sameStringArray(currentFinancePaymentIds, nextFinancePaymentIds) ||
        teamPayment.metadata?.financePaymentPending !== !fullyPaid ||
        teamPayment.metadata?.financeBillStatus !== bill.status;

      if (!stateChanged) continue;

      teamPayment.status = nextStatus;
      teamPayment.financePaymentId = nextFinancePaymentId;
      teamPayment.paidAt = nextPaidAt;
      teamPayment.metadata = {
        ...(teamPayment.metadata ?? {}),
        financePaymentIds: nextFinancePaymentIds,
        financePaymentPending: !fullyPaid,
        financeBillStatus: bill.status,
        financeReconciliationSource: 'finance_bill',
        financeReconciledAt: new Date().toISOString(),
      };
      changed.push(teamPayment);
    }

    if (changed.length > 0) {
      await this.teamPaymentsRepository.save(changed);
    }
    return teamPayments;
  }
}
