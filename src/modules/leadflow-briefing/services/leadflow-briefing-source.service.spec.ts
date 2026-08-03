import { ConflictException, NotFoundException } from '@nestjs/common';
import { LeadFlowBriefingSourceService } from './leadflow-briefing-source.service';
import { LeadFlowBriefingSourceEntity, LeadFlowBriefingSourceVersionEntity } from '../entities';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSourceVersionStatus } from '../enums/leadflow-briefing-source-version-status.enum';

const ctx = { tenantId: 'tenant-1', workspaceId: 'workspace-1', userId: 'user-1' };

function setup(options: {
  sources?: Record<string, unknown>[];
  versions?: Record<string, unknown>[];
  sourceFindOne?: Record<string, unknown> | null;
  versionFindOne?: Record<string, unknown> | null;
}) {
  const sourceRepo = {
    find: jest.fn().mockResolvedValue(options.sources ?? []),
    findOne: jest.fn().mockResolvedValue(
      'sourceFindOne' in options ? options.sourceFindOne : { id: 'source-1', settingsId: 'settings-1' },
    ),
  };
  const versionRepo = {
    find: jest.fn().mockResolvedValue(options.versions ?? []),
    findOne: jest.fn().mockResolvedValue(
      'versionFindOne' in options
        ? options.versionFindOne
        : { id: 'version-1', status: LeadFlowBriefingSourceVersionStatus.Available },
    ),
  };
  const dataSource = {
    getRepository: jest.fn((entity: unknown) =>
      entity === LeadFlowBriefingSourceEntity ? sourceRepo : versionRepo,
    ),
  };
  const service = new LeadFlowBriefingSourceService(dataSource as never);
  return { service, sourceRepo, versionRepo };
}

describe('LeadFlowBriefingSourceService.listSources', () => {
  it('returns each source with its latest version only, not every version', async () => {
    const { service } = setup({
      sources: [{ id: 'source-1', kind: LeadFlowBriefingSourceKind.Upload, label: 'Site', status: 'active', createdAt: new Date() }],
      versions: [
        { id: 'v1', sourceId: 'source-1', versionNumber: 1, status: 'available', errorCode: null, createdAt: new Date('2026-01-01') },
        { id: 'v2', sourceId: 'source-1', versionNumber: 2, status: 'pending', errorCode: null, createdAt: new Date('2026-01-02') },
      ],
    });

    const result = await service.listSources(ctx, 'settings-1');

    expect(result).toHaveLength(1);
    expect(result[0].latestVersion?.id).toBe('v2');
    expect(result[0].latestVersion?.versionNumber).toBe(2);
  });

  it('returns an empty list without querying versions when there are no sources', async () => {
    const { service, versionRepo } = setup({ sources: [] });
    const result = await service.listSources(ctx, 'settings-1');
    expect(result).toEqual([]);
    expect(versionRepo.find).not.toHaveBeenCalled();
  });
});

describe('LeadFlowBriefingSourceService.getSource', () => {
  it('404s when the source does not exist for this tenant', async () => {
    const { service } = setup({ sourceFindOne: null });
    await expect(service.getSource(ctx, 'source-1')).rejects.toThrow(NotFoundException);
  });
});

describe('LeadFlowBriefingSourceService.getAvailableVersionForExtraction', () => {
  it('404s when the version does not belong to the given source/tenant', async () => {
    const { service } = setup({ versionFindOne: null });
    await expect(
      service.getAvailableVersionForExtraction(ctx, 'source-1', 'version-1'),
    ).rejects.toThrow(NotFoundException);
  });

  it('rejects extraction on a version that is not yet Available', async () => {
    const { service } = setup({
      versionFindOne: { id: 'version-1', status: LeadFlowBriefingSourceVersionStatus.Pending },
    });
    await expect(
      service.getAvailableVersionForExtraction(ctx, 'source-1', 'version-1'),
    ).rejects.toThrow(ConflictException);
  });

  it('resolves settingsId from the source for an available version', async () => {
    const { service } = setup({});
    const result = await service.getAvailableVersionForExtraction(ctx, 'source-1', 'version-1');
    expect(result).toEqual({ settingsId: 'settings-1', sourceId: 'source-1', versionId: 'version-1' });
  });
});
