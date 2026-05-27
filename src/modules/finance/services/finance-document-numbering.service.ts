import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { FinanceDocumentSequence } from '../entities';
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

      const generatedNumber = `${sequence.prefix}-${sequence.periodYear}-${String(
        sequence.nextNumber,
      ).padStart(sequence.padding, '0')}`;

      sequence.lastGeneratedNumber = generatedNumber;
      sequence.nextNumber += 1;

      await manager.getRepository(FinanceDocumentSequence).save(sequence);

      return generatedNumber;
    });
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
}
