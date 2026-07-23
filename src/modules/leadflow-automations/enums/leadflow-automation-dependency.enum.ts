/**
 * Platform capabilities an automation recipe needs before it can actually run.
 *
 * Every recipe declares the dependencies it consumes. A dependency that is not
 * satisfied makes the automation *structurally* unable to execute — no amount
 * of configuration fixes it — so the lifecycle reports `blocked_by_dependency`
 * and activation is refused. This is what keeps the on/off switch honest: it
 * may only promise execution that the platform can actually deliver.
 *
 * Ownership of each dependency is recorded here on purpose. Automations does
 * not build these; it consumes them.
 */
export enum LeadFlowAutomationDependency {
  /**
   * Durable event fan-out with independent per-consumer delivery.
   * Owned by the CRM/Inbox structural evolution track. Phase 9 adds an atomic,
   * consumer-specific delivery alongside the realtime relay.
   */
  EventFanOut = 'event_fan_out',

  /**
   * Durable timers/scheduler able to survive restarts, cancel and reschedule.
   * Owned by Automations, planned for a later phase.
   */
  SchedulerRuntime = 'scheduler_runtime',

  /**
   * Contract with Agents to generate contextual copy, plus canonical dispatch
   * through Inbox. Automations never sends through a provider itself.
   */
  MessageGeneration = 'message_generation',

  /**
   * Canonical ownership/assignment command. Owned by the CRM structural track.
   * Automations only selects a strategy and calls the command.
   */
  OwnershipCommand = 'ownership_command',

  /**
   * Canonical pipeline transfer command (same opportunity, atomic pipeline +
   * stage change). Owned by the CRM structural track.
   */
  PipelineTransferCommand = 'pipeline_transfer_command',

  /** Canonical, policy-governed stage transition command owned by CRM. */
  StageTransitionCommand = 'stage_transition_command',

  /** Canonical opportunity-copy command with explicit lineage owned by CRM. */
  OpportunityCopyCommand = 'opportunity_copy_command',

  /**
   * The LeadFlow Agenda domain and its canonical appointment events. The legacy
   * Appointments module and the Agency Calendar are explicitly NOT this
   * dependency — Automations consumes Agenda events only.
   */
  AgendaDomain = 'agenda_domain',

  /**
   * Analytics backend providing deterministic, permission-scoped figures.
   * No provisional read is allowed as a substitute.
   */
  AnalyticsBackend = 'analytics_backend',

  /** Quotes domain events (out of the LeadFlow v1 event contract). */
  QuotesDomain = 'quotes_domain',

  /** Detector that decides when required fields/documents are missing. */
  MissingFieldsDetector = 'missing_fields_detector',

  /**
   * Deterministic lead scoring owned by the CRM: current score on the
   * opportunity, explainable breakdown, policy version, historical snapshots
   * and canonical `score.changed` / hot-lead emission.
   *
   * Recorded as a dependency rather than a missing field because the absence is
   * structural — no column, no emitter, no policy. Automations consumes the
   * score and must never derive one, so any condition needing it fails closed
   * until the CRM ships it.
   */
  LeadScoreEngine = 'lead_score_engine',

  /** Outbound webhook dispatch with SSRF protection, signing and retries. */
  WebhookDispatch = 'webhook_dispatch',
}

/** Who is responsible for delivering each dependency. */
export const LEADFLOW_AUTOMATION_DEPENDENCY_OWNERS: Record<
  LeadFlowAutomationDependency,
  string
> = {
  [LeadFlowAutomationDependency.EventFanOut]: 'crm_inbox_structural_track',
  [LeadFlowAutomationDependency.SchedulerRuntime]: 'leadflow_automations',
  [LeadFlowAutomationDependency.MessageGeneration]: 'leadflow_agents_and_inbox',
  [LeadFlowAutomationDependency.OwnershipCommand]: 'crm_structural_track',
  [LeadFlowAutomationDependency.PipelineTransferCommand]:
    'crm_structural_track',
  [LeadFlowAutomationDependency.StageTransitionCommand]: 'crm_structural_track',
  [LeadFlowAutomationDependency.OpportunityCopyCommand]: 'crm_structural_track',
  [LeadFlowAutomationDependency.AgendaDomain]: 'leadflow_agenda_domain',
  [LeadFlowAutomationDependency.AnalyticsBackend]: 'leadflow_analytics',
  [LeadFlowAutomationDependency.QuotesDomain]: 'quotes_domain',
  [LeadFlowAutomationDependency.MissingFieldsDetector]: 'leadflow_crm',
  [LeadFlowAutomationDependency.LeadScoreEngine]: 'leadflow_crm',
  [LeadFlowAutomationDependency.WebhookDispatch]: 'leadflow_automations',
};

/** Short, business-facing explanation shown when a dependency blocks an automation. */
export const LEADFLOW_AUTOMATION_DEPENDENCY_LABELS: Record<
  LeadFlowAutomationDependency,
  string
> = {
  [LeadFlowAutomationDependency.EventFanOut]:
    'Entrega durável de eventos ainda não disponível na plataforma.',
  [LeadFlowAutomationDependency.SchedulerRuntime]:
    'Agendamento durável de execuções ainda não disponível.',
  [LeadFlowAutomationDependency.MessageGeneration]:
    'Geração e envio canônico de mensagens ainda não disponíveis.',
  [LeadFlowAutomationDependency.OwnershipCommand]:
    'Atribuição canônica de responsável ainda não disponível.',
  [LeadFlowAutomationDependency.PipelineTransferCommand]:
    'Transferência canônica de pipeline ainda não disponível.',
  [LeadFlowAutomationDependency.StageTransitionCommand]:
    'Transição canônica de etapa ainda não disponível.',
  [LeadFlowAutomationDependency.OpportunityCopyCommand]:
    'Cópia canônica de oportunidade ainda não disponível.',
  [LeadFlowAutomationDependency.AgendaDomain]:
    'Domínio de Agenda do LeadFlow ainda não disponível.',
  [LeadFlowAutomationDependency.AnalyticsBackend]:
    'Analytics ainda não disponível para fornecer números confiáveis.',
  [LeadFlowAutomationDependency.QuotesDomain]:
    'Domínio de Orçamentos ainda não disponível.',
  [LeadFlowAutomationDependency.MissingFieldsDetector]:
    'Detecção de campos/documentos obrigatórios ainda não disponível.',
  [LeadFlowAutomationDependency.LeadScoreEngine]:
    'Pontuação de leads ainda não é calculada pelo CRM.',
  [LeadFlowAutomationDependency.WebhookDispatch]:
    'Disparo de webhooks ainda não disponível.',
};
