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
        sequence = await manager.getRepository(FinanceDocumentSequence).save(
          manager.getRepository(FinanceDocumentSequence).create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            documentType,
            periodYear,
            prefix,
            nextNumber: 1,
            padding: 6,
          }),
        );
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
    const sequence = await this.sequencesRepo.findOne({
      where: { id, tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
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
    return this.sequencesRepo.save(sequence);
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
        seq = await this.sequencesRepo.save(
          this.sequencesRepo.create({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            documentType: docType as FinanceDocumentType,
            periodYear: year,
            prefix,
            nextNumber: 1,
            padding: 6,
          }),
        );
      }
      results.push(seq);
    }
    return results;
  }
}
