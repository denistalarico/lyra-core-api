import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import {
  getHandoffDefaultsByType,
  getHandoffPolicyDefaultsForType,
  getPresetByKey,
  getPresetsForBusinessMode,
  isCustomBusinessMode,
  LEADFLOW_AGENT_PRESETS,
} from './agent-presets.catalog';
import { LeadFlowAgentType } from '../enums/leadflow-agent-type.enum';

describe('agent-presets.catalog', () => {
  it('exposes at least one preset for every official Business Mode', () => {
    for (const mode of Object.values(LeadFlowBusinessMode)) {
      expect(getPresetsForBusinessMode(mode).length).toBeGreaterThan(0);
    }
  });

  it('scopes presets to their Business Mode', () => {
    const presets = getPresetsForBusinessMode(
      LeadFlowBusinessMode.ClinicsEsthetics,
    );
    expect(presets.length).toBeGreaterThan(0);
    expect(
      presets.every(
        (preset) =>
          preset.businessModeKey === LeadFlowBusinessMode.ClinicsEsthetics,
      ),
    ).toBe(true);
  });

  it('never exposes a raw prompt on a preset (governance)', () => {
    for (const preset of LEADFLOW_AGENT_PRESETS) {
      expect(preset.promptConfig).not.toHaveProperty('rawSystemPrompt');
      expect(preset.promptConfig).not.toHaveProperty('developerOverrides');
      expect(preset.promptConfig.platformSystemPromptRef).toBeTruthy();
    }
  });

  it('adds regulated safety rules for regulated modes', () => {
    const [clinicsPreset] = getPresetsForBusinessMode(
      LeadFlowBusinessMode.ClinicsEsthetics,
    );
    expect(clinicsPreset.safetyRules).toContain('never_diagnose');
  });

  it('resolves presets by key and flags custom Business Modes', () => {
    const [preset] = LEADFLOW_AGENT_PRESETS;
    expect(getPresetByKey(preset.key)).toEqual(preset);
    expect(getPresetByKey('does.not.exist')).toBeUndefined();

    expect(isCustomBusinessMode(LeadFlowBusinessMode.AgencyServices)).toBe(
      false,
    );
    expect(isCustomBusinessMode('my_custom_mode')).toBe(true);
  });

  it('keeps handoff triggers, destination and SLA as backend defaults by type', () => {
    expect(getHandoffPolicyDefaultsForType(LeadFlowAgentType.Sales)).toEqual({
      triggers: [
        'payment_or_contract_question',
        'negotiation_authority_needed',
        'lead_asks_for_human',
      ],
      target: 'assigned_owner',
      slaMinutes: 10,
    });

    const defaults = getHandoffDefaultsByType();
    for (const type of Object.values(LeadFlowAgentType)) {
      expect(defaults[type]).toEqual({
        target: 'assigned_owner',
        slaMinutes: expect.any(Number),
      });
    }
  });
});
