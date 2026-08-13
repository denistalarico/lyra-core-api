import {
  ConflictException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { CrmOpportunityCommandService } from '../../crm/services/crm-opportunity-command.service';
import type { LeadDistributionStrategy } from '../../crm/services/lead-distribution.strategy';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationNotificationPublisher } from '../services/leadflow-automation-notification.publisher';
import type { HotLeadNotificationChannel } from '../services/leadflow-automation-notification.publisher';
import type { LeadFlowJsonObject } from '../types/leadflow-automation.types';
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
 *
 * Once the lead has an owner, that person is told. Being handed a lead nobody
 * announced is the same as not being handed one, and the CRM's own assignment
 * notification only covers the manual handover — the governed distribution
 * command deliberately raises no notification of its own.
 */
@Injectable()
export class AssignOpportunityOwnerExecutor implements AutomationExecutor {
  readonly actionKey = 'assign_opportunity_owner';
  private readonly logger = new Logger(AssignOpportunityOwnerExecutor.name);

  constructor(
    private readonly crmCommand: CrmOpportunityCommandService,
    private readonly notifications: LeadFlowAutomationNotificationPublisher,
  ) {}

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

      const notice = await this.announce(request, opportunityId, result.assignedUserId);

      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: result.assignedUserId || result.opportunity.id,
        details: notice ? { notice } : undefined,
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

  /**
   * Tells the new owner, over the channels the automation configures.
   *
   * The lead already has its owner when this runs, and that is the effect this
   * executor confirms. So the announcement is a child outcome: a provider that
   * is down, a channel the recipient silenced or a template Meta has not
   * approved is reported in `details` and never undoes — or retries — the
   * distribution itself.
   */
  private async announce(
    request: AutomationEffectRequest,
    opportunityId: string,
    assignedUserId: string | null,
  ): Promise<LeadFlowJsonObject | null> {
    const channels = channelList(request.payload.notificationChannels);
    if (!assignedUserId || channels.length === 0) return null;

    try {
      const outcome = await this.notifications.publish({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        idempotencyKey: request.idempotencyKey,
        opportunityId,
        targetUserId: assignedUserId,
        // The one recipient is the person who just got the lead. Widening this
        // would notify people the distribution did not concern.
        notifyOpportunityOwner: false,
        notifyPipelineOwner: false,
        notifyPipelineParticipants: false,
        specificRecipientUserIds: [],
        channels,
        cycleId: request.runId,
        policyVersion: request.policyRef,
        currentScore: null,
        title: 'Novo lead para você',
        body: 'Um lead foi atribuído a você pela distribuição automática.',
        actionUrl: '/leadflow/crm',
        alert: 'lead_distributed',
      });

      if (outcome.status === 'no_recipient') {
        return { notified: false, reason: 'no_recipient' };
      }
      return {
        notified: true,
        recipientUserIds: outcome.recipientUserIds,
        channelResults: outcome.channelResults.map((result) => ({
          recipientUserId: result.recipientUserId,
          channel: result.channel,
          status: result.status,
        })),
      };
    } catch (error) {
      this.logger.warn(
        `Lead distribution notice failed: ${error instanceof Error ? error.name : 'unknown_error'}`,
      );
      return { notified: false, reason: 'notification_failed' };
    }
  }
}

const NOTIFICATION_CHANNELS: readonly HotLeadNotificationChannel[] = [
  'in_app',
  'push',
  'platform_whatsapp',
  'email',
];

function channelList(value: unknown): HotLeadNotificationChannel[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value.filter((item): item is HotLeadNotificationChannel =>
        NOTIFICATION_CHANNELS.includes(item as HotLeadNotificationChannel),
      ),
    ),
  ];
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
