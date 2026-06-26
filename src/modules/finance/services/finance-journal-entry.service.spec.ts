import { DataSource, Repository } from 'typeorm';
import { FinanceJournalEntry, FinanceJournalEntryLine } from '../entities';
import { FinanceJournalEntryStatus } from '../enums';
import { FinanceDocumentNumberingService } from './finance-document-numbering.service';
import { FinanceJournalEntryService } from './finance-journal-entry.service';
import { FinanceNotificationPublisher } from './finance-notification.publisher';

describe('FinanceJournalEntryService notification triggers', () => {
  it('does not auto-fire finance.entry_approved when posting a journal entry', async () => {
    const entry = makeEntry({
      status: FinanceJournalEntryStatus.Draft,
      metadata: { requesterUserId: 'user-requester' },
    });
    const { service, publisher } = makeService({ entry });

    await service.post(makeContext(), entry.id);

    expect(publisher.publishEntryApproved).not.toHaveBeenCalled();
  });
});

function makeService(options: { entry?: FinanceJournalEntry } = {}) {
  const entry = options.entry ?? makeEntry();

  const entriesRepo = {
    findOne: jest.fn().mockResolvedValue(entry),
    save: jest.fn(async (item: FinanceJournalEntry) => item),
  };
  const linesRepo = {
    find: jest.fn().mockResolvedValue([]),
  };
  const dataSource = {};
  const publisher = {
    publishEntryApproved: jest.fn(),
  } as unknown as jest.Mocked<FinanceNotificationPublisher>;

  const service = new FinanceJournalEntryService(
    entriesRepo as unknown as Repository<FinanceJournalEntry>,
    linesRepo as unknown as Repository<FinanceJournalEntryLine>,
    dataSource as unknown as DataSource,
    {} as FinanceDocumentNumberingService,
    publisher,
  );

  return { service, publisher };
}

function makeContext() {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-actor',
  };
}

function makeEntry(overrides: Partial<FinanceJournalEntry> = {}): FinanceJournalEntry {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'entry-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    entryNumber: 'JE-00001',
    status: FinanceJournalEntryStatus.Draft,
    entryDate: '2026-06-12',
    description: null,
    journalId: null,
    sourceModule: null,
    sourceId: null,
    sourceLineId: null,
    eventType: null,
    idempotencyKey: null,
    reversesEntryId: null,
    totalDebit: '100.00',
    totalCredit: '100.00',
    postedAt: null,
    postedById: null,
    cancelledAt: null,
    cancelledById: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
