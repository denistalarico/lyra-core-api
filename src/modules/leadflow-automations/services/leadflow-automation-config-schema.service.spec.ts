import {
  getRecipeByKey,
  type LeadFlowAutomationRecipeCatalogItem,
} from '../catalog/automation-recipes.catalog';
import { LeadFlowAutomationConfigSchemaService } from './leadflow-automation-config-schema.service';

describe('LeadFlowAutomationConfigSchemaService', () => {
  const service = new LeadFlowAutomationConfigSchemaService();
  const idleLead = getRecipeByKey(
    'followup_idle_lead',
  ) as LeadFlowAutomationRecipeCatalogItem;
  const missingFields = getRecipeByKey(
    'missing_fields_request',
  ) as LeadFlowAutomationRecipeCatalogItem;
  const hotLead = getRecipeByKey(
    'hot_lead_notification',
  ) as LeadFlowAutomationRecipeCatalogItem;
  const automaticTagging = getRecipeByKey(
    'automatic_tagging',
  ) as LeadFlowAutomationRecipeCatalogItem;
  const coldReactivation = getRecipeByKey(
    'cold_lead_reactivation',
  ) as LeadFlowAutomationRecipeCatalogItem;
  const dailySummary = getRecipeByKey(
    'daily_opportunity_summary',
  ) as LeadFlowAutomationRecipeCatalogItem;

  describe('validateSection', () => {
    it('accepts the recipe defaults unchanged', () => {
      // Every persisted config originated as a default, so this is the
      // guarantee that enforcing the schema needs no data migration.
      const result = service.validateSection(
        idleLead,
        'trigger',
        idleLead.defaultTriggerConfig,
        idleLead.defaultTriggerConfig,
      );

      expect(result.valid).toBe(true);
    });

    it('accepts a valid change to a configurable field', () => {
      const result = service.validateSection(
        idleLead,
        'trigger',
        { delayHours: 12 },
        idleLead.defaultTriggerConfig,
      );

      expect(result.valid).toBe(true);
    });

    it('validates daily wall-clock time and IANA timezone', () => {
      expect(
        service.validateSection(
          dailySummary,
          'schedulePolicy',
          { dailyTime: '08:30', timezone: 'America/Sao_Paulo' },
          dailySummary.defaultSchedulePolicy,
        ).valid,
      ).toBe(true);
      expect(
        service
          .validateSection(
            dailySummary,
            'schedulePolicy',
            { dailyTime: '8h30', timezone: 'Mars/Olympus' },
            dailySummary.defaultSchedulePolicy,
          )
          .errors.map((error) => error.path),
      ).toEqual(
        expect.arrayContaining([
          'schedulePolicy.dailyTime',
          'schedulePolicy.timezone',
        ]),
      );
    });

    it('rejects an unknown field instead of persisting it', () => {
      const result = service.validateSection(
        idleLead,
        'trigger',
        { delayHours: 12, sneakyField: 'anything' },
        idleLead.defaultTriggerConfig,
      );

      expect(result.valid).toBe(false);
      expect(result.errors).toEqual([
        expect.objectContaining({
          path: 'trigger.sneakyField',
          code: 'unknown_field',
        }),
      ]);
    });

    it('rejects a change to a read-only structural field', () => {
      const result = service.validateSection(
        idleLead,
        'trigger',
        { type: 'opportunity.created' },
        idleLead.defaultTriggerConfig,
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0].code).toBe('read_only_field');
    });

    it('allows a read-only field resent with its own value', () => {
      const result = service.validateSection(
        idleLead,
        'trigger',
        { type: idleLead.defaultTriggerConfig.type },
        idleLead.defaultTriggerConfig,
      );

      expect(result.valid).toBe(true);
    });

    it('rejects a value outside the declared range', () => {
      const result = service.validateSection(
        idleLead,
        'trigger',
        { delayHours: 0 },
        idleLead.defaultTriggerConfig,
      );

      expect(result.errors[0].code).toBe('out_of_range');
    });

    it('rejects a value of the wrong type', () => {
      const result = service.validateSection(
        idleLead,
        'trigger',
        { delayHours: '12' },
        idleLead.defaultTriggerConfig,
      );

      expect(result.errors[0].code).toBe('invalid_type');
    });

    it('rejects a non-object section', () => {
      const result = service.validateSection(
        idleLead,
        'trigger',
        ['not', 'an', 'object'],
        idleLead.defaultTriggerConfig,
      );

      expect(result.errors[0].code).toBe('malformed_section');
    });

    it('enforces list item limits', () => {
      const result = service.validateSection(
        missingFields,
        'conditions',
        { requiredFields: Array.from({ length: 40 }, (_, i) => `f${i}`) },
        missingFields.defaultConditionConfig,
      );

      expect(result.errors[0].code).toBe('too_many_items');
    });

    it('rejects a null value on a field that is not nullable', () => {
      const result = service.validateSection(
        idleLead,
        'trigger',
        { delayHours: null },
        idleLead.defaultTriggerConfig,
      );

      expect(result.errors[0].code).toBe('not_nullable');
    });

    it('accepts null on a nullable field', () => {
      const result = service.validateSection(
        idleLead,
        'message',
        { channel: null },
        idleLead.defaultMessageConfig,
      );

      expect(result.valid).toBe(true);
    });

    it('rejects SMS because it is visible-only and not persistable in phase 7', () => {
      const result = service.validateSection(
        hotLead,
        'actions',
        { notificationChannels: ['in_app', 'sms'] },
        hotLead.defaultActionConfig,
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0]).toMatchObject({
        path: 'actions.notificationChannels',
        code: 'invalid_type',
      });
    });
  });

  describe('findMissingRequiredFields', () => {
    it('keeps cold reactivation unready until a delivery channel is enabled', () => {
      const missing = service.findMissingRequiredFields(coldReactivation, {
        trigger: coldReactivation.defaultTriggerConfig,
        conditions: coldReactivation.defaultConditionConfig,
        actions: coldReactivation.defaultActionConfig,
        message: coldReactivation.defaultMessageConfig,
        crmPolicy: coldReactivation.defaultCrmPolicy,
        schedulePolicy: coldReactivation.defaultSchedulePolicy,
      });

      expect(missing).toContain('message.followupSteps');
    });

    it('does not make a global WhatsApp template an activation requirement', () => {
      const missing = service.findMissingRequiredFields(idleLead, {
        trigger: idleLead.defaultTriggerConfig,
        conditions: idleLead.defaultConditionConfig,
        actions: idleLead.defaultActionConfig,
        message: idleLead.defaultMessageConfig,
        crmPolicy: idleLead.defaultCrmPolicy,
        schedulePolicy: idleLead.defaultSchedulePolicy,
      });

      expect(missing).not.toContain('message.templateRef');
      expect(missing).toContain('message.followupSteps');
    });

    it('accepts an eligible WhatsApp step without a template', () => {
      const missing = service.findMissingRequiredFields(idleLead, {
        trigger: idleLead.defaultTriggerConfig,
        conditions: idleLead.defaultConditionConfig,
        actions: idleLead.defaultActionConfig,
        message: {
          ...idleLead.defaultMessageConfig,
          followupSteps: [
            {
              stepKey: 'd1',
              delayMinutes: 1440,
              channels: [
                {
                  channel: 'whatsapp',
                  enabled: true,
                  outsideWindowEnabled: false,
                  connectionRef: 'channel-1',
                },
              ],
            },
          ],
        },
        crmPolicy: idleLead.defaultCrmPolicy,
        schedulePolicy: idleLead.defaultSchedulePolicy,
      });

      expect(missing).toEqual([]);
    });

    it('rejects outside-window enablement for an inside-window-only channel', () => {
      const result = service.validateSection(
        idleLead,
        'message',
        {
          followupSteps: [
            {
              stepKey: 'd1',
              delayMinutes: 1440,
              channels: [
                {
                  channel: 'webchat',
                  enabled: true,
                  outsideWindowEnabled: true,
                },
              ],
            },
          ],
        },
        idleLead.defaultMessageConfig,
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('não aceitam follow-up');
    });

    it('rejects credentials in the per-channel jsonb contract', () => {
      const result = service.validateSection(
        idleLead,
        'message',
        {
          followupSteps: [
            {
              stepKey: 'd1',
              delayMinutes: 1440,
              channels: [
                {
                  channel: 'whatsapp',
                  enabled: true,
                  outsideWindowEnabled: false,
                  connectionRef: 'channel-1',
                  accessToken: 'must-not-be-persisted',
                },
              ],
            },
          ],
        },
        idleLead.defaultMessageConfig,
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0].message).toContain('política');
    });

    it('reports an empty required list as missing', () => {
      // `requiredFields` ships as `[]`, so this recipe is genuinely not ready
      // until the operator fills it — the old readiness check missed this.
      const missing = service.findMissingRequiredFields(missingFields, {
        trigger: missingFields.defaultTriggerConfig,
        conditions: missingFields.defaultConditionConfig,
        actions: missingFields.defaultActionConfig,
        message: missingFields.defaultMessageConfig,
        crmPolicy: missingFields.defaultCrmPolicy,
        schedulePolicy: missingFields.defaultSchedulePolicy,
      });

      expect(missing).toContain('conditions.requiredFields');
    });

    it('reports nothing once required fields are filled', () => {
      const missing = service.findMissingRequiredFields(missingFields, {
        trigger: missingFields.defaultTriggerConfig,
        conditions: {
          ...missingFields.defaultConditionConfig,
          requiredFields: ['email'],
        },
        actions: missingFields.defaultActionConfig,
        message: missingFields.defaultMessageConfig,
        crmPolicy: missingFields.defaultCrmPolicy,
        schedulePolicy: missingFields.defaultSchedulePolicy,
      });

      expect(missing).toEqual([]);
    });

    it('treats a blank string as missing', () => {
      const missing = service.findMissingRequiredFields(missingFields, {
        conditions: {
          ...missingFields.defaultConditionConfig,
          requiredFields: ['ok'],
        },
        actions: { ...missingFields.defaultActionConfig, maxAttempts: null },
      });

      expect(missing).toContain('actions.maxAttempts');
    });

    it('accepts the approved platform WhatsApp channel in the closed schema', () => {
      const missing = service.findMissingRequiredFields(hotLead, {
        trigger: hotLead.defaultTriggerConfig,
        conditions: hotLead.defaultConditionConfig,
        actions: {
          ...hotLead.defaultActionConfig,
          notificationChannels: ['platform_whatsapp'],
        },
        message: hotLead.defaultMessageConfig,
        crmPolicy: hotLead.defaultCrmPolicy,
        schedulePolicy: hotLead.defaultSchedulePolicy,
      });

      expect(missing).not.toContain('actions.notificationChannels');
    });

    it('requires a comparison value for automatic tagging except is_present', () => {
      const missing = service.findMissingRequiredFields(automaticTagging, {
        trigger: automaticTagging.defaultTriggerConfig,
        conditions: {
          ...automaticTagging.defaultConditionConfig,
          ruleOperator: 'equals',
          ruleValue: null,
        },
        actions: {
          ...automaticTagging.defaultActionConfig,
          addTags: ['tag-1'],
        },
        message: automaticTagging.defaultMessageConfig,
        crmPolicy: automaticTagging.defaultCrmPolicy,
        schedulePolicy: automaticTagging.defaultSchedulePolicy,
      });

      expect(missing).toContain('conditions.ruleValue');
    });
  });
});
