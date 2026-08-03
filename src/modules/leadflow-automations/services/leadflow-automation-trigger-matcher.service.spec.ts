import type { Repository } from 'typeorm';
import {
  LeadFlowAutomationEntity,
  LeadFlowAutomationVersionEntity,
} from '../entities';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import { LeadFlowAutomationVersionStatus } from '../enums/leadflow-automation-version-status.enum';
import type { LeadFlowAutomationRuntimeContract } from '../types/leadflow-automation.types';
import { LeadFlowAutomationTriggerMatcherService } from './leadflow-automation-trigger-matcher.service';

const tenantId = '10000000-0000-4000-8000-000000000001';
const workspaceId = '20000000-0000-4000-8000-000000000002';
const automationId = '30000000-0000-4000-8000-000000000003';
const versionId = '40000000-0000-4000-8000-000000000004';

function source(
  overrides: Partial<LeadFlowAutomationEntity> = {},
): LeadFlowAutomationEntity {
  return {
    id: automationId,
    tenantId,
    workspaceId,
    publishedVersionId: versionId,
    status: LeadFlowAutomationStatus.Active,
    recipeKey: 'lead_distribution',
    name: 'Mutable draft name',
    triggerConfig: { type: 'manual' },
    conditionConfig: {},
    actionConfig: {},
    messageConfig: {},
    crmPolicy: {},
    schedulePolicy: {},
    developerConfig: {},
    readiness: {},
    createdAt: new Date('2026-07-22T12:00:00Z'),
    ...overrides,
  } as LeadFlowAutomationEntity;
}

function snapshot(
  overrides: Partial<LeadFlowAutomationRuntimeContract> = {},
): LeadFlowAutomationRuntimeContract {
  return {
    version: 1,
    generatedAt: '2026-07-22T12:00:00.000Z',
    tenantId,
    workspaceId,
    automationId,
    recipeKey: 'lead_distribution',
    name: 'Immutable published name',
    category: 'crm',
    status: LeadFlowAutomationStatus.Active,
    businessMode: { key: 'agency_services', isCustom: false },
    leadflowSettingsSnapshot: {
      settingsId: null,
      contextType: 'agency',
      status: 'active',
      planKey: null,
      developerModeEnabled: false,
    },
    globalDefaults: {
      version: 0,
      source: 'fallback',
      createdAt: null,
      config: {
        schemaVersion: 1,
        timezone: 'UTC',
        businessHours: { enabled: false, windows: {} },
        crm: { pipelineRef: null, stageRef: null },
        channels: { defaultChannel: null },
        consent: { requireExplicitConsent: false },
        followUp: { defaultDelayHours: null, maxAttempts: null },
      },
    },
    inheritedFields: [],
    trigger: { type: 'opportunity.created' },
    conditions: {},
    actions: { primary: 'assign_owner' },
    message: {},
    crmPolicy: {},
    schedulePolicy: {},
    developerConfig: {},
    webhook: null,
    safetyRules: [],
    readiness: {},
    publishedVersionId: versionId,
    ...overrides,
  };
}

function version(
  overrides: Partial<LeadFlowAutomationVersionEntity> = {},
): LeadFlowAutomationVersionEntity {
  return {
    id: versionId,
    tenantId,
    automationId,
    version: 1,
    status: LeadFlowAutomationVersionStatus.Published,
    snapshot: snapshot(),
    ...overrides,
  } as LeadFlowAutomationVersionEntity;
}

function build(
  automations: LeadFlowAutomationEntity[],
  versions: LeadFlowAutomationVersionEntity[],
) {
  const automationsRepository = {
    find: jest.fn().mockResolvedValue(automations),
  } as unknown as Repository<LeadFlowAutomationEntity>;
  const versionsRepository = {
    find: jest.fn().mockResolvedValue(versions),
  } as unknown as Repository<LeadFlowAutomationVersionEntity>;
  return {
    service: new LeadFlowAutomationTriggerMatcherService(
      automationsRepository,
      versionsRepository,
    ),
    automationsRepository,
    versionsRepository,
  };
}

describe('LeadFlowAutomationTriggerMatcherService', () => {
  it('uses the immutable published snapshot, while preserving current pause state', async () => {
    const current = source({ status: LeadFlowAutomationStatus.Paused });
    const published = version();
    const { service } = build([current], [published]);

    const matches = await service.findMatching(
      tenantId,
      workspaceId,
      'leadflow.crm.opportunity.created',
    );

    expect(matches).toHaveLength(1);
    expect(matches[0].source).toBe(current);
    expect(matches[0].version).toBe(published);
    expect(matches[0].automation).toMatchObject({
      name: 'Immutable published name',
      status: LeadFlowAutomationStatus.Paused,
      triggerConfig: { type: 'opportunity.created' },
      actionConfig: { primary: 'assign_owner' },
    });
  });

  it('scopes candidate and version reads to the delivery tenant/workspace', async () => {
    const { service, automationsRepository, versionsRepository } = build(
      [source()],
      [version()],
    );

    await service.findMatching(
      tenantId,
      workspaceId,
      'leadflow.crm.opportunity.created',
    );

    expect(automationsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({ tenantId, workspaceId }),
      }),
    );
    expect(versionsRepository.find).toHaveBeenCalledWith(
      expect.objectContaining({
        where: expect.objectContaining({
          tenantId,
          status: LeadFlowAutomationVersionStatus.Published,
        }),
      }),
    );
  });

  it.each([
    [
      'another automation',
      version({ automationId: '50000000-0000-4000-8000-000000000005' }),
    ],
    [
      'another workspace in the snapshot',
      version({
        snapshot: snapshot({
          workspaceId: '60000000-0000-4000-8000-000000000006',
        }),
      }),
    ],
    [
      'a different published trigger',
      version({
        snapshot: snapshot({ trigger: { type: 'conversation.replied' } }),
      }),
    ],
  ])('rejects a published version tied to %s', async (_case, published) => {
    const { service } = build([source()], [published]);

    await expect(
      service.findMatching(
        tenantId,
        workspaceId,
        'leadflow.crm.opportunity.created',
      ),
    ).resolves.toEqual([]);
  });

  it('does not query storage for an event without a mapped trigger', async () => {
    const { service, automationsRepository, versionsRepository } = build(
      [],
      [],
    );

    await expect(
      service.findMatching(
        tenantId,
        workspaceId,
        'leadflow.crm.opportunity.copied',
      ),
    ).resolves.toEqual([]);
    expect(automationsRepository.find).not.toHaveBeenCalled();
    expect(versionsRepository.find).not.toHaveBeenCalled();
  });
});
