import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowAutomationCategory } from '../enums/leadflow-automation-category.enum';
import { LeadFlowAutomationDependency } from '../enums/leadflow-automation-dependency.enum';
import {
  getRecipeByKey,
  isRecipeCompatible,
  LEADFLOW_AUTOMATION_RECIPES,
  LEADFLOW_AUTOMATION_TRIGGER_KINDS,
  listRecipes,
  RETIRED_AUTOMATION_RECIPE_KEYS,
} from './automation-recipes.catalog';

const ESSENTIAL_KEYS = [
  'followup_idle_lead',
  'appointment_reminder',
  'appointment_confirmation',
  'appointment_no_show_recovery',
  'hot_lead_notification',
  'outside_business_hours',
];

const OPTIONAL_KEYS = [
  'daily_opportunity_summary',
  'lead_distribution',
  'automatic_tagging',
  'post_service_csat',
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

  it('offers nothing under a retired key', () => {
    // A retired recipe that still resolves is worse than none: provisioning
    // would create a card the operator can open and cannot configure.
    for (const key of RETIRED_AUTOMATION_RECIPE_KEYS) {
      expect(getRecipeByKey(key)).toBeUndefined();
      expect(listRecipes().some((recipe) => recipe.key === key)).toBe(false);
    }
  });

  it('keeps a single follow-up recipe', () => {
    // Seven recipes used to schedule a message after a wait, each with its own
    // cadence to configure. The point of retiring them is that this stays one.
    // The no-show recovery also schedules a follow-up, but it recovers a missed
    // appointment — the Agenda owns when that happens, not the cadence.
    const followups = listRecipes().filter(
      (recipe) => recipe.category === LeadFlowAutomationCategory.Followup,
    );
    expect(followups.map((recipe) => recipe.key)).toEqual([
      'followup_idle_lead',
    ]);
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

  describe('versioning and dependencies', () => {
    it('versions every recipe and ships none deprecated', () => {
      for (const recipe of LEADFLOW_AUTOMATION_RECIPES) {
        expect(recipe.templateVersion).toBeGreaterThanOrEqual(1);
        expect(recipe.deprecated).toBe(false);
      }
    });

    it('declares at least one dependency for every recipe', () => {
      // A recipe with no dependencies would claim it can run today, which is
      // false for every recipe in the catalog.
      for (const recipe of LEADFLOW_AUTOMATION_RECIPES) {
        expect(recipe.requiredDependencies.length).toBeGreaterThan(0);
      }
    });

    it('routes agenda recipes to the Agenda domain, not the legacy module', () => {
      for (const key of [
        'appointment_reminder',
        'appointment_confirmation',
        'appointment_no_show_recovery',
      ]) {
        expect(getRecipeByKey(key)!.requiredDependencies).toContain(
          LeadFlowAutomationDependency.AgendaDomain,
        );
      }
    });

    it('routes lead distribution through the canonical distribution command', () => {
      expect(
        getRecipeByKey('lead_distribution')!.requiredDependencies,
      ).toContain(LeadFlowAutomationDependency.LeadDistributionCommand);
    });

    it('routes the daily summary through the durable scheduler and event fan-out', () => {
      expect(
        getRecipeByKey('daily_opportunity_summary')!.requiredDependencies,
      ).toEqual(
        expect.arrayContaining([
          LeadFlowAutomationDependency.SchedulerRuntime,
          LeadFlowAutomationDependency.EventFanOut,
        ]),
      );
    });

    it('keeps the old NPS key readable while provisioning CSAT under the new key', () => {
      expect(
        listRecipes().some((recipe) => recipe.key === 'nps_feedback'),
      ).toBe(false);
      expect(getRecipeByKey('nps_feedback')).toMatchObject({
        key: 'nps_feedback',
        deprecated: true,
        primaryAction: 'request_csat',
      });
    });
  });

  describe('trigger classification', () => {
    it('classifies every trigger key', () => {
      for (const recipe of LEADFLOW_AUTOMATION_RECIPES) {
        expect(recipe.triggerKind).toBeDefined();
        expect(LEADFLOW_AUTOMATION_TRIGGER_KINDS[recipe.trigger]).toBe(
          recipe.triggerKind,
        );
      }
    });

    it('treats the out-of-hours trigger as a derived window, not an event', () => {
      // Audit finding: `business_hours.closed` reads like a domain event but is
      // a condition evaluated against an incoming message.
      expect(getRecipeByKey('outside_business_hours')!.triggerKind).toBe(
        'derived',
      );
    });

    it('treats clock-driven recipes as schedules', () => {
      expect(getRecipeByKey('daily_opportunity_summary')!.triggerKind).toBe(
        'schedule',
      );
    });
  });
});
