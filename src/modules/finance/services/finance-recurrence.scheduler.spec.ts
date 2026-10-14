import { Logger } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { FinanceBillRecurrence, FinanceSetting } from '../entities';
import { FinanceBillingService } from './finance-billing.service';
import { FinanceRecurrenceScheduler } from './finance-recurrence.scheduler';

function setup() {
  const scopeA = { tenantId: 'tenant-a', workspaceId: 'workspace-a' };
  const scopeB = { tenantId: 'tenant-b', workspaceId: 'workspace-b' };
  const scopes = { find: jest.fn().mockResolvedValue([scopeA, scopeB]) };
  const settings = {
    findOne: jest
      .fn()
      .mockImplementation(({ where }: { where: { tenantId: string } }) =>
        Promise.resolve({
          autoGenerateRecurringInvoices: where.tenantId === scopeA.tenantId,
        }),
      ),
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) =>
      entity === FinanceSetting ? settings : scopes,
    ),
  };
  const billing = {
    generateDueBillRecurrences: jest.fn().mockResolvedValue({ skipped: [] }),
    generateDueRecurringInvoices: jest.fn().mockResolvedValue({ skipped: [] }),
  };
  const service = new FinanceRecurrenceScheduler(
    dataSource as unknown as DataSource,
    billing as unknown as FinanceBillingService,
  );
  return { service, billing, dataSource, scopeA, scopeB };
}
describe('Finance recurrence scheduler', () => {
  afterEach(() => jest.restoreAllMocks());
  it('deduplicates scoped work and respects the workspace automation switch', async () => {
    const { service, billing, dataSource, scopeA, scopeB } = setup();
    await service.generateDue();
    expect(billing.generateDueBillRecurrences.mock.calls).toEqual([
      [{ ...scopeA, userId: null }],
      [{ ...scopeB, userId: null }],
    ]);
    expect(billing.generateDueRecurringInvoices.mock.calls).toEqual([
      [{ ...scopeA, userId: null }],
    ]);
    expect(dataSource.getRepository).toHaveBeenCalledWith(
      FinanceBillRecurrence,
    );
  });
  it('continues the next scope after failure and logs returned generation errors', async () => {
    const { service, billing } = setup();
    const error = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => {});
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => {});
    billing.generateDueBillRecurrences.mockRejectedValueOnce(
      new Error('scope unavailable'),
    );
    billing.generateDueRecurringInvoices.mockResolvedValueOnce({
      skipped: [{ reason: 'invalid template' }],
    });
    await service.generateDue();
    expect(billing.generateDueBillRecurrences).toHaveBeenCalledTimes(2);
    expect(error).toHaveBeenCalledTimes(1);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('invalid template'),
    );
  });
});
