import { LeadFlowEventStatus } from '../enums/leadflow-event-status.enum';
import { LEADFLOW_EVENT_MODULE_KEYS } from '../types/leadflow-event.types';
import {
  getEventByName,
  LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS,
  LEADFLOW_EVENT_CATALOG,
  LEADFLOW_EVENT_STRUCTURAL_RULE,
  listEvents,
} from './leadflow-event.catalog';

const EVENT_NAME_PATTERN =
  /^leadflow\.(inbox|crm|agents|automations|calendar|settings)\.[a-z0-9_]+(\.[a-z0-9_]+)+$/;

/** Payload/context field names that would indicate leaked sensitive data. */
const FORBIDDEN_FIELD_PATTERN = /secret|token|password|credential|prompt/i;

const BLUEPRINT_EVENT_NAMES = [
  // Inbox
  'leadflow.inbox.conversation.created',
  'leadflow.inbox.conversation.updated',
  'leadflow.inbox.conversation.message.received',
  'leadflow.inbox.conversation.message.sent',
  'leadflow.inbox.conversation.idle',
  'leadflow.inbox.conversation.assigned',
  'leadflow.inbox.conversation.handoff.requested',
  'leadflow.inbox.business_hours.closed',
  'leadflow.inbox.conversation.handoff.accepted',
  'leadflow.inbox.conversation.closed',
  // CRM
  'leadflow.crm.opportunity.created',
  'leadflow.crm.opportunity.updated',
  'leadflow.crm.opportunity.stage.changed',
  'leadflow.crm.opportunity.score.changed',
  'leadflow.crm.opportunity.status.changed',
  'leadflow.crm.opportunity.owner.changed',
  'leadflow.crm.opportunity.won',
  'leadflow.crm.opportunity.lost',
  'leadflow.crm.opportunity.idle',
  'leadflow.crm.opportunity.linked_to_conversation',
  'leadflow.crm.contact.created',
  'leadflow.crm.contact.updated',
  // Agents
  'leadflow.agents.agent.provisioned',
  'leadflow.agents.agent.updated',
  'leadflow.agents.agent.activated',
  'leadflow.agents.agent.paused',
  'leadflow.agents.agent.published',
  'leadflow.agents.runtime.config.updated',
  // Automations
  'leadflow.automations.automation.provisioned',
  'leadflow.automations.automation.updated',
  'leadflow.automations.automation.activated',
  'leadflow.automations.automation.paused',
  'leadflow.automations.automation.published',
  'leadflow.automations.runtime.config.updated',
  'leadflow.automations.csat.response.recorded',
  'leadflow.automations.schedule.daily',
  // Calendar
  'leadflow.calendar.appointment.created',
  'leadflow.calendar.appointment.updated',
  'leadflow.calendar.appointment.confirmation_pending',
  'leadflow.calendar.appointment.confirmed',
  'leadflow.calendar.appointment.cancelled',
  'leadflow.calendar.appointment.no_show',
  'leadflow.calendar.appointment.completed',
  'leadflow.calendar.appointment.reminder_due',
  // Settings
  'leadflow.settings.business_mode.changed',
  'leadflow.settings.client_prompt_config.updated',
  'leadflow.settings.integration.enabled',
  'leadflow.settings.integration.disabled',
  'leadflow.settings.handoff_rules.updated',
  'leadflow.settings.business_hours.updated',
];

const PLANNED_EXECUTION_EVENTS = [
  'leadflow.automations.execution.eligible',
  'leadflow.automations.execution.started',
  'leadflow.automations.execution.completed',
  'leadflow.automations.execution.failed',
  'leadflow.automations.execution.skipped',
];

