import { LeadFlowAutomationCategory } from '../enums/leadflow-automation-category.enum';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import type { LeadFlowAutomationEntity } from '../entities/leadflow-automation.entity';
import { LeadFlowAutomationRuntimeConfigService } from './leadflow-automation-runtime-config.service';
import type { LeadFlowAutomationGlobalDefaultsSnapshot } from '../types/leadflow-automation.types';

function buildAutomation(
  overrides: Partial<LeadFlowAutomationEntity> = {},
): LeadFlowAutomationEntity {
  const base = {
    id: 'auto-1',
    tenantId: 'tenant-1',
    workspaceId: 'ws-1',
    settingsId: 'settings-1',
    contextType: 'agency',
    agencyClientId: null,
    businessModeKey: 'clinics_esthetics',
    recipeKey: 'developer_webhook',
    name: 'Webhook dev',
    description: null,
    category: LeadFlowAutomationCategory.Developer,
    status: LeadFlowAutomationStatus.Active,
    triggerConfig: { type: 'developer.webhook.received' },
    conditionConfig: {},
    actionConfig: { primaryAction: 'send_webhook' },
    messageConfig: {},
    crmPolicy: {},
    schedulePolicy: {},
    developerConfig: { enabled: true, dryRunEnabled: true },
    webhookConfig: {
      enabled: true,
      direction: 'outgoing',
      url: 'https://example.com/hook',
      method: 'POST',
      headers: { 'x-key': 'abc' },
      secret: 'supersecrettoken1234',
    },
    readiness: { level: 'ready', state: undefined },
    publishedVersionId: null,
    metadata: {},
    createdById: null,
    updatedById: null,
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };

  return { ...base, ...overrides } as unknown as LeadFlowAutomationEntity;
}

describe('LeadFlowAutomationRuntimeConfigService', () => {
  const service = new LeadFlowAutomationRuntimeConfigService();

  it('masks the webhook secret and never leaks it', () => {
    const contract = service.buildAutomationContract(buildAutomation(), null);
    const serialized = JSON.stringify(contract);

    expect(serialized).not.toContain('supersecrettoken1234');
    expect(contract.webhook?.hasSecret).toBe(true);
    expect(contract.webhook?.secretMasked).toBe('••••1234');
    // The raw secret key must not be present anywhere in the projection.
    expect(serialized).not.toContain('"secret"');
  });

  it('only exposes developer flags, not raw developer material', () => {
    const contract = service.buildAutomationContract(buildAutomation(), null);
    expect(contract.developerConfig).toEqual({
      enabled: true,
      dryRunEnabled: true,
      advancedConditions: {},
    });
  });

  it('emits the structural "every conversation creates opportunity" rule at context level', () => {
    const contextContract = service.buildContextContract(
      'tenant-1',
      'ws-1',
      null,
      'clinics_esthetics',
      [],
    );

    expect(
      contextContract.structuralRules.everyConversationCreatesOpportunity,
    ).toBe(true);
    expect(contextContract.enabledAutomations).toEqual([]);
  });

  it('returns null webhook when no webhook config is present', () => {
    const contract = service.buildAutomationContract(
      buildAutomation({ webhookConfig: {} }),
      null,
    );
    expect(contract.webhook).toBeNull();
  });

  it('records the effective global defaults in the runtime contract for publication', () => {
    const globalDefaults: LeadFlowAutomationGlobalDefaultsSnapshot = {
      version: 4,
      source: 'persisted',
      createdAt: '2026-08-03T12:00:00.000Z',
      config: {
        schemaVersion: 1,
        timezone: 'America/Sao_Paulo',
        businessHours: { enabled: true, windows: {} },
        crm: { pipelineRef: null, stageRef: null },
        channels: { defaultChannel: null },
        consent: { requireExplicitConsent: true },
        followUp: { defaultDelayHours: null, maxAttempts: null },
      },
    };
    const contract = service.buildAutomationContract(
      buildAutomation({
        conditionConfig: {},
        schedulePolicy: {},
      }),
      null,
      globalDefaults,
    );

    expect(contract.version).toBe(2);
    expect(contract.globalDefaults).toEqual(globalDefaults);
    expect(contract.schedulePolicy).toMatchObject({
      timezone: 'America/Sao_Paulo',
      respectBusinessHours: true,
    });
    expect(contract.conditions.requireExplicitConsent).toBe(true);
    expect(contract.inheritedFields).toEqual(
      expect.arrayContaining([
        'schedulePolicy.timezone',
        'conditions.requireExplicitConsent',
      ]),
    );
  });
});
