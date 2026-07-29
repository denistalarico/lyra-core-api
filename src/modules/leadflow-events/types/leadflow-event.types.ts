import type {
  LeadFlowAutomationTrigger,
  LeadFlowJsonObject,
  LeadFlowJsonValue,
} from '../../leadflow-automations/types/leadflow-automation.types';
import { LeadFlowEventStatus } from '../enums/leadflow-event-status.enum';

/**
 * LeadFlow Event Contract (blueprint
 * docs/blueprints/architecture/leadflow-event-contract-blueprint.md).
 *
 * Contract-only layer: these types define what an event looks like — nothing
 * here emits, persists, queues or executes anything. "Evento não é execução."
 */

export const LEADFLOW_EVENT_PRODUCT_KEY = 'leadflow' as const;
export type LeadFlowEventProductKey = typeof LEADFLOW_EVENT_PRODUCT_KEY;

/** Module keys that may emit LeadFlow events (blueprint section 4). */
export type LeadFlowEventModuleKey =
  | 'leadflow.inbox'
  | 'leadflow.crm'
  | 'leadflow.agents'
  | 'leadflow.automations'
  | 'leadflow.calendar'
  | 'leadflow.settings';

export const LEADFLOW_EVENT_MODULE_KEYS: LeadFlowEventModuleKey[] = [
  'leadflow.inbox',
  'leadflow.crm',
  'leadflow.agents',
  'leadflow.automations',
  'leadflow.calendar',
  'leadflow.settings',
];

/**
 * Stable, versioned event names following `leadflow.<module>.<resource>.<action>`
 * (blueprint section 8). Names never change; incompatible payload changes bump
 * `eventVersion` instead.
 */
export type LeadFlowEventName =
  // Inbox
  | 'leadflow.inbox.conversation.created'
  | 'leadflow.inbox.conversation.updated'
  | 'leadflow.inbox.conversation.message.received'
  | 'leadflow.inbox.conversation.message.sent'
  | 'leadflow.inbox.conversation.idle'
  | 'leadflow.inbox.conversation.assigned'
  | 'leadflow.inbox.conversation.handoff.requested'
  | 'leadflow.inbox.business_hours.closed'
  | 'leadflow.inbox.conversation.handoff.accepted'
  | 'leadflow.inbox.conversation.closed'
  // CRM / Leads
  | 'leadflow.crm.opportunity.created'
  | 'leadflow.crm.opportunity.copied'
  | 'leadflow.crm.opportunity.reconverted'
  | 'leadflow.crm.opportunity.updated'
  | 'leadflow.crm.opportunity.stage.changed'
  | 'leadflow.crm.opportunity.pipeline.exited'
  | 'leadflow.crm.opportunity.stage.exited'
  | 'leadflow.crm.opportunity.pipeline.transferred'
  | 'leadflow.crm.opportunity.pipeline.entered'
  | 'leadflow.crm.opportunity.stage.entered'
  | 'leadflow.crm.opportunity.score.changed'
  | 'leadflow.crm.opportunity.hot_lead_detected'
  | 'leadflow.crm.opportunity.status.changed'
  | 'leadflow.crm.opportunity.owner.changed'
  | 'leadflow.crm.opportunity.autonomy_mode.changed'
  | 'leadflow.crm.opportunity.won'
  | 'leadflow.crm.opportunity.lost'
  | 'leadflow.crm.opportunity.idle'
  | 'leadflow.crm.opportunity.linked_to_conversation'
  | 'leadflow.crm.contact.created'
  | 'leadflow.crm.contact.updated'
  // Agents
  | 'leadflow.agents.agent.provisioned'
  | 'leadflow.agents.agent.updated'
  | 'leadflow.agents.agent.activated'
  | 'leadflow.agents.agent.paused'
  | 'leadflow.agents.agent.published'
  | 'leadflow.agents.runtime.config.updated'
  // Automations (config lifecycle)
  | 'leadflow.automations.automation.provisioned'
  | 'leadflow.automations.automation.updated'
  | 'leadflow.automations.automation.activated'
  | 'leadflow.automations.automation.paused'
  | 'leadflow.automations.automation.published'
  | 'leadflow.automations.runtime.config.updated'
  // Automations (future execution — planned, never emitted this sprint)
  | 'leadflow.automations.execution.eligible'
  | 'leadflow.automations.execution.started'
  | 'leadflow.automations.execution.completed'
  | 'leadflow.automations.execution.failed'
  | 'leadflow.automations.execution.skipped'
  // Automations (feedback outcome and recurring schedule)
  | 'leadflow.automations.csat.response.recorded'
  | 'leadflow.automations.schedule.daily'
  // Calendar / Agenda
  | 'leadflow.calendar.appointment.created'
  | 'leadflow.calendar.appointment.updated'
  | 'leadflow.calendar.appointment.confirmation_pending'
  | 'leadflow.calendar.appointment.confirmed'
  | 'leadflow.calendar.appointment.cancelled'
  | 'leadflow.calendar.appointment.no_show'
  | 'leadflow.calendar.appointment.completed'
  | 'leadflow.calendar.appointment.reminder_due'
  // Settings
  | 'leadflow.settings.business_mode.changed'
  | 'leadflow.settings.client_prompt_config.updated'
  | 'leadflow.settings.integration.enabled'
  | 'leadflow.settings.integration.disabled'
  | 'leadflow.settings.handoff_rules.updated'
  | 'leadflow.settings.business_hours.updated';

export type LeadFlowEventActorType =
  | 'user'
  | 'agent'
  | 'system'
  | 'contact'
  | 'external';

