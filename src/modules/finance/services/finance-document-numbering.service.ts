import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { EntityManager, Repository } from 'typeorm';
import {
  FinanceBill,
  FinanceDocumentSequence,
  FinanceInvoice,
} from '../entities';
import { FinanceDocumentType } from '../enums';
import { FinanceRequestContext } from './finance-context';

const DEFAULT_PREFIX_BY_DOCUMENT_TYPE: Record<FinanceDocumentType, string> = {
  [FinanceDocumentType.Invoice]: 'INV',
  [FinanceDocumentType.Bill]: 'BILL',
  [FinanceDocumentType.Payment]: 'PAY',
  [FinanceDocumentType.Receipt]: 'REC',
  [FinanceDocumentType.JournalEntry]: 'JE',
  [FinanceDocumentType.FiscalDocument]: 'DOC',
};

@Injectable()
export class FinanceDocumentNumberingService {
  constructor(
    @InjectRepository(FinanceDocumentSequence, 'agency')
    private readonly sequencesRepo: Repository<FinanceDocumentSequence>,
  ) {}

  async generate(
    ctx: FinanceRequestContext,
    documentType: FinanceDocumentType,
    date = new Date(),
  ) {
    const periodYear = date.getUTCFullYear();
    const prefix = DEFAULT_PREFIX_BY_DOCUMENT_TYPE[documentType];

    return this.sequencesRepo.manager.transaction(async (manager) => {
      let sequence = await manager
        .getRepository(FinanceDocumentSequence)
        .createQueryBuilder('sequence')
        .setLock('pessimistic_write')
        .where('sequence.tenant_id = :tenantId', { tenantId: ctx.tenantId })
        .andWhere('sequence.workspace_id = :workspaceId', {
          workspaceId: ctx.workspaceId,
        })
        .andWhere('sequence.document_type = :documentType', { documentType })
        .andWhere('sequence.period_year = :periodYear', { periodYear })
        .getOne();

      if (!sequence) {
        const repo = manager.getRepository(FinanceDocumentSequence);
        const scope = {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          documentType,
          periodYear,
        };
        await repo.createQueryBuilder().insert().values({ ...scope, prefix })
          .orIgnore().execute();
        sequence = await repo.findOneOrFail({
          where: scope,
          lock: { mode: 'pessimistic_write' },
        });
      }

      let generatedNumber: string;
      do {
        generatedNumber = `${sequence.prefix}-${sequence.periodYear}-${String(
          sequence.nextNumber,
        ).padStart(sequence.padding, '0')}`;
        sequence.nextNumber += 1;
      } while (
        await this.documentNumberExists(
          manager,
          ctx,
          documentType,
          generatedNumber,
        )
      );

      sequence.lastGeneratedNumber = generatedNumber;

      await manager.getRepository(FinanceDocumentSequence).save(sequence);

      return generatedNumber;
    });
  }

  private documentNumberExists(
    manager: EntityManager,
    ctx: FinanceRequestContext,
    documentType: FinanceDocumentType,
    documentNumber: string,
  ) {
    if (documentType === FinanceDocumentType.Bill) {
      return manager.getRepository(FinanceBill).exists({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          billNumber: documentNumber,
        },
      });
    }
    if (documentType === FinanceDocumentType.Invoice) {
      return manager.getRepository(FinanceInvoice).exists({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          invoiceNumber: documentNumber,
        },
      });
    }
    return Promise.resolve(false);
  }

  listSequences(ctx: FinanceRequestContext) {
    return this.sequencesRepo.find({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
      order: {
        documentType: 'ASC',
        periodYear: 'DESC',
      },
    });
  }

  async updateSequence(
    ctx: FinanceRequestContext,
    id: string,
    dto: { prefix?: string; padding?: number; nextNumber?: number },
  ) {
    return this.sequencesRepo.manager.transaction(async (manager) => {
      const repo = manager.getRepository(FinanceDocumentSequence);
      const sequence = await repo.findOne({
        where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        lock: { mode: 'pessimistic_write' },
      });
      if (!sequence) {
        throw new Error('Sequence not found');
      }
      if (dto.prefix !== undefined)
        sequence.prefix = dto.prefix.trim() || sequence.prefix;
      if (dto.padding !== undefined && dto.padding > 0)
        sequence.padding = dto.padding;
      if (dto.nextNumber !== undefined && dto.nextNumber > 0)
        sequence.nextNumber = dto.nextNumber;
      return repo.save(sequence);
    });
  }

  async upsertDefaults(ctx: FinanceRequestContext) {
    const year = new Date().getUTCFullYear();
    const results: FinanceDocumentSequence[] = [];
    for (const [docType, prefix] of Object.entries(
      DEFAULT_PREFIX_BY_DOCUMENT_TYPE,
    )) {
      let seq = await this.sequencesRepo.findOne({
        where: {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          documentType: docType as FinanceDocumentType,
          periodYear: year,
        },
      });
      if (!seq) {
        const scope = {
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          documentType: docType as FinanceDocumentType,
          periodYear: year,
        };
        await this.sequencesRepo.createQueryBuilder().insert()
          .values({ ...scope, prefix }).orIgnore().execute();
        seq = await this.sequencesRepo.findOneByOrFail(scope);
      }
      results.push(seq);
    }
    return results;
  }
}
