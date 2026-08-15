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
  const hotLead = getRecipeByKey(
    'hot_lead_notification',
  ) as LeadFlowAutomationRecipeCatalogItem;
  const automaticTagging = getRecipeByKey(
    'automatic_tagging',
  ) as LeadFlowAutomationRecipeCatalogItem;
  const dailySummary = getRecipeByKey(
    'daily_opportunity_summary',
  ) as LeadFlowAutomationRecipeCatalogItem;
  const outsideHours = getRecipeByKey(
    'outside_business_hours',
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
        automaticTagging,
        'conditions',
        {
          tagRules: Array.from({ length: 40 }, (_, index) => ({
            field: 'source',
            operator: 'is_present',
            value: null,
            tagIds: [`tag-${index}`],
          })),
        },
        automaticTagging.defaultConditionConfig,
      );

      expect(result.errors[0].code).toBe('too_many_items');
    });

    it('refuses a tag rule with an operator nobody evaluates', () => {
      const result = service.validateSection(
        automaticTagging,
        'conditions',
        {
          tagRules: [
            {
              field: 'source',
              operator: 'starts_with',
              value: 'whats',
              tagIds: ['tag-1'],
            },
          ],
        },
        automaticTagging.defaultConditionConfig,
      );

      expect(result.errors[0]).toMatchObject({
        path: 'conditions.tagRules',
        code: 'invalid_type',
      });
    });

    it('accepts a half-written rule, which readiness reports instead', () => {
      // Rejecting the save would cost the operator the rules they had already
      // written next to it.
      const result = service.validateSection(
        automaticTagging,
        'conditions',
        {
          tagRules: [
            { field: '', operator: 'equals', value: null, tagIds: [] },
          ],
        },
        automaticTagging.defaultConditionConfig,
      );

      expect(result.valid).toBe(true);
    });

    it('accepts null as a reset for an inheritable field', () => {
      const result = service.validateSection(
        idleLead,
        'trigger',
        { delayHours: null },
        idleLead.defaultTriggerConfig,
      );

      expect(result.valid).toBe(true);
    });

    it('rejects null on an exclusive field that is not nullable', () => {
      const result = service.validateSection(
        idleLead,
        'conditions',
        { stopIfReplied: null },
        idleLead.defaultConditionConfig,
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
      // The recipe's own defaults are a complete plan: D+0 and D+1 answer
      // inside the conversation and need no channel to be configured.
      expect(missing).not.toContain('message.followupSteps');
    });

    it('is only unready when every attempt of the plan is switched off', () => {
      const missing = service.findMissingRequiredFields(idleLead, {
        trigger: idleLead.defaultTriggerConfig,
        conditions: idleLead.defaultConditionConfig,
        actions: idleLead.defaultActionConfig,
        message: {
          ...idleLead.defaultMessageConfig,
          followupSteps: [
            { stepKey: 'd0', enabled: false, delayMinutes: 180, channels: [] },
            { stepKey: 'd1', enabled: false, delayMinutes: 1320, channels: [] },
            { stepKey: 'd3', enabled: false, delayMinutes: 4320, channels: [] },
            {
              stepKey: 'd7',
              enabled: false,
              delayMinutes: 10080,
              channels: [],
            },
          ],
        },
        crmPolicy: idleLead.defaultCrmPolicy,
        schedulePolicy: idleLead.defaultSchedulePolicy,
      });

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
      // `tagRules` ships as `[]`, so this recipe is genuinely not ready until
      // the operator writes one — the old readiness check missed this.
      const missing = service.findMissingRequiredFields(automaticTagging, {
        trigger: automaticTagging.defaultTriggerConfig,
        conditions: automaticTagging.defaultConditionConfig,
        actions: automaticTagging.defaultActionConfig,
        message: automaticTagging.defaultMessageConfig,
        crmPolicy: automaticTagging.defaultCrmPolicy,
        schedulePolicy: automaticTagging.defaultSchedulePolicy,
      });

      expect(missing).toContain('conditions.tagRules');
    });

    it('reports nothing once required fields are filled', () => {
      const missing = service.findMissingRequiredFields(automaticTagging, {
        trigger: automaticTagging.defaultTriggerConfig,
        conditions: {
          ...automaticTagging.defaultConditionConfig,
          tagRules: [
            {
              field: 'source',
              operator: 'equals',
              value: 'instagram',
              tagIds: ['origem-instagram'],
            },
          ],
        },
        actions: automaticTagging.defaultActionConfig,
        message: automaticTagging.defaultMessageConfig,
        crmPolicy: automaticTagging.defaultCrmPolicy,
        schedulePolicy: automaticTagging.defaultSchedulePolicy,
      });

      expect(missing).toEqual([]);
    });

    it('treats a blank string as missing', () => {
      const missing = service.findMissingRequiredFields(automaticTagging, {
        conditions: {
          ...automaticTagging.defaultConditionConfig,
          tagRules: [
            {
              field: '   ',
              operator: 'is_present',
              value: null,
              tagIds: ['origem-instagram'],
            },
          ],
        },
      });

      expect(missing).toContain('conditions.tagRules');
    });

    it('reports a rule with tags but nothing to compare against', () => {
      const missing = service.findMissingRequiredFields(automaticTagging, {
        conditions: {
          ...automaticTagging.defaultConditionConfig,
          tagRules: [
            {
              field: 'source',
              operator: 'equals',
              value: null,
              tagIds: ['origem-instagram'],
            },
          ],
        },
      });

      expect(missing).toContain('conditions.tagRules');
    });

    it('reports a rule that names no tag, which would apply nothing', () => {
      const missing = service.findMissingRequiredFields(automaticTagging, {
        conditions: {
          ...automaticTagging.defaultConditionConfig,
          tagRules: [
            {
              field: 'source',
              operator: 'is_present',
              value: null,
              tagIds: [],
            },
          ],
        },
      });

      expect(missing).toContain('conditions.tagRules');
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

    it('needs no comparison value when the rule only asks if the field is filled', () => {
      const missing = service.findMissingRequiredFields(automaticTagging, {
        trigger: automaticTagging.defaultTriggerConfig,
        conditions: {
          ...automaticTagging.defaultConditionConfig,
          tagRules: [
            {
              field: 'source',
              operator: 'is_present',
              value: null,
              tagIds: ['tag-1'],
            },
          ],
        },
        actions: automaticTagging.defaultActionConfig,
        message: automaticTagging.defaultMessageConfig,
        crmPolicy: automaticTagging.defaultCrmPolicy,
        schedulePolicy: automaticTagging.defaultSchedulePolicy,
      });

      expect(missing).toEqual([]);
    });

    it('reports every rule, so one unfinished rule blocks the automation', () => {
      const missing = service.findMissingRequiredFields(automaticTagging, {
        conditions: {
          ...automaticTagging.defaultConditionConfig,
          tagRules: [
            {
              field: 'source',
              operator: 'equals',
              value: 'whatsapp',
              tagIds: ['tag-1'],
            },
            { field: 'priority', operator: 'equals', value: '', tagIds: [] },
          ],
        },
      });

      expect(missing).toContain('conditions.tagRules');
    });

    it('needs the out-of-hours reply to actually say something', () => {
      // The executor sends this text verbatim; an empty one is an automation
      // that runs and refuses at the last step.
      expect(
        service.findMissingRequiredFields(outsideHours, {
          message: { baseMessage: '   ' },
        }),
      ).toContain('message.baseMessage');
      expect(
        service.findMissingRequiredFields(outsideHours, {
          message: outsideHours.defaultMessageConfig,
        }),
      ).not.toContain('message.baseMessage');
    });
  });

  describe('business hours', () => {
    it('accepts a weekly schedule of the automation’s own', () => {
      const result = service.validateSection(
        outsideHours,
        'schedulePolicy',
        {
          businessHours: {
            enabled: true,
            timezone: 'America/Sao_Paulo',
            days: [
              { day: 'monday', enabled: true, start: '08:00', end: '18:00' },
              { day: 'sunday', enabled: false, start: '', end: '' },
            ],
          },
        },
        outsideHours.defaultSchedulePolicy,
      );

      expect(result.valid).toBe(true);
    });

    it('inherits the workspace schedule when it is null', () => {
      const result = service.validateSection(
        outsideHours,
        'schedulePolicy',
        { businessHours: null },
        outsideHours.defaultSchedulePolicy,
      );

      expect(result.valid).toBe(true);
    });

    it('rejects a day that is open without saying when', () => {
      // The one mistake that silently moves the boundary the automation acts on.
      const result = service.validateSection(
        outsideHours,
        'schedulePolicy',
        {
          businessHours: {
            enabled: true,
            timezone: 'UTC',
            days: [{ day: 'monday', enabled: true, start: '', end: '' }],
          },
        },
        outsideHours.defaultSchedulePolicy,
      );

      expect(result.valid).toBe(false);
      expect(result.errors[0].path).toBe('schedulePolicy.businessHours');
    });

    it('rejects a weekday nobody recognises and a zone nobody can read', () => {
      const day = service.validateSection(
        outsideHours,
        'schedulePolicy',
        {
          businessHours: {
            enabled: true,
            timezone: 'UTC',
            days: [
              { day: 'segunda', enabled: true, start: '08:00', end: '18:00' },
            ],
          },
        },
        outsideHours.defaultSchedulePolicy,
      );
      const zone = service.validateSection(
        outsideHours,
        'schedulePolicy',
        {
          businessHours: {
            enabled: true,
            timezone: 'Mars/Olympus',
            days: [
              { day: 'monday', enabled: true, start: '08:00', end: '18:00' },
            ],
          },
        },
        outsideHours.defaultSchedulePolicy,
      );

      expect(day.valid).toBe(false);
      expect(zone.valid).toBe(false);
    });
  });

  describe('opportunity summary cadence', () => {
    it('accepts each cadence with the field that answer needs', () => {
      const weekly = service.validateSection(
        dailySummary,
        'schedulePolicy',
        { frequency: 'weekly', weekday: 'monday', dailyTime: '08:00' },
        dailySummary.defaultSchedulePolicy,
      );
      const monthly = service.validateSection(
        dailySummary,
        'schedulePolicy',
        { frequency: 'monthly', dayOfMonth: 5, dailyTime: '08:00' },
        dailySummary.defaultSchedulePolicy,
      );

      expect(weekly.valid).toBe(true);
      expect(monthly.valid).toBe(true);
    });

    it('rejects a cadence, a weekday or a day of month it cannot honour', () => {
      const frequency = service.validateSection(
        dailySummary,
        'schedulePolicy',
        { frequency: 'yearly' },
        dailySummary.defaultSchedulePolicy,
      );
      const weekday = service.validateSection(
        dailySummary,
        'schedulePolicy',
        { weekday: 'segunda' },
        dailySummary.defaultSchedulePolicy,
      );
      const dayOfMonth = service.validateSection(
        dailySummary,
        'schedulePolicy',
        { dayOfMonth: 32 },
        dailySummary.defaultSchedulePolicy,
      );

      expect(frequency.valid).toBe(false);
      expect(weekday.valid).toBe(false);
      expect(dayOfMonth.valid).toBe(false);
    });

    it('asks for the weekday only when the cadence is weekly', () => {
      const weekly = service.findMissingRequiredFields(dailySummary, {
        actions: dailySummary.defaultActionConfig,
        schedulePolicy: { frequency: 'weekly', dailyTime: '08:00' },
      });
      const daily = service.findMissingRequiredFields(dailySummary, {
        actions: dailySummary.defaultActionConfig,
        schedulePolicy: { frequency: 'daily', dailyTime: '08:00' },
      });

      expect(weekly).toContain('schedulePolicy.weekday');
      expect(daily).not.toContain('schedulePolicy.weekday');
    });

    it('asks for the day of the month only when the cadence is monthly', () => {
      const missing = service.findMissingRequiredFields(dailySummary, {
        actions: dailySummary.defaultActionConfig,
        schedulePolicy: { frequency: 'monthly', dailyTime: '08:00' },
      });

      expect(missing).toContain('schedulePolicy.dayOfMonth');
    });
  });

  describe('team chat delivery is an agency decision', () => {
    const schedulePolicy = { frequency: 'daily', dailyTime: '08:00' };

    it('declares the fields for the agency and hides them from a client', () => {
      const agency = service.buildSchema(dailySummary, 'agency');
      const client = service.buildSchema(dailySummary, 'client');

      const keys = (schema: typeof agency) =>
        schema.actions.map((spec) => spec.key);
      expect(keys(agency)).toEqual(
        expect.arrayContaining(['deliverToTeamChat', 'teamChatChannelId']),
      );
      expect(keys(client)).not.toContain('teamChatChannelId');
      // Everything else about the recipe is the same conversation.
      expect(keys(client)).toContain('notificationChannels');
    });

    it('refuses the write from a client context for the same reason', () => {
      const agency = service.validateSection(
        dailySummary,
        'actions',
        { teamChatChannelId: 'channel-1' },
        dailySummary.defaultActionConfig,
        'agency',
      );
      const client = service.validateSection(
        dailySummary,
        'actions',
        { teamChatChannelId: 'channel-1' },
        dailySummary.defaultActionConfig,
        'client',
      );

      expect(agency.valid).toBe(true);
      expect(client.valid).toBe(false);
      expect(client.errors[0]).toMatchObject({
        path: 'actions.teamChatChannelId',
        code: 'unknown_field',
      });
    });

    it('needs a channel once the delivery is switched on', () => {
      const missing = service.findMissingRequiredFields(dailySummary, {
        actions: {
          ...dailySummary.defaultActionConfig,
          deliverToTeamChat: true,
        },
        schedulePolicy,
      });
      const configured = service.findMissingRequiredFields(dailySummary, {
        actions: {
          ...dailySummary.defaultActionConfig,
          deliverToTeamChat: true,
          teamChatChannelId: 'channel-1',
        },
        schedulePolicy,
      });

      expect(missing).toContain('actions.teamChatChannelId');
      expect(configured).not.toContain('actions.teamChatChannelId');
    });
  });
});
