import { Repository } from 'typeorm';
import { FinanceBill, FinanceDocumentSequence } from '../entities';
import { FinanceDocumentType } from '../enums';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';

describe('FinanceDocumentNumberingService', () => {
  it('skips a stale sequence number that is already used by a bill', async () => {
    const sequence = {
      id: 'sequence-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      documentType: FinanceDocumentType.Bill,
      periodYear: 2026,
      prefix: 'BILL',
      nextNumber: 1,
      padding: 6,
      lastGeneratedNumber: null,
    } as FinanceDocumentSequence;
    const sequenceQuery = {
      setLock: jest.fn().mockReturnThis(),
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getOne: jest.fn().mockResolvedValue(sequence),
    };
    const sequenceRepository = {
      createQueryBuilder: jest.fn(() => sequenceQuery),
      save: jest.fn(async (value: FinanceDocumentSequence) => value),
    };
    const billRepository = {
      exists: jest
        .fn()
        .mockResolvedValueOnce(true)
        .mockResolvedValueOnce(false),
    };
    const manager = {
      getRepository: jest.fn((entity) =>
        entity === FinanceBill ? billRepository : sequenceRepository,
      ),
    };
    const sequencesRepo = {
      manager: {
        transaction: jest.fn(
          async (callback: (value: typeof manager) => Promise<unknown>) =>
            callback(manager),
        ),
      },
    } as unknown as Repository<FinanceDocumentSequence>;
    const service = new FinanceDocumentNumberingService(sequencesRepo);

    const result = await service.generate(
      { tenantId: 'tenant-1', workspaceId: 'workspace-1', userId: 'user-1' },
      FinanceDocumentType.Bill,
      new Date('2026-07-31T12:00:00.000Z'),
    );

    expect(result).toBe('BILL-2026-000002');
    expect(billRepository.exists).toHaveBeenCalledTimes(2);
    expect(sequence.nextNumber).toBe(3);
    expect(sequence.lastGeneratedNumber).toBe('BILL-2026-000002');
  });
});
