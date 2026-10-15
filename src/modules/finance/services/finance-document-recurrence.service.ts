import { AgencyClientStatus } from '../../clients/enums';
import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import {
  AgencyClient,
  AgencyClientCompanyContext,
} from '../../clients/entities';
import { ContractDocument, ContractRecord } from '../../contracts/entities';
import {
  ContractDocumentKind,
  ContractTargetType,
  ContractStatus,
} from '../../contracts/enums';
import {
  contractToday,
  contractVariable,
  isSignedContract,
  resolveContractTerm,
} from '../../contracts/contract-term';
import { ConfigureFinanceDocumentRecurrenceDto } from '../dto/finance-document-recurrence.dto';
import {
  FinanceBill,
  FinanceBillLine,
  FinanceBillRecurrence,
  FinanceInvoice,
  FinanceInvoiceLine,
  FinanceRecurringProfile,
} from '../entities';
import {
  FinanceBillRecurrenceFrequency,
  FinanceBillRecurrenceStatus,
  FinanceRecurringInterval,
  FinanceRecurringProfileStatus,
} from '../enums';
import { FinanceRequestContext } from './finance-context';
import {
  nextMonthlyOccurrence,
  monthlyOccurrenceOnOrAfter,
  recurrenceNotBefore,
  recurrenceDay,
  recurrenceDocumentMetadata,
  validateRecurrenceDays,
  recurrenceText,
} from './finance-recurrence.rules';

@Injectable()
export class FinanceDocumentRecurrenceService {
  constructor(
    @InjectDataSource('agency') private readonly dataSource: DataSource,
  ) {}