describe('leadflow event catalog', () => {
  it('exposes every blueprint event as active', () => {
    for (const eventName of BLUEPRINT_EVENT_NAMES) {
      const item = getEventByName(eventName);
      expect(item).toBeDefined();
      expect(item?.status).toBe(LeadFlowEventStatus.Active);
    }
  });

  it('exposes future execution events as planned, never active', () => {
    for (const eventName of PLANNED_EXECUTION_EVENTS) {
      const item = getEventByName(eventName);
      expect(item).toBeDefined();
      expect(item?.status).toBe(LeadFlowEventStatus.Planned);
    }
  });

  it('publishes the CSAT 1-5 and appointment confirmation contracts for their owning phases', () => {
    const csat = getEventByName('leadflow.automations.csat.response.recorded');
    expect(csat).toMatchObject({
      status: LeadFlowEventStatus.Active,
      requiredContext: ['automationId', 'csatResponseId'],
    });
    expect(csat?.consumedBy).toContain('leadflow.analytics');
    expect(csat?.payloadSchema.score).toMatchObject({
      type: 'number',
      required: true,
    });
    expect(getEventByName('leadflow.automations.schedule.daily')).toMatchObject(
      {
        status: LeadFlowEventStatus.Active,
        requiredContext: ['automationId'],
        emittedBy: 'system.scheduler',
      },
    );

    expect(
      getEventByName('leadflow.calendar.appointment.confirmation_pending'),
    ).toMatchObject({
      status: LeadFlowEventStatus.Active,
      requiredContext: ['appointmentId'],
    });
    expect(
      getEventByName('leadflow.calendar.appointment.confirmation_pending')
        ?.consumedBy,
    ).toContain('leadflow.analytics');
  });

  it('has unique, well-formed event names', () => {
    const names = LEADFLOW_EVENT_CATALOG.map((item) => item.eventName);
    expect(new Set(names).size).toBe(names.length);

    for (const name of names) {
      expect(name).toMatch(EVENT_NAME_PATTERN);
    }
  });

  it('keeps moduleKey, resource and action consistent with the event name', () => {
    for (const item of LEADFLOW_EVENT_CATALOG) {
      const segments = item.eventName.split('.');
      expect(item.moduleKey).toBe(`leadflow.${segments[1]}`);
      expect(LEADFLOW_EVENT_MODULE_KEYS).toContain(item.moduleKey);
      expect(item.action).toBe(segments[segments.length - 1]);
      expect(item.resource).toBe(segments.slice(2, -1).join('.'));
      expect(item.resource.length).toBeGreaterThan(0);
    }
  });

  it('versions every event and declares consumers and description', () => {
    for (const item of LEADFLOW_EVENT_CATALOG) {
      expect(item.eventVersion).toBeGreaterThanOrEqual(1);
      expect(Number.isInteger(item.eventVersion)).toBe(true);
      expect(item.description.length).toBeGreaterThan(0);
      expect(item.emittedBy.length).toBeGreaterThan(0);
      expect(Array.isArray(item.consumedBy)).toBe(true);
      expect(Array.isArray(item.requiredContext)).toBe(true);
      expect(typeof item.sensitive).toBe('boolean');
    }
  });

  it('never declares payload or context fields that smell like secrets or raw prompts', () => {
    for (const item of LEADFLOW_EVENT_CATALOG) {
      for (const fieldName of Object.keys(item.payloadSchema)) {
        expect(fieldName).not.toMatch(FORBIDDEN_FIELD_PATTERN);
      }
      for (const contextKey of item.requiredContext) {
        expect(contextKey).not.toMatch(FORBIDDEN_FIELD_PATTERN);
      }
    }
  });

  it('filters by module and status', () => {
    const inboxEvents = listEvents({ moduleKey: 'leadflow.inbox' });
    expect(inboxEvents).toHaveLength(10);
    expect(
      inboxEvents.every((item) => item.moduleKey === 'leadflow.inbox'),
    ).toBe(true);

    const planned = listEvents({ status: LeadFlowEventStatus.Planned });
    expect(planned.map((item) => item.eventName).sort()).toEqual(
      [...PLANNED_EXECUTION_EVENTS].sort(),
    );
  });

  it('describes the structural Inbox → CRM rule with catalog events', () => {
    expect(
      LEADFLOW_EVENT_STRUCTURAL_RULE.everyConversationCreatesOpportunity,
    ).toBe(true);
    expect(LEADFLOW_EVENT_STRUCTURAL_RULE.relatedEvents).toEqual([
      'leadflow.inbox.conversation.created',
      'leadflow.crm.contact.created',
      'leadflow.crm.opportunity.created',
      'leadflow.crm.opportunity.linked_to_conversation',
    ]);
    for (const eventName of LEADFLOW_EVENT_STRUCTURAL_RULE.relatedEvents) {
      expect(getEventByName(eventName)).toBeDefined();
    }
  });

  it('maps automation triggers only to events that exist in the catalog', () => {
    for (const mapping of LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS) {
      if (mapping.eventName === null) {
        expect(mapping.status).toBe('planned');
      } else {
        expect(mapping.status).toBe('mapped');
        expect(getEventByName(mapping.eventName)).toBeDefined();
      }
    }
  });

  it('maps the Phase 9 appointment triggers to canonical calendar events', () => {
    expect(
      LEADFLOW_AUTOMATION_TRIGGER_EVENT_MAPPINGS.filter((mapping) =>
        [
          'appointment.created',
          'appointment.confirmation_pending',
          'appointment.no_show',
          'appointment.completed',
        ].includes(mapping.trigger),
      ).map(({ trigger, eventName, status }) => ({
        trigger,
        eventName,
        status,
      })),
    ).toEqual([
      {
        trigger: 'appointment.created',
        eventName: 'leadflow.calendar.appointment.created',
        status: 'mapped',
      },
      {
        trigger: 'appointment.confirmation_pending',
        eventName: 'leadflow.calendar.appointment.confirmation_pending',
        status: 'mapped',
      },
      {
        trigger: 'appointment.no_show',
        eventName: 'leadflow.calendar.appointment.no_show',
        status: 'mapped',
      },
      {
        trigger: 'appointment.completed',
        eventName: 'leadflow.calendar.appointment.completed',
        status: 'mapped',
      },
    ]);
  });
});
