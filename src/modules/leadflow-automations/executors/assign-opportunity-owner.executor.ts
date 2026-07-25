import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import type { LeadDistributionStrategy } from '../../crm/services/lead-distribution.strategy';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';

const STRATEGIES: readonly LeadDistributionStrategy[] = [
  'least_volume',
  'round_robin',
  'by_channel',
];

/**
 * The second productive executor: distributing a new lead to a participant.
 *
 * Like the stage-move executor, it owns none of the rules. It resolves the
 * strategy and its inputs from the automation's configuration and calls the
 * CRM's canonical `distributeOpportunityOwner` command as the `automation`
 * actor. That command re-reads the opportunity under a lock, checks the expected
 * version, and enforces the only-open-and-unclaimed rule and the pipeline's own
 * participant pool. So this cannot assign a lead a human already owns, and the
 * revalidation window between deciding and acting stays closed.
 */
@Injectable()
export class AssignOpportunityOwnerExecutor implements AutomationExecutor {
  readonly actionKey = 'assign_opportunity_owner';

  constructor(private readonly crmCommand: CrmOpportunityCommandService) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const payload = request.payload;
    const opportunityId = stringField(payload.opportunityId);
    if (!opportunityId) {
      return {
        status: 'refused',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Permanent,
        errorCode: 'lead_distribution_unconfigured',
        errorMessage:
          'A distribuição de lead exige uma oportunidade de destino.',
        reference: null,
      };
    }

    const ctx: RequestContext = {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
    } as RequestContext;

    try {
      const result = await this.crmCommand.distributeOpportunityOwner(
        ctx,
        opportunityId,
        {
          strategy: resolveStrategy(payload.strategy),
          channelMap: recordField(payload.channelMap),
          fallbackUserId: stringField(payload.fallbackUserId),
        },
        {
          actor: { type: 'automation' },
          // The revalidation: refuse if the opportunity moved since the decision.
          expectedVersion: request.revalidation.expectedVersion ?? undefined,
          idempotencyKey: request.idempotencyKey,
          correlationId: request.correlationId,
        },
      );

      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: result.assignedUserId || result.opportunity.id,
      };
    } catch (error) {
      // A governed refusal — already assigned, no eligible participant, a stale
      // version, a closed deal — is a clean "no", not a fault. A retry with the
      // same inputs cannot change it.
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

      return {
        status: 'failed',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Transient,
        errorCode: 'lead_distribution_failed',
        errorMessage: 'A distribuição de lead falhou por um erro transitório.',
        reference: null,
      };
    }
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A recognised strategy, defaulting to the safe load-balancing one. */
function resolveStrategy(value: unknown): LeadDistributionStrategy {
  return typeof value === 'string' &&
    (STRATEGIES as readonly string[]).includes(value)
    ? (value as LeadDistributionStrategy)
    : 'least_volume';
}

function recordField(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return undefined;
  }
  const out: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value as Record<string, unknown>)) {
    if (typeof entry === 'string') out[key] = entry;
  }
  return out;
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
    : 'lead_distribution_blocked';
}

/** A business-facing message with no internal payload detail. */
function refusalMessage(error: ConflictException | NotFoundException): string {
  const response = error.getResponse();
  if (typeof response === 'object' && response !== null) {
    const message = (response as Record<string, unknown>).message;
    if (typeof message === 'string' && message.length <= 200) return message;
  }
  return 'A distribuição de lead não foi permitida pela política vigente.';
}
