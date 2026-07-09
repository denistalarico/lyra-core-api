import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import {
  getRecipeByKey,
  isRecipeCompatible,
  LEADFLOW_AUTOMATION_RECIPES,
  listRecipes,
} from './automation-recipes.catalog';

const ESSENTIAL_KEYS = [
  'followup_idle_lead',
  'followup_by_crm_stage',
  'appointment_reminder',
  'appointment_confirmation',
  'appointment_no_show_recovery',
  'hot_lead_notification',
  'automatic_handoff',
  'outside_business_hours',
  'missing_fields_request',
  'post_service_followup',
];

const OPTIONAL_KEYS = [
  'quote_recovery',
  'cold_lead_reactivation',
  'daily_opportunity_summary',
  'lead_distribution',
  'automatic_tagging',
  'nps_feedback',
  'birthday_or_special_date',
  'pending_documents',
  'campaign_followup',
  'developer_webhook',
];

describe('automation recipes catalog', () => {
  it('exposes every essential recipe', () => {
    for (const key of ESSENTIAL_KEYS) {
      const recipe = getRecipeByKey(key);
      expect(recipe).toBeDefined();
      expect(recipe?.tier).toBe('essential');
    }
  });

  it('exposes every optional/developer recipe', () => {
    for (const key of OPTIONAL_KEYS) {
      expect(getRecipeByKey(key)).toBeDefined();
    }
  });

  it('has unique recipe keys', () => {
    const keys = listRecipes().map((recipe) => recipe.key);
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('always carries the trigger type into the default trigger config', () => {
    for (const recipe of LEADFLOW_AUTOMATION_RECIPES) {
      expect(recipe.defaultTriggerConfig.type).toBe(recipe.trigger);
      expect(recipe.safetyRules.length).toBeGreaterThan(0);
    }
  });

  it('marks only the developer webhook recipe as developer-only', () => {
    const developerOnly = LEADFLOW_AUTOMATION_RECIPES.filter(
      (recipe) => recipe.isDeveloperOnly,
    );
    expect(developerOnly.map((recipe) => recipe.key)).toEqual([
      'developer_webhook',
    ]);
  });

  it('treats "all" recipes as compatible with every mode', () => {
    const followup = getRecipeByKey('followup_idle_lead')!;
    expect(
      isRecipeCompatible(followup, LeadFlowBusinessMode.ClinicsEsthetics),
    ).toBe(true);
    expect(isRecipeCompatible(followup, 'some_custom_mode')).toBe(true);
  });

  it('narrows agenda recipes to their declared modes', () => {
    const reminder = getRecipeByKey('appointment_reminder')!;
    expect(
      isRecipeCompatible(reminder, LeadFlowBusinessMode.ClinicsEsthetics),
    ).toBe(true);
    expect(
      isRecipeCompatible(reminder, LeadFlowBusinessMode.EcommerceLight),
    ).toBe(false);
  });
});
