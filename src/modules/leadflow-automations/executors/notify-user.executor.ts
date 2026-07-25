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
        opportunityId: stringField(payload.opportunityId),
        targetUserId: stringField(payload.targetUserId),
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

      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: outcome.notificationId,
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
