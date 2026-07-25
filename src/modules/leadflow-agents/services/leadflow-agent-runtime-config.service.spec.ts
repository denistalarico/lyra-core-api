import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowSettingsStatus } from '../../leadflow-settings/enums/leadflow-settings-status.enum';
import { LeadFlowAgentChannelBindingEntity } from '../entities/leadflow-agent-channel-binding.entity';
import { LeadFlowAgentEntity } from '../entities/leadflow-agent.entity';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';
import {
  LEADFLOW_AGENT_RUNTIME_CONTRACT_VERSION,
  LeadFlowAgentRuntimeConfigService,
} from './leadflow-agent-runtime-config.service';

function buildSettings(): LeadFlowClientSettingsEntity {
  return {
    id: 'settings-1',
    contextType: LeadFlowSettingsContextType.Agency,
    status: LeadFlowSettingsStatus.Active,
    planKey: 'pro',
    developerModeEnabled: false,
    clientPromptConfig: { businessName: 'Clínica X' },
    companyContextPublished: {
      schemaVersion: 1,
      identity: { publicName: 'Clínica X' },
    },
  } as unknown as LeadFlowClientSettingsEntity;
}

function buildAgent(): LeadFlowAgentEntity {
  return {
    id: 'agent-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    settingsId: 'settings-1',
    contextType: LeadFlowSettingsContextType.Agency,
    agencyClientId: null,
    businessModeKey: 'clinics_esthetics',
    presetKey: 'clinics_esthetics.reception',
    type: LeadFlowAgentType.Reception,
    name: 'Recepção',
    status: LeadFlowAgentStatus.Active,
    isSystem: true,
    isCustom: false,
    behaviorConfig: { tone: 'acolhedor' },
    promptConfig: {
      platformSystemPromptRef: 'lyra-leadflow-platform-system-v1',
    },
    handoffPolicy: { target: 'assigned_owner' },
    crmPolicy: { createLeads: true },
    channelPolicy: { allowedChannels: ['whatsapp'] },
    avatarConfig: { preset: 'avatar-reception' },
    readiness: { level: 'partial' },
    publishedVersionId: 'version-9',
    metadata: {
      allowedActions: ['send_message', 'request_handoff'],
      safetyRules: ['never_diagnose'],
    },
  } as unknown as LeadFlowAgentEntity;
}

function buildBinding(): LeadFlowAgentChannelBindingEntity {
  return {
    id: 'binding-1',
    channelKey: 'whatsapp',
    provider: 'whatsapp',
    externalRef: 'conn-1',
    status: 'pending',
    config: {},
  } as unknown as LeadFlowAgentChannelBindingEntity;
}

describe('LeadFlowAgentRuntimeConfigService', () => {
  const service = new LeadFlowAgentRuntimeConfigService();

  it('builds a clean per-agent runtime contract', () => {
    const contract = service.buildAgentContract(buildAgent(), buildSettings(), [
      buildBinding(),
    ]);

    expect(contract.version).toBe(LEADFLOW_AGENT_RUNTIME_CONTRACT_VERSION);
    expect(contract.tenantId).toBe('tenant-1');
    expect(contract.workspaceId).toBe('workspace-1');
    expect(contract.businessMode).toEqual({
      key: 'clinics_esthetics',
      isCustom: false,
    });
    expect(contract.agentIdentity.agentId).toBe('agent-1');
    expect(contract.agentIdentity.presetKey).toBe(
      'clinics_esthetics.reception',
    );
    expect(contract.clientPromptConfigSnapshot).toEqual({
      schemaVersion: 1,
      identity: { publicName: 'Clínica X' },
    });
    expect(contract.channelBindings).toEqual([
      {
        channelKey: 'whatsapp',
        provider: 'whatsapp',
        externalRef: 'conn-1',
        status: 'pending',
        config: {},
      },
    ]);
    expect(contract.allowedActions).toEqual([
      'send_message',
      'request_handoff',
    ]);
    expect(contract.safetyRules).toEqual(['never_diagnose']);
    expect(contract.publishedVersionId).toBe('version-9');
    expect(contract.leadflowSettingsSnapshot.settingsId).toBe('settings-1');
  });

  it('surfaces the formal role policy for the agent type', () => {
    const contract = service.buildAgentContract(buildAgent(), buildSettings(), [
      buildBinding(),
    ]);

    // A reception agent observes and routes; it may not advance the stage.
    expect(contract.role).toMatchObject({
      type: LeadFlowAgentType.Reception,
      roleTitle: 'Recepção',
      canProposeStageTransition: false,
    });
    expect(contract.role.allowedDecisionActions).toContain('handoff');
    expect(contract.role.allowedDecisionActions).not.toContain('set_stage');
    expect(contract.role.objective).toEqual(expect.any(String));
  });

  it('reports a real readiness verdict computed from dependencies', () => {
    const contract = service.buildAgentContract(buildAgent(), buildSettings(), [
      buildBinding(),
    ]);
    // Name, client context, a bound channel and a published version are all
    // present in the fixture, so the agent is ready.
    expect(contract.readiness).toMatchObject({ level: 'ready', missing: [] });
  });

  it('reports channels missing when no binding is present', () => {
    const contract = service.buildAgentContract(buildAgent(), buildSettings(), []);
    expect(contract.readiness.level).toBe('partial');
    expect(contract.readiness.missing).toEqual(['channels']);
  });

  it('flags custom Business Modes in the contract', () => {
    const agent = buildAgent();
    agent.businessModeKey = 'my_custom_mode';

    const contract = service.buildAgentContract(agent, buildSettings(), []);
    expect(contract.businessMode.isCustom).toBe(true);
    expect(contract.channelBindings).toEqual([]);
  });

  it('builds a context-level envelope wrapping every agent contract', () => {
    const agentContract = service.buildAgentContract(
      buildAgent(),
      buildSettings(),
      [],
    );
    const envelope = service.buildContextContract(
      'tenant-1',
      'workspace-1',
      buildSettings(),
      'clinics_esthetics',
      [agentContract],
    );

    expect(envelope.agents).toHaveLength(1);
    expect(envelope.businessMode.key).toBe('clinics_esthetics');
    expect(envelope.leadflowSettingsSnapshot.developerModeEnabled).toBe(false);
  });
});
