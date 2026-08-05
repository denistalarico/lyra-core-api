import { ServiceUnavailableException } from '@nestjs/common';
import { LeadFlowBriefingIngestionService } from './leadflow-briefing-ingestion.service';

describe('LeadFlowBriefingIngestionService scanner availability', () => {
  it('fails closed with 503 and never persists when the scanner is unavailable', async () => {
    const sourceService = { createSourceVersion: jest.fn() };
    const service = new LeadFlowBriefingIngestionService(
      { get: jest.fn().mockReturnValue(undefined) } as never,
      { uploadPrivateBuffer: jest.fn() } as never,
      sourceService as never,
      { assertWithinQuota: jest.fn().mockResolvedValue(undefined) } as never,
      { fetchUrl: jest.fn() } as never,
      { scan: jest.fn().mockRejectedValue(new Error('scanner_unreachable')) },
      {
        findOne: jest.fn().mockResolvedValue({ settingsId: 'settings-1' }),
      } as never,
    );

    const ingestion = service.ingestPaste(
      {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        userId: 'user-1',
      },
      'source-1',
      'Conteúdo limpo para o briefing.',
    );

    await expect(ingestion).rejects.toBeInstanceOf(ServiceUnavailableException);
    await expect(ingestion).rejects.toMatchObject({ status: 503 });
    expect(sourceService.createSourceVersion).not.toHaveBeenCalled();
  });
});
