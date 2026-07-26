import { Injectable } from '@nestjs/common';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { LeadFlowAutomationNotificationPublisher } from '../services/leadflow-automation-notification.publisher';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';
import type { HotLeadNotificationChannel } from '../services/leadflow-automation-notification.publisher';

/**
 * The notify_user executor: an automation raises an internal in-app alert.
 *
 * Its owning domain is the platform's Notifications layer, so it delegates the
 * whole effect — persistence, realtime fan-out, per-user preferences and
 * idempotency — to `LeadFlowAutomationNotificationPublisher`. The executor only
 * carries the sanitized message and the subject through, and translates the
 * publisher's outcome into the effect contract: no eligible recipient is a
 * clean refusal, an unexpected fault is a transient failure worth retrying.
 */
@Injectable()
export class NotifyUserExecutor implements AutomationExecutor {
  readonly actionKey = 'notify_user';

  constructor(
    private readonly publisher: LeadFlowAutomationNotificationPublisher,
  ) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const payload = request.payload;

    try {
      const outcome = await this.publisher.publish({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        idempotencyKey: request.idempotencyKey,
        opportunityId: stringField(payload.opportunityId) ?? '',
        targetUserId: stringField(payload.targetUserId),
        notifyOpportunityOwner: payload.notifyOpportunityOwner !== false,
        notifyPipelineOwner: payload.notifyPipelineOwner === true,
        notifyPipelineParticipants: payload.notifyPipelineParticipants === true,
        specificRecipientUserIds: stringList(payload.specificRecipientUserIds),
        channels: channelList(payload.notificationChannels),
        cycleId: stringField(payload.cycleId) ?? request.runId,
        policyVersion: stringField(payload.policyVersion) ?? request.policyRef,
        currentScore: numberField(payload.currentScore),
        title: stringField(payload.title) ?? 'Alerta de lead',
        body: stringField(payload.body) ?? 'Um lead precisa da sua atenção.',
        actionUrl: stringField(payload.actionUrl) ?? '/leadflow/crm',
      });

      if (outcome.status === 'no_recipient') {
        return {
          status: 'refused',
          effectConfirmed: false,
          errorClass: LeadFlowAutomationErrorClass.Permanent,
          errorCode: 'notify_no_recipient',
          errorMessage:
            'Nenhum destinatário elegível para a notificação (sem responsável nem alvo configurado).',
          reference: null,
        };
      }

      const delivered = outcome.channelResults.filter((result) =>
        ['sent', 'skipped_duplicate'].includes(result.status),
      ).length;
      const failed = outcome.channelResults.filter(
        (result) => result.status === 'failed',
      ).length;
      const skipped = outcome.channelResults.length - delivered - failed;
      const details = {
        eventProcessed: true,
        recipientUserIds: outcome.recipientUserIds,
        attemptedDeliveries: outcome.channelResults.length,
        successfulDeliveries: delivered,
        skippedDeliveries: skipped,
        failedDeliveries: failed,
        partialFailure: delivered > 0 && failed > 0,
        totalFailure: delivered === 0 && failed > 0,
        channelResults: outcome.channelResults.map((result) => ({
          recipientUserId: result.recipientUserId,
          channel: result.channel,
          status: result.status,
        })),
      };

      // Recipient/channel delivery is an independent child outcome. Once the
      // canonical event was processed, a total provider failure or a set of
      // skips must remain visible in `details`, but must not roll back the hot
      // lead detection or retry the entire multichannel fan-out.
      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: outcome.notificationId,
        details,
      };
    } catch {
      return {
        status: 'failed',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Transient,
        errorCode: 'notify_failed',
        errorMessage: 'A notificação falhou por um erro transitório.',
        reference: null,
      };
    }
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

function numberField(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function stringList(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => Boolean(stringField(item)))
    : [];
}

function channelList(value: unknown): HotLeadNotificationChannel[] {
  const allowed: HotLeadNotificationChannel[] = [
    'in_app',
    'push',
    'platform_whatsapp',
    'email',
  ];
  if (!Array.isArray(value)) return ['in_app'];
  return [
    ...new Set(
      value.filter(
        (item): item is HotLeadNotificationChannel =>
          typeof item === 'string' &&
          allowed.includes(item as HotLeadNotificationChannel),
      ),
    ),
  ];
}
