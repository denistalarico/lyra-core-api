import { NotFoundException } from '@nestjs/common';
import { LeadFlowBriefingSuggestionService } from './leadflow-briefing-suggestion.service';
import {
  LeadFlowBriefingSourceEntity,
  LeadFlowBriefingSourceVersionEntity,
  LeadFlowBriefingSuggestionEntity,
} from '../entities';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBriefingSourceKind } from '../enums/leadflow-briefing-source-kind.enum';
import { LeadFlowBriefingSuggestionStatus } from '../enums/leadflow-briefing-suggestion-status.enum';

const ctx = { tenantId: 'tenant-1', workspaceId: 'workspace-1', userId: 'user-1' };

function suggestion(overrides: Record<string, unknown> = {}) {
  return {
    id: 'sug-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    settingsId: 'settings-1',
    extractionJobId: 'job-1',
    sourceVersionId: 'version-1',
    fieldPath: 'identity.publicName',
    suggestedValue: 'Acme',
    confidence: '0.800',
    rationale: 'r',
    status: LeadFlowBriefingSuggestionStatus.Pending,
    supersededBySuggestionId: null,
    conflictsWithSuggestionId: null,
    decidedById: null,
    decidedAt: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    ...overrides,
  };
}

function version(overrides: Record<string, unknown> = {}) {
  return {
    id: 'version-1',
    sourceId: 'source-1',
    versionNumber: 1,
    kind: LeadFlowBriefingSourceKind.Upload,
    ...overrides,
  };
}

function source(overrides: Record<string, unknown> = {}) {
  return {
    id: 'source-1',
    label: 'Site institucional',
    kind: LeadFlowBriefingSourceKind.Upload,
    ...overrides,
  };
}

function setup(options: {
  settings?: Record<string, unknown> | null;
  suggestions?: ReturnType<typeof suggestion>[];
  versions?: ReturnType<typeof version>[];
  sources?: ReturnType<typeof source>[];
}) {
  const settings =
    'settings' in options
      ? options.settings
      : { id: 'settings-1', tenantId: 'tenant-1', workspaceId: 'workspace-1', companyContextDraft: {} };
  const suggestions = options.suggestions ?? [];
  const versions = options.versions ?? [version()];
  const sources = options.sources ?? [source()];

  const suggestionRepo = { find: jest.fn().mockResolvedValue(suggestions) };
  const versionRepo = { find: jest.fn().mockResolvedValue(versions) };
  const sourceRepo = { find: jest.fn().mockResolvedValue(sources) };
  const settingsRepo = { findOne: jest.fn().mockResolvedValue(settings) };

  const dataSource = {
    getRepository: jest.fn((entity: unknown) => {
      if (entity === LeadFlowBriefingSuggestionEntity) return suggestionRepo;
      if (entity === LeadFlowBriefingSourceVersionEntity) return versionRepo;
      if (entity === LeadFlowBriefingSourceEntity) return sourceRepo;
      if (entity === LeadFlowClientSettingsEntity) return settingsRepo;
      throw new Error('Unexpected repository requested in test.');
    }),
  };

  const companyContextService = {} as never;
  const service = new LeadFlowBriefingSuggestionService(dataSource as never, companyContextService);
  return { service, suggestionRepo, versionRepo, sourceRepo, settingsRepo };
}

