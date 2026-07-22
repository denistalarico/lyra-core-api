import {
  LEADFLOW_AUTOMATION_DEPENDENCY_LABELS,
  LeadFlowAutomationDependency,
} from '../enums/leadflow-automation-dependency.enum';

/**
 * Which platform capabilities are actually available right now.
 *
 * This registry is the single source of truth for "can anything run at all?".
 * It is deliberately a hand-maintained constant rather than a runtime probe:
 * flipping a flag here is an explicit, reviewable decision that must be made in
 * the same change that ships the capability — never a side effect.
 *
 * Every value is `false` today. LeadFlow Automations is a configuration control
 * plane with no execution engine: there is no durable event fan-out, no
 * scheduler, no executor, and no dispatch path. Anything that claims otherwise
 * in the UI would be lying to the operator.
 */
export const LEADFLOW_AUTOMATION_SATISFIED_DEPENDENCIES: Record<
  LeadFlowAutomationDependency,
  boolean
> = {
  [LeadFlowAutomationDependency.EventFanOut]: false,
  [LeadFlowAutomationDependency.SchedulerRuntime]: false,
  [LeadFlowAutomationDependency.MessageGeneration]: false,
  [LeadFlowAutomationDependency.OwnershipCommand]: false,
  [LeadFlowAutomationDependency.PipelineTransferCommand]: false,
  [LeadFlowAutomationDependency.AgendaDomain]: false,
  [LeadFlowAutomationDependency.AnalyticsBackend]: false,
  [LeadFlowAutomationDependency.QuotesDomain]: false,
  [LeadFlowAutomationDependency.MissingFieldsDetector]: false,
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
 * True when the platform can execute *nothing*. Used to explain the global
 * situation once, instead of repeating the same blocker on every card.
 */
export function isRuntimeAvailable(): boolean {
  return Object.values(LEADFLOW_AUTOMATION_SATISFIED_DEPENDENCIES).some(
    Boolean,
  );
}
