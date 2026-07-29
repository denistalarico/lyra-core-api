import {
  LEADFLOW_AUTOMATION_DEPENDENCY_LABELS,
  LeadFlowAutomationDependency,
} from '../enums/leadflow-automation-dependency.enum';
import { hasAvailableExecutor } from '../executors';

/**
 * Which platform capabilities are actually available right now.
 *
 * This registry is the single source of truth for "can anything run at all?".
 * It is deliberately a hand-maintained constant rather than a runtime probe:
 * flipping a flag here is an explicit, reviewable decision that must be made in
 * the same change that ships the capability — never a side effect.
 *
 * Domain-command capabilities may be true even while trigger delivery remains
 * unavailable. `isRuntimeAvailable` therefore checks ingress/runtime
 * capabilities specifically instead of treating one callable command as a
 * complete automation engine.
 */
export const LEADFLOW_AUTOMATION_SATISFIED_DEPENDENCIES: Record<
  LeadFlowAutomationDependency,
  boolean
> = {
  [LeadFlowAutomationDependency.EventFanOut]: true,
  // Fase 6A: PostgreSQL timers + durable poller implement the approved D2 port.
  [LeadFlowAutomationDependency.SchedulerRuntime]: true,
  // Fase 6C: static/template outbound is available through the Inbox command.
  // LLM copy generation is not implied; baseMessage/templateRef remain config.
  [LeadFlowAutomationDependency.MessageGeneration]: true,
  // The canonical inbox ownership/handoff command reached Automations in Fase 5A
  // (RequestHandoffExecutor drives ConversationOwnershipService.requestHandoff).
  [LeadFlowAutomationDependency.OwnershipCommand]: true,
  // The canonical CRM lead-distribution command shipped in Fase 4A.
  [LeadFlowAutomationDependency.LeadDistributionCommand]: true,
  [LeadFlowAutomationDependency.PipelineTransferCommand]: true,
  [LeadFlowAutomationDependency.StageTransitionCommand]: true,
  [LeadFlowAutomationDependency.OpportunityCopyCommand]: true,
  // Fase 9 ported the Agenda into the Agency and made `AppointmentsService`
  // publish `appointment.*` transactionally; Fase 10 connected those events to
  // the automations that consume them. The commitment is now readable, its
  // lifecycle canonical, and its links to conversation and opportunity are
  // written by the domain itself.
  [LeadFlowAutomationDependency.AgendaDomain]: true,
  [LeadFlowAutomationDependency.AnalyticsBackend]: false,
  [LeadFlowAutomationDependency.QuotesDomain]: false,
  [LeadFlowAutomationDependency.MissingFieldsDetector]: false,
  [LeadFlowAutomationDependency.LeadScoreEngine]: true,
  [LeadFlowAutomationDependency.WebhookDispatch]: false,
};

export interface LeadFlowAutomationUnmetDependency {
  dependency: LeadFlowAutomationDependency;
  reason: string;
}

export function isDependencySatisfied(
  dependency: LeadFlowAutomationDependency,
): boolean {
  return LEADFLOW_AUTOMATION_SATISFIED_DEPENDENCIES[dependency] === true;
}

/** Unmet dependencies for a recipe, in declaration order. */
export function findUnmetDependencies(
  required: readonly LeadFlowAutomationDependency[],
): LeadFlowAutomationUnmetDependency[] {
  return required
    .filter((dependency) => !isDependencySatisfied(dependency))
    .map((dependency) => ({
      dependency,
      reason: LEADFLOW_AUTOMATION_DEPENDENCY_LABELS[dependency],
    }));
}

/**
 * True only when some trigger-delivery runtime and at least one productive
 * action executor exist. Ingress alone must not make the UI promise execution.
 */
export function isRuntimeAvailable(): boolean {
  const triggerDeliveryAvailable =
    isDependencySatisfied(LeadFlowAutomationDependency.EventFanOut) ||
    isDependencySatisfied(LeadFlowAutomationDependency.SchedulerRuntime) ||
    isDependencySatisfied(LeadFlowAutomationDependency.WebhookDispatch);
  return triggerDeliveryAvailable && hasAvailableExecutor();
}
