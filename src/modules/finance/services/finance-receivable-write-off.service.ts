import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import {
  CreateFinanceReceivableWriteOffDto,
  FinanceReceivableWriteOffQueryDto,
  ReverseFinanceReceivableWriteOffDto,
} from '../dto';
import {
  FinanceInvoice,
  FinancePeriod,
  FinanceReceivableWriteOff,
} from '../entities';
import { FinanceInvoiceStatus, FinancePeriodStatus } from '../enums';
import { FinanceRequestContext } from './finance-context';
import { FinancePostingService } from './finance-posting.service';
import { applyInvoiceSettlement } from './finance-invoice-settlement';

function cents(value: string): number {
  if (!/^\d{1,12}(\.\d{1,2})?$/.test(value))
    throw new BadRequestException(
      'Informe um valor positivo com até duas casas decimais.',
    );
  const amount = Math.round(Number(value) * 100);
  if (amount <= 0)
    throw new BadRequestException('O valor da perda deve ser maior que zero.');
  return amount;
}
function dateOnly(value: string) {
  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(value) ||
    Number.isNaN(Date.parse(value)) ||
    new Date(value).toISOString().slice(0, 10) !== value
  ) {
    throw new BadRequestException('Informe uma data válida.');
  }
  return value;
}
function reason(value: string) {
  const text = value?.trim();
  if (!text || text.length > 2000)
    throw new BadRequestException(
      'Informe um motivo com até 2.000 caracteres.',
    );
  return text;
}

