import {
  buildConfigSchema,
  findUnspecifiedDefaultKeys,
  getFieldSpec,
  isInheritableConfigField,
  LEADFLOW_AUTOMATION_CONFIG_SECTIONS,
} from './automation-config-schemas.catalog';
import { LEADFLOW_AUTOMATION_RECIPES } from './automation-recipes.catalog';

describe('automation config schemas catalog', () => {
  it('has a field spec for every key any recipe declares as a default', () => {
    // Guards the derivation invariant: the schema is built from recipe
    // defaults, so a default without a spec would silently become an
    // unconfigurable — and unvalidatable — field.
    const orphans = LEADFLOW_AUTOMATION_RECIPES.flatMap((recipe) =>
      findUnspecifiedDefaultKeys(recipe).map(
        (path) => `${recipe.key}: ${path}`,
      ),
    );

    expect(orphans).toEqual([]);
  });

  it('builds a schema section for every config section of every recipe', () => {
    for (const recipe of LEADFLOW_AUTOMATION_RECIPES) {
      const schema = buildConfigSchema(recipe);
      for (const section of LEADFLOW_AUTOMATION_CONFIG_SECTIONS) {
        expect(Array.isArray(schema[section])).toBe(true);
      }
    }
  });

  it('exposes exactly the keys the recipe defaults declare', () => {
    const recipe = LEADFLOW_AUTOMATION_RECIPES.find(
      (item) => item.key === 'followup_idle_lead',
    )!;
    const schema = buildConfigSchema(recipe);

    expect(schema.trigger.map((spec) => spec.key).sort()).toEqual(
      Object.keys(recipe.defaultTriggerConfig).sort(),
    );
    expect(schema.actions.map((spec) => spec.key).sort()).toEqual(
      Object.keys(recipe.defaultActionConfig).sort(),
    );
  });

  it('marks structural fields as read-only', () => {
    expect(getFieldSpec('trigger', 'type')?.readOnly).toBe(true);
    expect(getFieldSpec('actions', 'primaryAction')?.readOnly).toBe(true);
  });

  it('keeps technical fields out of the essential surface', () => {
    expect(getFieldSpec('trigger', 'type')?.surface).toBe('developer');
    expect(getFieldSpec('actions', 'primaryAction')?.surface).toBe('developer');
  });

  it('declares the complete reversible inheritance matrix and no exclusive fields', () => {
    const inheritable = [
      ['trigger', 'delayHours'],
      ['trigger', 'pipelineRef'],
      ['trigger', 'stageRef'],
      ['conditions', 'businessHoursOnly'],
      ['conditions', 'requireExplicitConsent'],
      ['actions', 'maxAttempts'],
      ['message', 'channel'],
      ['schedulePolicy', 'respectBusinessHours'],
      ['schedulePolicy', 'timezone'],
    ] as const;

    for (const [section, key] of inheritable) {
      expect(isInheritableConfigField(section, key)).toBe(true);
    }
    expect(isInheritableConfigField('actions', 'primaryAction')).toBe(false);
    expect(isInheritableConfigField('message', 'baseMessage')).toBe(false);
    expect(isInheritableConfigField('crmPolicy', 'moveStageOnComplete')).toBe(
      false,
    );
  });

  it('gives every field a business-facing label', () => {
    for (const recipe of LEADFLOW_AUTOMATION_RECIPES) {
      const schema = buildConfigSchema(recipe);
      for (const section of LEADFLOW_AUTOMATION_CONFIG_SECTIONS) {
        for (const spec of schema[section]) {
          expect(spec.label.length).toBeGreaterThan(0);
          expect(spec.label).not.toBe(spec.key);
        }
      }
    }
  });
});
