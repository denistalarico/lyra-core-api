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
 * Domain-command capabilities may be true even while trigger delivery remains
 * unavailable. `isRuntimeAvailable` therefore checks ingress/runtime
 * capabilities specifically instead of treating one callable command as a
 * complete automation engine.
 */
export const LEADFLOW_AUTOMATION_SATISFIED_DEPENDENCIES: Record<
  LeadFlowAutomationDependency,
  boolean
> = {
  [LeadFlowAutomationDependency.EventFanOut]: false,
  [LeadFlowAutomationDependency.SchedulerRuntime]: false,
  [LeadFlowAutomationDependency.MessageGeneration]: false,
  [LeadFlowAutomationDependency.OwnershipCommand]: false,
  [LeadFlowAutomationDependency.PipelineTransferCommand]: true,
  [LeadFlowAutomationDependency.StageTransitionCommand]: true,
  [LeadFlowAutomationDependency.OpportunityCopyCommand]: true,
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
 * True only when some trigger-delivery runtime exists. Canonical domain
 * commands alone do not make configured recipes run automatically.
 */
export function isRuntimeAvailable(): boolean {
  return (
    isDependencySatisfied(LeadFlowAutomationDependency.EventFanOut) ||
    isDependencySatisfied(LeadFlowAutomationDependency.SchedulerRuntime) ||
    isDependencySatisfied(LeadFlowAutomationDependency.WebhookDispatch)
  );
}
