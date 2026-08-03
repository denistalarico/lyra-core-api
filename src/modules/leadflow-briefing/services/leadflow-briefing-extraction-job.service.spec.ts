import { LeadFlowBriefingExtractionJobService } from './leadflow-briefing-extraction-job.service';
import { LeadFlowBriefingJobStatus } from '../enums/leadflow-briefing-job-status.enum';

const ctx = { tenantId: 'tenant-1', workspaceId: 'workspace-1', userId: 'user-1' };

describe('LeadFlowBriefingExtractionJobService.listForSettings', () => {
  it('maps lastError and createdAt through so a failed job is explainable in the UI without leaking the raw exception', async () => {
    const job = {
      id: 'job-1',
      sourceId: 'source-1',
      sourceVersionId: 'version-1',
      status: LeadFlowBriefingJobStatus.Failed,
      attempts: 2,
      idempotencyKey: 'k',
      lastError: 'extraction_provider_timeout',
      createdAt: new Date('2026-01-01'),
    };
    const repo = { find: jest.fn().mockResolvedValue([job]) };
    const dataSource = { getRepository: jest.fn(() => repo) };
    const service = new LeadFlowBriefingExtractionJobService(dataSource as never, {} as never);

    const result = await service.listForSettings(ctx, 'settings-1');

    expect(result).toEqual([
      {
        id: 'job-1',
        sourceId: 'source-1',
        sourceVersionId: 'version-1',
        status: LeadFlowBriefingJobStatus.Failed,
        attempts: 2,
        idempotencyKey: 'k',
        lastError: 'extraction_provider_timeout',
        createdAt: job.createdAt,
      },
    ]);
  });
});