export const LEADFLOW_EVENT_ACTOR_TYPES: LeadFlowEventActorType[] = [
  'user',
  'agent',
  'system',
  'contact',
  'external',
];

/** Entity that originated the event (blueprint section 6). */
export interface LeadFlowEventSource {
  /** Short module name, e.g. `inbox`, `crm`. */
  module: string;
  /** Entity type, e.g. `conversation`, `opportunity`, `appointment`. */
  entityType: string;
  /** Entity id (uuid). */
  entityId: string;
}

/** Who caused the event. Optional in the envelope (blueprint section 7). */
export interface LeadFlowEventActor {
  type: LeadFlowEventActorType;
  id?: string | null;
  displayName?: string | null;
}

/** Correlation chain for future tracing/dedupe (blueprint section 6). */
export interface LeadFlowEventCorrelation {
  correlationId: string;
  causationId?: string | null;
  sourceEventId?: string | null;
}

/**
 * LeadFlow-specific context ids carried alongside the payload. All fields are
 * optional at the type level; each catalog item declares which ones it
 * requires via `requiredContext`.
 */
export interface LeadFlowEventContext {
  businessModeKey?: string;
  leadflowSettingsId?: string;
  conversationId?: string;
  contactId?: string;
  opportunityId?: string;
  agentId?: string;
  automationId?: string;
  appointmentId?: string;
  csatResponseId?: string;
  [key: string]: LeadFlowJsonValue | undefined;
}

/** Envelope metadata for versioning, dedupe and sensitivity flags. */
export interface LeadFlowEventMetadata {
  schemaVersion: number;
  dedupeKey?: string | null;
  sensitive?: boolean;
  [key: string]: LeadFlowJsonValue | undefined;
}

/**
 * Standard envelope every LeadFlow event must follow (blueprint section 6).
 * Required fields per section 7; `actor` and `context` are optional.
 */
export interface LeadFlowEventEnvelope {
  eventId: string;
  eventName: LeadFlowEventName;
  eventVersion: number;
  occurredAt: string;
  tenantId: string;
  workspaceId: string;
  productKey: LeadFlowEventProductKey;
  moduleKey: LeadFlowEventModuleKey;
  source: LeadFlowEventSource;
  actor?: LeadFlowEventActor | null;
  correlation: LeadFlowEventCorrelation;
  context?: LeadFlowEventContext | null;
  payload: LeadFlowJsonObject;
  metadata: LeadFlowEventMetadata;
}

export type LeadFlowEventPayloadFieldType =
  | 'string'
  | 'number'
  | 'boolean'
  | 'object'
  | 'array';

/** Lightweight, JSON-serializable description of one payload field. */
export interface LeadFlowEventPayloadField {
  type: LeadFlowEventPayloadFieldType;
  required: boolean;
  description: string;
}

export type LeadFlowEventPayloadSchema = Record<
  string,
  LeadFlowEventPayloadField
>;

/** One event contract in the catalog (blueprint section 10). */
export interface LeadFlowEventCatalogItem {
  eventName: LeadFlowEventName;
  eventVersion: number;
  moduleKey: LeadFlowEventModuleKey;
  resource: string;
  action: string;
  description: string;
  /** Context ids that MUST be present in `context` for this event. */
  requiredContext: (keyof LeadFlowEventContext & string)[];
  payloadSchema: LeadFlowEventPayloadSchema;
  /** Module key (or `system` scheduler) expected to emit this event. */
  emittedBy: string;
  /** Declared consumers; each consumer owns its delivery and execution state. */
  consumedBy: string[];
  sensitive: boolean;
  status: LeadFlowEventStatus;
}

/** Structural Inbox → CRM rule surfaced by the contract (blueprint section 5). */
export interface LeadFlowEventStructuralRule {
  everyConversationCreatesOpportunity: true;
  description: string;
  relatedEvents: LeadFlowEventName[];
}

/**
 * Contract-level bridge between Automations triggers and catalog events
 * (blueprint section 12). `eventName: null` means the trigger has no event
 * counterpart yet — mapping is planned, never executed.
 */
export interface LeadFlowEventTriggerMapping {
  trigger: LeadFlowAutomationTrigger;
  eventName: LeadFlowEventName | null;
  status: 'mapped' | 'planned';
  notes?: string;
}

/** Description of one envelope field, used by the runtime contract. */
export interface LeadFlowEventEnvelopeFieldSpec {
  field: string;
  type: string;
  required: boolean;
  description: string;
}

/** What events must never carry (blueprint section 14). */
export interface LeadFlowEventSensitiveDataPolicy {
  forbidden: string[];
  guidance: string[];
}

/** Runtime capability flags returned by the event contract. */
export interface LeadFlowEventUnsupportedExecutionNotice {
  message: string;
  eventBus: true;
  persistence: true;
  execution: false;
  redis: false;
  temporal: false;
  n8n: false;
  llm: false;
}

/**
 * Full event runtime contract consumers use to understand the LeadFlow event
 * surface. Generating the contract itself has no side effects.
 */
export interface LeadFlowEventRuntimeContract {
  productKey: LeadFlowEventProductKey;
  version: number;
  generatedAt: string;
  namingConvention: string;
  envelopeSchema: LeadFlowEventEnvelopeFieldSpec[];
  catalog: LeadFlowEventCatalogItem[];
  structuralRules: LeadFlowEventStructuralRule;
  automationTriggerMappings: LeadFlowEventTriggerMapping[];
  sensitiveDataPolicy: LeadFlowEventSensitiveDataPolicy;
  unsupportedExecutionNotice: LeadFlowEventUnsupportedExecutionNotice;
}
