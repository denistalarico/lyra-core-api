import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import { CrmStageTransitionPolicyService } from '../../crm/services/crm-stage-transition-policy.service';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';

/**
 * The first productive executor: a governed, non-terminal stage transition.
 *
 * It owns none of the rules. It resolves the target and reason from the
 * automation's configuration and calls the CRM's canonical stage-transition
 * command as the `automation` actor. That command re-reads the opportunity
 * under a lock, checks the expected version, and enforces the published
 * transition policy — allowed actor, reason code, required fields, and the
 * refusal of any terminal destination. So every safety rule lives in the domain
 * that owns the deal, and this executor cannot move a stage the operator's
 * policy did not authorise.
 *
 * Passing `expectedVersion` is how the revalidation obligation is met: the
 * decision was made against a version of the opportunity, and the command
 * refuses if it has moved since, closing the window between deciding and acting.
 */
@Injectable()
export class MoveOpportunityStageExecutor implements AutomationExecutor {
  readonly actionKey = 'move_opportunity_stage';

  constructor(
    private readonly crmCommand: CrmOpportunityCommandService,
    private readonly transitionPolicies: CrmStageTransitionPolicyService,
  ) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const payload = request.payload;
    const opportunityId = stringField(payload.opportunityId);
    let toStageId = stringField(payload.toStageId);
    let reasonCode = stringField(payload.reasonCode);

    // A destination and a governed reason are required. Without them the effect
    // is unconfigured, not failed — refusing is the honest outcome, and no
    // retry could supply what the configuration is missing.
    if (!opportunityId) {
      return {
        status: 'refused',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Permanent,
        errorCode: 'stage_transition_unconfigured',
        errorMessage:
          'A transição de etapa exige uma oportunidade configurada.',
        reference: null,
      };
    }

    const ctx: RequestContext = {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
    } as RequestContext;

    // New CRM-managed instances deliberately keep destination and reason out of
    // the automation JSON. The published stage rules are the single source of
    // truth, so the executor resolves the first eligible next stage at the last
    // responsible moment. Legacy instances with both values keep their exact
    // published behaviour.
    if (!toStageId && !reasonCode) {
      const eligible =
        await this.transitionPolicies.resolveEligibleAutomationDestination(
          ctx,
          opportunityId,
        );
      toStageId = eligible?.toStageId ?? null;
      reasonCode = eligible?.reasonCode ?? null;
    }

    if (!toStageId || !reasonCode) {
      return {
        status: 'refused',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Permanent,
        errorCode: 'stage_transition_requirements_not_met',
        errorMessage:
          'Nenhuma regra automática de estágio está configurada e atendida para esta oportunidade.',
        reference: null,
      };
    }

    try {
      const { opportunity } = await this.crmCommand.moveStage(
        ctx,
        opportunityId,
        toStageId,
        {
          actor: { type: 'automation' },
          // The revalidation: refuse if the opportunity moved since the decision.
          expectedVersion: request.revalidation.expectedVersion ?? undefined,
          reason: reasonCode,
          idempotencyKey: request.idempotencyKey,
          correlationId: request.correlationId,
        },
      );

      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: opportunity.id,
      };
    } catch (error) {
      // A governed refusal — stale version, terminal destination, a policy that
      // does not allow the automation actor, missing required fields — is a
      // clean "no", not a fault. Retrying with the same inputs cannot change it.
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        return {
          status: 'refused',
          effectConfirmed: false,
          errorClass: LeadFlowAutomationErrorClass.Permanent,
          errorCode: refusalCode(error),
          errorMessage: refusalMessage(error),
          reference: null,
        };
      }

      // Anything else — a database error, a lock timeout — may succeed on retry.
      return {
        status: 'failed',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Transient,
        errorCode: 'stage_transition_failed',
        errorMessage: 'A transição de etapa falhou por um erro transitório.',
        reference: null,
      };
    }
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** Reads the governed reason code out of the CRM exception, sanitized. */
function refusalCode(error: ConflictException | NotFoundException): string {
  const response = error.getResponse();
  if (typeof response === 'object' && response !== null) {
    const record = response as Record<string, unknown>;
    const code =
      typeof record.reasonCode === 'string'
        ? record.reasonCode
        : typeof record.code === 'string'
          ? record.code
          : null;
    if (code && /^[a-z0-9_.:-]{1,80}$/i.test(code)) return code;
  }
  return error instanceof NotFoundException
    ? 'opportunity_not_found'
    : 'stage_transition_blocked';
}

/** A business-facing message with no internal payload detail. */
function refusalMessage(error: ConflictException | NotFoundException): string {
  const response = error.getResponse();
  if (typeof response === 'object' && response !== null) {
    const message = (response as Record<string, unknown>).message;
    if (typeof message === 'string' && message.length <= 200) return message;
  }
  return 'A transição de etapa não foi permitida pela política vigente.';
}
