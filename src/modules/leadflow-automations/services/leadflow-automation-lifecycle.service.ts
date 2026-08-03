import { Injectable } from '@nestjs/common';
import {
  findUnmetDependencies,
  isRuntimeAvailable,
  type LeadFlowAutomationUnmetDependency,
} from '../catalog/automation-dependencies.registry';
import type { LeadFlowAutomationRecipeCatalogItem } from '../catalog/automation-recipes.catalog';
import { LeadFlowAutomationLifecycleState } from '../enums/leadflow-automation-lifecycle-state.enum';
import { LeadFlowAutomationStatus } from '../enums/leadflow-automation-status.enum';
import type { AutomationExecutorAvailability } from '../executors';

export interface LeadFlowAutomationLifecycle {
  /** Effective state shown to the operator. Derived, never persisted. */
  state: LeadFlowAutomationLifecycleState;
  /** Persisted operator intent, kept for transparency. */
  status: LeadFlowAutomationStatus;
  /** Whether the automation may be switched on right now. */
  canActivate: boolean;
  /** Business-language explanation when `canActivate` is false. */
  blockedReason: string | null;
  unmetDependencies: LeadFlowAutomationUnmetDependency[];
  /** Published effects for which no productive adapter is wired yet. */
  unavailableActions: AutomationExecutorAvailability[];
  /** `section.key` paths of required configuration that is still empty. */
  missingConfiguration: string[];
  /** False while the platform has no execution engine at all. */
  runtimeAvailable: boolean;
}

export interface LeadFlowAutomationLifecycleInput {
  status: LeadFlowAutomationStatus;
  recipe: LeadFlowAutomationRecipeCatalogItem | undefined;
  /** False when the instance's Business Mode no longer matches the recipe. */
  compatibleWithBusinessMode: boolean;
  /** An activation always runs an immutable published snapshot. */
  hasPublishedVersion?: boolean;
  missingConfiguration: string[];
  unavailableActions?: AutomationExecutorAvailability[];
}

const UNKNOWN_RECIPE_REASON =
  'Esta automação usa uma receita que não existe mais no catálogo.';

/**
 * Derives the effective lifecycle state of an automation.
 *
 * The reason this is computed rather than stored: before dependency gating
 * existed, an operator could switch an automation to `active` even though no
 * runtime would ever read it. Those rows are still in the database. Deriving the
 * state means such a row is reported as `blocked_by_dependency` — the switch
 * cannot keep promising execution that never happens — without rewriting
 * operator data.
 *
 * Precedence, highest first:
 *   deprecated > blocked_by_dependency > error > requires_configuration >
 *   paused > active > ready > draft
 */
@Injectable()
export class LeadFlowAutomationLifecycleService {
  evaluate(
    input: LeadFlowAutomationLifecycleInput,
  ): LeadFlowAutomationLifecycle {
    const { status, recipe, compatibleWithBusinessMode } = input;
    // Abstract recipe callers predate publishing; real instances always pass
    // this field explicitly from `publishedVersionId`.
    const hasPublishedVersion = input.hasPublishedVersion ?? true;
    const missingConfiguration = [...input.missingConfiguration];
    const unavailableActions = [...(input.unavailableActions ?? [])];
    const runtimeAvailable = isRuntimeAvailable();

    if (!recipe) {
      return {
        state: LeadFlowAutomationLifecycleState.Deprecated,
        status,
        canActivate: false,
        blockedReason: UNKNOWN_RECIPE_REASON,
        unmetDependencies: [],
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    const unmetDependencies = findUnmetDependencies(
      recipe.requiredDependencies,
    );

    if (recipe.deprecated) {
      return {
        state: LeadFlowAutomationLifecycleState.Deprecated,
        status,
        canActivate: false,
        blockedReason:
          'Esta automação foi descontinuada e não pode mais ser ativada.',
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    // A missing platform capability outranks configuration problems: fixing the
    // form would not make it run, so telling the operator to fix the form lies.
    if (unmetDependencies.length > 0) {
      return {
        state: LeadFlowAutomationLifecycleState.BlockedByDependency,
        status,
        canActivate: false,
        blockedReason: unmetDependencies[0].reason,
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    if (unavailableActions.length > 0) {
      return {
        state: LeadFlowAutomationLifecycleState.BlockedByDependency,
        status,
        canActivate: false,
        blockedReason: unavailableActions[0].description,
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    if (status === LeadFlowAutomationStatus.Error) {
      return {
        state: LeadFlowAutomationLifecycleState.Error,
        status,
        canActivate: false,
        blockedReason:
          'A última execução falhou. Revise a configuração antes de reativar.',
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    if (!compatibleWithBusinessMode) {
      return {
        state: LeadFlowAutomationLifecycleState.RequiresConfiguration,
        status,
        canActivate: false,
        blockedReason:
          'Esta automação não é compatível com o Business Mode ativo.',
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    if (missingConfiguration.length > 0) {
      return {
        state: LeadFlowAutomationLifecycleState.RequiresConfiguration,
        status,
        canActivate: false,
        blockedReason: 'Faltam informações obrigatórias na configuração.',
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    if (!hasPublishedVersion) {
      return {
        state: LeadFlowAutomationLifecycleState.RequiresConfiguration,
        status,
        canActivate: false,
        blockedReason:
          'Publique uma versão da automação antes de ativá-la.',
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    if (status === LeadFlowAutomationStatus.Archived) {
      return {
        state: LeadFlowAutomationLifecycleState.Deprecated,
        status,
        canActivate: false,
        blockedReason: 'Esta automação foi arquivada.',
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    if (status === LeadFlowAutomationStatus.Paused) {
      return {
        state: LeadFlowAutomationLifecycleState.Paused,
        status,
        canActivate: true,
        blockedReason: null,
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    if (status === LeadFlowAutomationStatus.Active) {
      return {
        state: LeadFlowAutomationLifecycleState.Active,
        status,
        canActivate: false,
        blockedReason: null,
        unmetDependencies,
        unavailableActions,
        missingConfiguration,
        runtimeAvailable,
      };
    }

    // Draft with everything satisfied: eligible, waiting on the operator.
    return {
      state: LeadFlowAutomationLifecycleState.Ready,
      status,
      canActivate: true,
      blockedReason: null,
      unmetDependencies,
      unavailableActions,
      missingConfiguration,
      runtimeAvailable,
    };
  }
}