@Injectable()
export class FinanceReceivableWriteOffService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
    private readonly postingService: FinancePostingService,
  ) {}

  async search(
    ctx: FinanceRequestContext,
    query: FinanceReceivableWriteOffQueryDto,
  ) {
    if (query.startDate) dateOnly(query.startDate);
    if (query.endDate) dateOnly(query.endDate);
    if (query.startDate && query.endDate && query.startDate > query.endDate)
      throw new BadRequestException(
        'A data inicial deve anteceder a data final.',
      );
    const limit = query.limit ?? 25;
    const offset = query.offset ?? 0;
    const qb = this.dataSource
      .getRepository(FinanceReceivableWriteOff)
      .createQueryBuilder('loss')
      .innerJoin(
        FinanceInvoice,
        'invoice',
        'invoice.id = loss.invoice_id AND invoice.tenant_id = loss.tenant_id AND invoice.workspace_id = loss.workspace_id',
      )
      .where(
        'loss.tenant_id = :tenantId AND loss.workspace_id = :workspaceId',
        ctx,
      )
      .addSelect('invoice.invoiceNumber', 'invoiceNumber')
      .addSelect('invoice.customerId', 'customerId');
    if (query.customerId)
      qb.andWhere('invoice.customer_id = :customerId', {
        customerId: query.customerId,
      });
    if (query.startDate)
      qb.andWhere('loss.write_off_date >= :startDate', {
        startDate: query.startDate,
      });
    if (query.endDate)
      qb.andWhere('loss.write_off_date <= :endDate', {
        endDate: query.endDate,
      });
    if (query.status)
      qb.andWhere('loss.status = :status', { status: query.status });
    const total = await qb.getCount();
    const result = await qb
      .orderBy('loss.writeOffDate', 'DESC')
      .addOrderBy('loss.id', 'DESC')
      .skip(offset)
      .take(limit)
      .getRawAndEntities<{
        invoiceNumber: string;
        customerId: string | null;
      }>();
    return {
      items: result.entities.map((loss, index) => ({
        ...loss,
        invoiceNumber: result.raw[index].invoiceNumber,
        customerId: result.raw[index].customerId,
      })),
      total,
      limit,
      offset,
    };
  }

  private async refreshReceived(
    m: EntityManager,
    ctx: FinanceRequestContext,
    invoice: FinanceInvoice,
  ) {
    const rows = await m.query<{ paid: string }[]>(
      `SELECT coalesce(sum(a.amount),0)::text AS paid
      FROM finance_payment_allocations a JOIN finance_payments p ON p.id=a.payment_id
        AND p.tenant_id=a.tenant_id AND p.workspace_id=a.workspace_id
      WHERE a.tenant_id=$1 AND a.workspace_id=$2 AND a.target_type='invoice' AND a.target_id=$3 AND p.status='completed'`,
      [ctx.tenantId, ctx.workspaceId, invoice.id],
    );
    applyInvoiceSettlement(invoice, Number(rows[0]?.paid ?? 0));
  }

  private async invoice(
    m: EntityManager,
    ctx: FinanceRequestContext,
    id: string,
    lock = true,
  ) {
    const invoice = await m.getRepository(FinanceInvoice).findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
      ...(lock ? { lock: { mode: 'pessimistic_write' as const } } : {}),
    });
    if (!invoice) throw new NotFoundException('Fatura não encontrada.');
    return invoice;
  }

  private async assertOpenPeriod(
    m: EntityManager,
    ctx: FinanceRequestContext,
    date: string,
  ) {
    const periods = await m
      .getRepository(FinancePeriod)
      .createQueryBuilder('period')
      .where(
        'period.tenant_id = :tenantId AND period.workspace_id = :workspaceId',
        ctx,
      )
      .andWhere('period.period_start <= :date AND period.period_end >= :date', {
        date,
      })
      .setLock('pessimistic_read')
      .getMany();
    if (periods.some((period) => period.status !== FinancePeriodStatus.Open)) {
      throw new BadRequestException(
        'O período contábil está fechado ou bloqueado.',
      );
    }
  }

  async list(ctx: FinanceRequestContext, invoiceId: string) {
    await this.invoice(this.dataSource.manager, ctx, invoiceId, false);
    return this.dataSource.getRepository(FinanceReceivableWriteOff).find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        invoiceId,
      },
      order: { createdAt: 'DESC' },
    });
  }

  async create(
    ctx: FinanceRequestContext,
    invoiceId: string,
    dto: CreateFinanceReceivableWriteOffDto,
  ) {
    const amount = (cents(dto.amount) / 100).toFixed(2);
    const writeOffDate = dateOnly(dto.writeOffDate);
    const lossReason = reason(dto.reason);
    const evidence = dto.evidence?.trim() || null;
    if (evidence && evidence.length > 2000)
      throw new BadRequestException(
        'A referência da evidência deve ter até 2.000 caracteres.',
      );
    return this.dataSource.transaction(async (m) => {
      const invoice = await this.invoice(m, ctx, invoiceId);
      const repo = m.getRepository(FinanceReceivableWriteOff);
      const existing = await repo.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          idempotencyKey: dto.idempotencyKey,
        },
      });
      if (existing) {
        if (
          existing.invoiceId !== invoiceId ||
          existing.amount !== amount ||
          existing.writeOffDate !== writeOffDate ||
          existing.reason !== lossReason ||
          existing.evidence !== evidence ||
          existing.expenseAccountId !== dto.expenseAccountId
        ) {
          throw new ConflictException(
            'Esta chave já foi utilizada para outra baixa.',
          );
        }
        return existing;
      }
      if (
        ![
          FinanceInvoiceStatus.Issued,
          FinanceInvoiceStatus.PartiallyPaid,
          FinanceInvoiceStatus.Overdue,
        ].includes(invoice.status)
      ) {
        throw new BadRequestException(
          'A perda só pode ser registrada em uma fatura emitida com saldo disponível.',
        );
      }
      await this.refreshReceived(m, ctx, invoice);
      if (
        Math.round(Number(amount) * 100) >
        Math.round(Number(invoice.balanceDue) * 100)
      ) {
        throw new BadRequestException(
          'A perda excede o saldo disponível da fatura.',
        );
      }
      if (invoice.issueDate && writeOffDate < invoice.issueDate)
        throw new BadRequestException(
          'A perda não pode anteceder a emissão da fatura.',
        );
      await this.assertOpenPeriod(m, ctx, writeOffDate);
      await m.getRepository(FinanceInvoice).save(invoice);
      const loss = await repo.save(
        repo.create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          invoiceId,
          amount,
          currency: invoice.currency,
          writeOffDate,
          reason: lossReason,
          evidence,
          expenseAccountId: dto.expenseAccountId,
          idempotencyKey: dto.idempotencyKey,
          status: 'active',
          createdById: ctx.userId ?? null,
          journalEntryId: null,
          reversedAt: null,
          reversedById: null,
          reversalDate: null,
          reversalReason: null,
          reversalEntryId: null,
        }),
      );
      const entry = await this.postingService.postReceivableWriteOff(
        ctx,
        invoice,
        loss,
        m,
      );
      loss.journalEntryId = entry.id;
      await repo.save(loss);
      invoice.writtenOffAmount = (
        (Number(invoice.writtenOffAmount || 0) * 100 + Number(amount) * 100) /
        100
      ).toFixed(2);
      applyInvoiceSettlement(invoice);
      await m.getRepository(FinanceInvoice).save(invoice);
      return loss;
    });
  }

  async reverse(
    ctx: FinanceRequestContext,
    invoiceId: string,
    id: string,
    dto: ReverseFinanceReceivableWriteOffDto,
  ) {
    const reversalDate = dateOnly(dto.reversalDate);
    const reversalReason = reason(dto.reason);
    return this.dataSource.transaction(async (m) => {
      const invoice = await this.invoice(m, ctx, invoiceId);
      const repo = m.getRepository(FinanceReceivableWriteOff);
      const loss = await repo.findOne({
        where: {
          id,
          invoiceId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      });
      if (!loss) throw new NotFoundException('Perda não encontrada.');
      if (loss.status === 'reversed') {
        if (
          loss.reversalDate !== reversalDate ||
          loss.reversalReason !== reversalReason
        )
          throw new ConflictException(
            'Esta perda já foi estornada com outros dados.',
          );
        return loss;
      }
      if (reversalDate < loss.writeOffDate)
        throw new BadRequestException('O estorno não pode anteceder a perda.');
      await this.assertOpenPeriod(m, ctx, reversalDate);
      await this.refreshReceived(m, ctx, invoice);
      const entry = await this.postingService.reverseReceivableWriteOff(
        ctx,
        loss,
        reversalDate,
        m,
      );
      loss.status = 'reversed';
      loss.reversedAt = new Date();
      loss.reversedById = ctx.userId ?? null;
      loss.reversalDate = reversalDate;
      loss.reversalReason = reversalReason;
      loss.reversalEntryId = entry.id;
      await repo.save(loss);
      invoice.writtenOffAmount = Math.max(
        0,
        Number(invoice.writtenOffAmount || 0) - Number(loss.amount),
      ).toFixed(2);
      applyInvoiceSettlement(invoice);
      await m.getRepository(FinanceInvoice).save(invoice);
      return loss;
    });
  }
}