describe('LeadFlowBriefingSuggestionService.listForReview', () => {
  it('404s when the settings target does not exist for this tenant', async () => {
    const { service } = setup({ settings: null });
    await expect(service.listForReview(ctx, 'settings-1')).rejects.toThrow(NotFoundException);
  });

  it('joins each suggestion to its source and carries the current draft value for conflict comparison', async () => {
    const { service } = setup({
      settings: {
        id: 'settings-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        companyContextDraft: { identity: { publicName: 'Old Name' } },
      },
      suggestions: [suggestion({ conflictsWithSuggestionId: 'sug-applied' })],
    });

    const result = await service.listForReview(ctx, 'settings-1');

    expect(result.suggestions).toHaveLength(1);
    expect(result.suggestions[0]).toMatchObject({
      fieldPath: 'identity.publicName',
      currentValue: 'Old Name',
      conflictsWithSuggestionId: 'sug-applied',
      confidence: 0.8,
      origin: {
        sourceId: 'source-1',
        sourceLabel: 'Site institucional',
        sourceVersionId: 'version-1',
        versionNumber: 1,
      },
    });
  });

  it('gap: a scalar field with no draft value and no pending suggestion appears in gaps', async () => {
    const { service } = setup({ suggestions: [] });
    const result = await service.listForReview(ctx, 'settings-1');
    expect(result.gaps).toContain('identity.publicName');
  });

  it('gap: a field with a pending suggestion is excluded from gaps (it is "awaiting decision", not a gap)', async () => {
    const { service } = setup({
      suggestions: [suggestion({ fieldPath: 'identity.publicName', status: LeadFlowBriefingSuggestionStatus.Pending })],
    });
    const result = await service.listForReview(ctx, 'settings-1');
    expect(result.gaps).not.toContain('identity.publicName');
  });

  it('gap: a field with a non-empty draft value is never a gap', async () => {
    const { service } = setup({
      settings: {
        id: 'settings-1',
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        companyContextDraft: { identity: { publicName: 'Acme' } },
      },
      suggestions: [],
    });
    const result = await service.listForReview(ctx, 'settings-1');
    expect(result.gaps).not.toContain('identity.publicName');
  });

  it('excludes superseded suggestions from the review list entirely', async () => {
    const { service, suggestionRepo } = setup({
      suggestions: [suggestion({ status: LeadFlowBriefingSuggestionStatus.Superseded })],
    });
    await service.listForReview(ctx, 'settings-1');
    const where = suggestionRepo.find.mock.calls[0][0].where;
    expect(where.status.value ?? where.status).not.toContain(
      LeadFlowBriefingSuggestionStatus.Superseded,
    );
  });
});

describe('LeadFlowBriefingSuggestionService.applySuggestion', () => {
  it('records decidedById/decidedAt on the suggestion row (uniform with rejectSuggestion)', async () => {
    const settings = {
      id: 'settings-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      companyContextDraft: {},
    };
    const pending = suggestion();
    const suggestionRepo = {
      findOne: jest.fn().mockResolvedValue(pending),
      save: jest.fn().mockImplementation((row) => Promise.resolve(row)),
    };
    const settingsRepo = {
      findOne: jest.fn().mockResolvedValue(settings),
      save: jest.fn().mockResolvedValue(settings),
    };
    const snapshotRepo = {
      create: jest.fn((row) => row),
      save: jest.fn().mockResolvedValue({ id: 'snapshot-1' }),
    };
    const applicationRepo = {
      create: jest.fn((row) => row),
      save: jest.fn().mockImplementation((row) => Promise.resolve({ id: 'app-1', ...row })),
    };
    const manager = {
      getRepository: jest.fn((entity: { name: string }) => {
        if (entity === LeadFlowBriefingSuggestionEntity) return suggestionRepo;
        if (entity === LeadFlowClientSettingsEntity) return settingsRepo;
        if (entity.name === 'LeadFlowBriefingContextSnapshotEntity') return snapshotRepo;
        return applicationRepo;
      }),
    };
    const dataSource = {
      transaction: jest.fn(async (run: (m: typeof manager) => Promise<unknown>) => run(manager)),
    };
    const companyContextService = {
      normalizePersisted: jest.fn((v) => v),
      hash: jest.fn(() => 'hash'),
    } as never;

    const service = new LeadFlowBriefingSuggestionService(dataSource as never, companyContextService);
    await service.applySuggestion(ctx, { suggestionId: 'sug-1', appliedById: 'user-1' });

    expect(suggestionRepo.save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: LeadFlowBriefingSuggestionStatus.Applied,
        decidedById: 'user-1',
        decidedAt: expect.any(Date),
      }),
    );
  });
});
