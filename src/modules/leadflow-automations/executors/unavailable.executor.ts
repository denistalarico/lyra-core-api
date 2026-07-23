import type { LeadFlowAutomationDependency } from '../enums/leadflow-automation-dependency.enum';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
  AutomationExecutorUnavailableReason,
} from './automation-executor.types';

/**
 * An executor that is declared but cannot run.
 *
 * Every action in the catalog gets one of these until a real adapter replaces
 * it. Refusing explicitly — rather than leaving the action unregistered — means
 * the engine, the dry-run and the UI can all state precisely *why* an effect
 * would not happen, instead of failing with "unknown action" or, worse,
 * silently doing nothing.
 *
 * The refusal is classified `Permanent` on purpose: retrying cannot make a
 * missing capability appear, so a retry loop would only burn attempts.
 */
export class UnavailableExecutor implements AutomationExecutor {
  constructor(
    readonly actionKey: string,
    private readonly reason: AutomationExecutorUnavailableReason,
    private readonly owningDomain: string,
    private readonly description: string,
    private readonly dependency: LeadFlowAutomationDependency | null = null,
  ) {}

  availability(): AutomationExecutorAvailability {
    return {
      actionKey: this.actionKey,
      available: false,
      reason: this.reason,
      dependency: this.dependency,
      owningDomain: this.owningDomain,
      description: this.description,
    };
  }

  execute(request: AutomationEffectRequest): Promise<AutomationEffectResult> {
    return Promise.resolve({
      status: 'unavailable',
      // Never true here. Nothing was asked of any domain.
      effectConfirmed: false,
      errorClass: LeadFlowAutomationErrorClass.Permanent,
      errorCode:
        this.reason === 'dependency_missing'
          ? 'executor_dependency_missing'
          : 'executor_not_implemented',
      errorMessage: `Nenhum executor disponível para "${request.actionKey}": ${this.description}`,
      reference: null,
    });
  }
}