  async delete(
    ctx: FinanceRequestContext,
    kind: 'invoice' | 'bill',
    id: string,
  ) {
    const scope = { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
    const initial =
      kind === 'invoice'
        ? await this.dataSource
            .getRepository(FinanceRecurringProfile)
            .findOne({ where: { ...scope, id } })
        : await this.dataSource
            .getRepository(FinanceBillRecurrence)
            .findOne({ where: { ...scope, id } });
    if (!initial) throw new NotFoundException('Recorrência não encontrada.');
    const sourceId =
      kind === 'invoice'
        ? (initial as FinanceRecurringProfile).sourceModule ===
          'finance_invoice'
          ? (initial as FinanceRecurringProfile).sourceId
          : null
        : (initial as FinanceBillRecurrence).sourceBillId;
    return this.dataSource.transaction(async (manager) => {
      // Match configuration lock order: source document, then recurrence.
      const document = !sourceId
        ? null
        : kind === 'invoice'
          ? await manager.getRepository(FinanceInvoice).findOne({
              where: { ...scope, id: sourceId },
              lock: { mode: 'pessimistic_write' },
            })
          : await manager.getRepository(FinanceBill).findOne({
              where: { ...scope, id: sourceId },
              lock: { mode: 'pessimistic_write' },
            });
      if (kind === 'invoice') {
        const repo = manager.getRepository(FinanceRecurringProfile);
        const profile = await repo.findOne({
          where: { ...scope, id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!profile)
          throw new NotFoundException('Recorrência não encontrada.');
        profile.status = FinanceRecurringProfileStatus.Cancelled;
        profile.autoGenerateInvoice = false;
        profile.metadata = {
          ...profile.metadata,
          deletedAt: new Date().toISOString(),
        };
        await repo.save(profile);
      } else {
        const repo = manager.getRepository(FinanceBillRecurrence);
        const profile = await repo.findOne({
          where: { ...scope, id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!profile)
          throw new NotFoundException('Recorrência não encontrada.');
        profile.status = FinanceBillRecurrenceStatus.Cancelled;
        profile.active = false;
        profile.metadata = {
          ...profile.metadata,
          deletedAt: new Date().toISOString(),
        };
        await repo.save(profile);
      }
      if (document) {
        document.metadata = { ...document.metadata, isRecurring: false };
        if (kind === 'invoice')
          await manager
            .getRepository(FinanceInvoice)
            .save(document as FinanceInvoice);
        else
          await manager
            .getRepository(FinanceBill)
            .save(document as FinanceBill);
      }
      return { id, deleted: true };
    });
  }

  async eligibleContracts(ctx: FinanceRequestContext, invoiceId: string) {
    const invoice = await this.dataSource
      .getRepository(FinanceInvoice)
      .findOne({
        where: {
          id: invoiceId,
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
        },
      });
    if (!invoice) throw new NotFoundException('Finance invoice not found');
    return this.eligibleContractsForCustomer(ctx, invoice.customerId);
  }

  async eligibleContractsForCustomer(
    ctx: FinanceRequestContext,
    customerId: string | null,
  ) {
    if (!customerId) return [];
    const scope = { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
    const [clients, contexts] = await Promise.all([
      this.dataSource
        .getRepository(AgencyClient)
        .find({ where: { ...scope, archivedAt: IsNull() } }),
      this.dataSource.getRepository(AgencyClientCompanyContext).find({
        where: {
          ...scope,
          companyContactId: customerId,
          status: 'active',
          archivedAt: IsNull(),
        },
      }),
    ]);
    const owners = clients.filter(
      (client) =>
        client.status === AgencyClientStatus.Active &&
        (!client.endDate || client.endDate >= contractToday()) &&
        [client.id, client.contactId, client.metadata?.contactId].includes(
          customerId,
        ),
    );
    const ids = new Set([
      ...owners.map((client) => client.id),
      ...contexts.map((context) => context.agencyClientId),
    ]);
    const eligibleClients = clients.filter(
      (client) =>
        ids.has(client.id) &&
        client.status === AgencyClientStatus.Active &&
        (!client.endDate || client.endDate >= contractToday()),
    );
    if (!eligibleClients.length) return [];
    const records = await this.dataSource.getRepository(ContractRecord).find({
      where: eligibleClients.map((client) => ({
        ...scope,
        targetType: ContractTargetType.Client,
        targetId: client.id,
        documentKind: ContractDocumentKind.Contract,
        archivedAt: IsNull(),
        cancelledAt: IsNull(),
      })),
    });
    const today = contractToday();
    const results: Array<{
      id: string;
      title: string;
      dueDay: number | null;
      monthlyValue: string | null;
      currency: string | null;
      services: string | null;
      customerId: string;
    }> = [];
    for (const client of eligibleClients) {
      const signed: Array<ContractRecord & { documents: ContractDocument[] }> =
        [];
      for (const record of records.filter(
        (item) => item.targetId === client.id,
      )) {
        if (record.status === ContractStatus.Expired) continue;
        if (
          (record.validFrom && record.validFrom > today) ||
          (record.validUntil && record.validUntil < today)
        )
          continue;
        const documents = await this.dataSource
          .getRepository(ContractDocument)
          .find({ where: { ...scope, contractId: record.id } });
        if (isSignedContract({ ...record, documents }))
          signed.push({ ...record, documents });
      }
      const term = resolveContractTerm(signed, today);
      const record = signed.find((item) => item.id === term.contractId);
      if (!record || ['none', 'pending', 'expired'].includes(term.state))
        continue;
      const dueDay = Number(
        term.dueDay ??
          contractVariable(record.variablesData, 'offer.invoiceDueDay'),
      );
      results.push({
        customerId: customerId,
        id: record.id,
        title: record.title,
        dueDay:
          Number.isInteger(dueDay) && dueDay >= 1 && dueDay <= 31
            ? dueDay
            : null,
        monthlyValue:
          term.monthlyValue ??
          (recurrenceText(
            contractVariable(record.variablesData, 'offer.recurringAmount'),
          ) ||
            null),
        currency: term.currency,
        services:
          recurrenceText(
            contractVariable(record.variablesData, 'offer.services'),
          ) || null,
      });
    }
    return results;
  }

  async configure(
    ctx: FinanceRequestContext,
    kind: 'invoice' | 'bill',
    id: string,
    dto: ConfigureFinanceDocumentRecurrenceDto,
  ) {
    validateRecurrenceDays(dto.generationDay, dto.dueDay);
    let contract:
      | Awaited<
          ReturnType<FinanceDocumentRecurrenceService['eligibleContracts']>
        >[number]
      | undefined;
    if (dto.contractId) {
      if (kind !== 'invoice')
        throw new BadRequestException(
          'Contratos só podem ser vinculados a faturas.',
        );
      contract = (await this.eligibleContracts(ctx, id)).find(
        (item) => item.id === dto.contractId,
      );
      if (!contract)
        throw new BadRequestException(
          'O contrato deve estar vigente e pertencer ao cliente da fatura.',
        );
      if (!contract.dueDay)
        throw new BadRequestException(
          'Configure o dia de vencimento no contrato antes de vinculá-lo.',
        );
    }
    const scope = { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
    return this.dataSource.transaction(async (manager) => {
      // Serialize configuration of a saved source document; retries reuse its profile.
      const document =
        kind === 'invoice'
          ? await manager.getRepository(FinanceInvoice).findOne({
              where: { ...scope, id },
              lock: { mode: 'pessimistic_write' },
            })
          : await manager.getRepository(FinanceBill).findOne({
              where: { ...scope, id },
              lock: { mode: 'pessimistic_write' },
            });
      if (!document) throw new NotFoundException('Finance document not found');
      if (
        contract &&
        (document as FinanceInvoice).customerId !== contract.customerId
      )
        throw new BadRequestException(
          'O cliente da fatura foi alterado. Atualize e tente novamente.',
        );
      const lines: Array<FinanceInvoiceLine | FinanceBillLine> =
        kind === 'invoice'
          ? await manager.getRepository(FinanceInvoiceLine).find({
              where: { ...scope, invoiceId: id },
              order: { createdAt: 'ASC' },
            })
          : await manager.getRepository(FinanceBillLine).find({
              where: { ...scope, billId: id },
              order: { createdAt: 'ASC' },
            });
      if (dto.enabled && (!lines.length || Number(document.totalAmount) <= 0))
        throw new BadRequestException(
          'Adicione os itens e valores antes de ativar a recorrência.',
        );
      const metadata = document.metadata ?? {};
      if (
        metadata.generatedFromRecurrenceId ||
        metadata.generatedFromRecurringProfileId
      )
        throw new BadRequestException(
          'Configure a recorrência no documento de origem.',
        );
      const dueDay = contract?.dueDay ?? dto.dueDay;
      const startDate = contractToday();
      // The source document already occupies its month; it must never backdate registration.
      const sourceNext = nextMonthlyOccurrence(
        document.issueDate ?? startDate,
        dto.generationDay,
      );
      const nextDate = monthlyOccurrenceOnOrAfter(
        sourceNext,
        dto.generationDay,
        startDate,
      );
      const template = {
        document: {
          metadata: recurrenceDocumentMetadata(metadata),
          notes: document.notes,
          terms: kind === 'invoice' ? (document as FinanceInvoice).terms : null,
        },
        lines: this.lineTemplate(lines),
        generateAsStatus: dto.generateAsStatus ?? 'issued',
        generationDay: dto.generationDay,
        dueDay,
        competenceMode: dto.competenceMode,
        contractId: contract?.id ?? null,
        contractTitle: contract?.title ?? null,
        contractServices: contract?.services ?? null,
      };
      let profileId: string;
      if (kind === 'invoice') {
        const repo = manager.getRepository(FinanceRecurringProfile);
        const existingId = metadata.recurringProfileId;
        const existing =
          typeof existingId === 'string'
            ? await repo.findOne({
                where: {
                  ...scope,
                  id: existingId,
                  sourceModule: 'finance_invoice',
                  sourceId: id,
                },
                lock: { mode: 'pessimistic_write' },
              })
            : null;
        const profile =
          existing ??
          repo.create({
            ...scope,
            sourceModule: 'finance_invoice',
            sourceId: id,
            startDate,
            nextInvoiceDate: nextDate,
            interval: FinanceRecurringInterval.Monthly,
          });
        const notBefore =
          dto.enabled &&
          existing?.status !== FinanceRecurringProfileStatus.Active
            ? startDate
            : (recurrenceNotBefore(existing?.createdAt, existing?.metadata) ??
              startDate);
        profile.nextInvoiceDate = monthlyOccurrenceOnOrAfter(
          existing?.nextInvoiceDate
            ? recurrenceDay(existing.nextInvoiceDate, dto.generationDay)
            : nextDate,
          dto.generationDay,
          notBefore,
        );
        Object.assign(profile, {
          customerId: (document as FinanceInvoice).customerId,
          name: recurrenceText(
            metadata.internalName ??
              document.notes ??
              `Fatura ${id.slice(0, 8)}`,
          ).slice(0, 160),
          amount: document.totalAmount,
          currency: document.currency,
          status: dto.enabled
            ? FinanceRecurringProfileStatus.Active
            : FinanceRecurringProfileStatus.Paused,
          autoGenerateInvoice: dto.enabled,
          metadata: {
            ...profile.metadata,
            ...template,
            generationNotBefore: notBefore,
            deletedAt: dto.enabled
              ? null
              : (profile.metadata?.deletedAt ?? null),
          },
        });
        profileId = (await repo.save(profile)).id;
      } else {
        const repo = manager.getRepository(FinanceBillRecurrence);
        const existingId = metadata.recurrenceId;
        const existing =
          typeof existingId === 'string'
            ? await repo.findOne({
                where: { ...scope, id: existingId, sourceBillId: id },
                lock: { mode: 'pessimistic_write' },
              })
            : null;
        const profile =
          existing ??
          repo.create({
            ...scope,
            sourceBillId: id,
            startDate,
            nextGenerationDate: nextDate,
            frequency: FinanceBillRecurrenceFrequency.Monthly,
            intervalCount: 1,
            occurrencesCreated: 0,
            generateAsStatus: 'draft',
            createdById: ctx.userId,
          });
        const notBefore =
          dto.enabled && existing?.status !== FinanceBillRecurrenceStatus.Active
            ? startDate
            : (recurrenceNotBefore(existing?.createdAt, existing?.metadata) ??
              startDate);
        profile.nextGenerationDate = monthlyOccurrenceOnOrAfter(
          existing?.nextGenerationDate
            ? recurrenceDay(existing.nextGenerationDate, dto.generationDay)
            : nextDate,
          dto.generationDay,
          notBefore,
        );
        Object.assign(profile, {
          vendorId: (document as FinanceBill).vendorId,
          name: recurrenceText(
            metadata.internalName ??
              document.notes ??
              `Conta ${id.slice(0, 8)}`,
          ).slice(0, 160),
          currency: document.currency,
          amount: document.totalAmount,
          categoryId: (document as FinanceBill).categoryId,
          costCenterId: (document as FinanceBill).costCenterId,
          lineTemplate: template.lines,
          generationDay: dto.generationDay,
          dueDay,
          active: dto.enabled,
          status: dto.enabled
            ? FinanceBillRecurrenceStatus.Active
            : FinanceBillRecurrenceStatus.Paused,
          metadata: {
            ...profile.metadata,
            ...template,
            generationNotBefore: notBefore,
            deletedAt: dto.enabled
              ? null
              : (profile.metadata?.deletedAt ?? null),
          },
          updatedById: ctx.userId,
        });
        profileId = (await repo.save(profile)).id;
      }
      document.metadata = {
        ...metadata,
        isRecurring: dto.enabled,
        recurringGenerateAsStatus: dto.generateAsStatus ?? 'issued',
        recurringIssueDayOfMonth: dto.generationDay,
        recurringDueDayOfMonth: dueDay,
        competenceMode: dto.competenceMode,
        contractId: contract?.id ?? null,
        contractTitle: contract?.title ?? null,
        ...(kind === 'invoice'
          ? { recurringProfileId: profileId }
          : { recurrenceId: profileId, recurrenceSource: true }),
      };
      if (kind === 'invoice')
        await manager
          .getRepository(FinanceInvoice)
          .save(document as FinanceInvoice);
      else
        await manager.getRepository(FinanceBill).save(document as FinanceBill);
      return { profileId, metadata: document.metadata };
    });
  }
  private lineTemplate(lines: Array<FinanceInvoiceLine | FinanceBillLine>) {
    return lines.map((line) => ({
      description: line.description,
      quantity: line.quantity,
      unitPrice: line.unitPrice,
      taxAmount: line.taxAmount,
      totalAmount: line.totalAmount,
      categoryId: line.categoryId,
      costCenterId: line.costCenterId,
      metadata: line.metadata,
      ...('discountAmount' in line
        ? {
            discountAmount: line.discountAmount,
            productId: line.productId,
            serviceId: line.serviceId,
          }
        : {}),
    }));
  }

  /** Source item edits update future documents without resuming paused schedules. */
  async refreshSourceTemplate(
    ctx: FinanceRequestContext,
    kind: 'invoice' | 'bill',
    id: string,
  ) {
    const scope = { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId };
    await this.dataSource.transaction(async (manager) => {
      const document =
        kind === 'invoice'
          ? await manager.getRepository(FinanceInvoice).findOne({
              where: { ...scope, id },
              lock: { mode: 'pessimistic_write' },
            })
          : await manager.getRepository(FinanceBill).findOne({
              where: { ...scope, id },
              lock: { mode: 'pessimistic_write' },
            });
      const metadata = document?.metadata ?? {};
      if (
        !document ||
        metadata.generatedFromRecurrenceId ||
        metadata.generatedFromRecurringProfileId
      )
        return;
      const profileId =
        kind === 'invoice'
          ? metadata.recurringProfileId
          : metadata.recurrenceId;
      if (typeof profileId !== 'string') return;
      const lines: Array<FinanceInvoiceLine | FinanceBillLine> =
        kind === 'invoice'
          ? await manager.getRepository(FinanceInvoiceLine).find({
              where: { ...scope, invoiceId: id },
              order: { createdAt: 'ASC' },
            })
          : await manager.getRepository(FinanceBillLine).find({
              where: { ...scope, billId: id },
              order: { createdAt: 'ASC' },
            });
      const template = {
        document: {
          metadata: recurrenceDocumentMetadata(metadata),
          notes: document.notes,
          terms: kind === 'invoice' ? (document as FinanceInvoice).terms : null,
        },
        lines: this.lineTemplate(lines),
      };
      if (kind === 'invoice') {
        const repo = manager.getRepository(FinanceRecurringProfile);
        const profile = await repo.findOne({
          where: {
            ...scope,
            id: profileId,
            sourceModule: 'finance_invoice',
            sourceId: id,
          },
          lock: { mode: 'pessimistic_write' },
        });
        if (!profile) return;
        profile.amount = document.totalAmount;
        profile.customerId = (document as FinanceInvoice).customerId;
        profile.currency = document.currency;
        profile.metadata = { ...profile.metadata, ...template };
        await repo.save(profile);
      } else {
        const repo = manager.getRepository(FinanceBillRecurrence);
        const profile = await repo.findOne({
          where: { ...scope, id: profileId, sourceBillId: id },
          lock: { mode: 'pessimistic_write' },
        });
        if (!profile) return;
        profile.amount = document.totalAmount;
        profile.vendorId = (document as FinanceBill).vendorId;
        profile.currency = document.currency;
        profile.lineTemplate = template.lines;
        profile.metadata = { ...profile.metadata, ...template };
        await repo.save(profile);
      }
    });
  }
}
