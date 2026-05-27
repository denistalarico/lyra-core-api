import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { CreateFinanceJournalEntryDto } from '../dto';
import { FinanceJournalEntry, FinanceJournalEntryLine } from '../entities';
import {
  FinanceDocumentType,
  FinanceJournalEntryLineType,
  FinanceJournalEntryStatus,
} from '../enums';
import { FinanceRequestContext } from './finance-context';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';

function toMoney(value: string | number | null | undefined): number {
  if (value === null || value === undefined || value === '') return 0;

  const parsed = Number(value);

  if (Number.isNaN(parsed)) return 0;

  return Math.round(parsed * 100) / 100;
}

function money(value: number): string {
  return (Math.round(value * 100) / 100).toFixed(2);
}

function validateId(value: string | null | undefined, name = 'id') {
  if (!value || value === 'null' || value === 'undefined') {
    throw new BadRequestException(`Invalid ${name}`);
  }
}

@Injectable()
export class FinanceJournalEntryService {
  constructor(
    @InjectRepository(FinanceJournalEntry, 'agency')
    private readonly entriesRepo: Repository<FinanceJournalEntry>,

    @InjectRepository(FinanceJournalEntryLine, 'agency')
    private readonly linesRepo: Repository<FinanceJournalEntryLine>,

    @InjectDataSource('agency')
    private readonly dataSource: DataSource,

    private readonly documentNumberingService: FinanceDocumentNumberingService,
  ) {}

  list(ctx: FinanceRequestContext) {
    return this.entriesRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        entryDate: 'DESC',
        createdAt: 'DESC',
      },
    });
  }

  async create(ctx: FinanceRequestContext, dto: CreateFinanceJournalEntryDto) {
    const totals = this.calculateTotals(dto.lines);

    if (totals.totalDebit <= 0 && totals.totalCredit <= 0) {
      throw new BadRequestException(
        'Journal entry total must be greater than zero',
      );
    }

    if (totals.totalDebit !== totals.totalCredit) {
      throw new BadRequestException('Journal entry must be balanced');
    }

    const entryNumber = await this.documentNumberingService.generate(
      ctx,
      FinanceDocumentType.JournalEntry,
      new Date(`${dto.entryDate}T00:00:00.000Z`),
    );

    return this.dataSource.transaction(async (manager) => {
      const entry = await manager.getRepository(FinanceJournalEntry).save(
        manager.getRepository(FinanceJournalEntry).create({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          entryNumber,
          status: FinanceJournalEntryStatus.Draft,
          entryDate: dto.entryDate,
          description: dto.description ?? null,
          journalId: dto.journalId ?? null,
          sourceModule: dto.sourceModule ?? null,
          sourceId: dto.sourceId ?? null,
          totalDebit: money(totals.totalDebit),
          totalCredit: money(totals.totalCredit),
          metadata: dto.metadata ?? {},
        }),
      );

      await manager.getRepository(FinanceJournalEntryLine).save(
        dto.lines.map((line) =>
          manager.getRepository(FinanceJournalEntryLine).create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            journalEntryId: entry.id,
            lineType: line.lineType,
            accountId: line.accountId ?? null,
            categoryId: line.categoryId ?? null,
            costCenterId: line.costCenterId ?? null,
            contactId: line.contactId ?? null,
            description: line.description ?? null,
            amount: money(toMoney(line.amount)),
            metadata: line.metadata ?? {},
          }),
        ),
      );

      return this.get(ctx, entry.id);
    });
  }

  async get(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'journal entry id');

    const entry = await this.entriesRepo.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!entry) {
      throw new NotFoundException('Finance journal entry not found');
    }

    const lines = await this.linesRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        journalEntryId: entry.id,
      },
      order: {
        createdAt: 'ASC',
      },
    });

    return {
      ...entry,
      lines,
    };
  }

  async post(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'journal entry id');

    const entry = await this.entriesRepo.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!entry) {
      throw new NotFoundException('Finance journal entry not found');
    }

    if (entry.status !== FinanceJournalEntryStatus.Draft) {
      throw new BadRequestException('Only draft journal entries can be posted');
    }

    entry.status = FinanceJournalEntryStatus.Posted;
    entry.postedAt = new Date();
    entry.postedById = ctx.userId;

    await this.entriesRepo.save(entry);

    return this.get(ctx, entry.id);
  }

  async cancel(ctx: FinanceRequestContext, id: string) {
    validateId(id, 'journal entry id');

    const entry = await this.entriesRepo.findOne({
      where: {
        id,
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (!entry) {
      throw new NotFoundException('Finance journal entry not found');
    }

    if (entry.status === FinanceJournalEntryStatus.Cancelled) {
      return this.get(ctx, entry.id);
    }

    entry.status = FinanceJournalEntryStatus.Cancelled;
    entry.cancelledAt = new Date();
    entry.cancelledById = ctx.userId;

    await this.entriesRepo.save(entry);

    return this.get(ctx, entry.id);
  }

  private calculateTotals(lines: CreateFinanceJournalEntryDto['lines']) {
    return lines.reduce(
      (totals, line) => {
        const amount = toMoney(line.amount);

        if (line.lineType === FinanceJournalEntryLineType.Debit) {
          totals.totalDebit += amount;
        }

        if (line.lineType === FinanceJournalEntryLineType.Credit) {
          totals.totalCredit += amount;
        }

        return totals;
      },
      {
        totalDebit: 0,
        totalCredit: 0,
      },
    );
  }
}
