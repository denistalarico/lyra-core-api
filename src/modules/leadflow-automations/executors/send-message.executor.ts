import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { WhatsAppOutboundService } from '../../inbox/channels/whatsapp/services/whatsapp-outbound.service';
import { WhatsAppAutomationTemplateError } from '../../inbox/channels/whatsapp/services/whatsapp-outbound.service';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';

/** Governed adapter from Automations to the Inbox's canonical outbound command. */
@Injectable()
export class SendMessageExecutor implements AutomationExecutor {
  readonly actionKey = 'send_message';

  constructor(private readonly outbound: WhatsAppOutboundService) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const conversationId = stringField(request.payload.conversationId);
    if (!conversationId) return refused('message_conversation_required');
    const text = nullableString(request.payload.text);
    const templateRef = nullableString(request.payload.templateRef);
    if (!text && !templateRef) return refused('message_content_required');
    const channel = nullableString(request.payload.channel) ?? 'whatsapp';
    if (channel !== 'whatsapp') {
      return refused('followup_channel_transport_unavailable');
    }

    try {
      const result = await this.outbound.sendAutomationMessage({
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        conversationId,
        automationId: request.automationId,
        idempotencyKey: request.idempotencyKey,
        text,
        templateRef,
        templateLanguage:
          nullableString(request.payload.templateLanguage) ?? 'pt_BR',
        connectionRef: nullableString(request.payload.connectionRef),
      });
      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: result.message.id,
      };
    } catch (error) {
      if (error instanceof WhatsAppAutomationTemplateError) {
        return refused(
          error.reason === 'language_mismatch'
            ? 'whatsapp_template_language_mismatch'
            : error.reason === 'components_unsupported'
              ? 'whatsapp_template_components_unsupported'
              : 'whatsapp_template_invalid',
        );
      }
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException ||
        error instanceof BadRequestException
      ) {
        return refused(
          error instanceof NotFoundException
            ? 'message_conversation_not_found'
            : error instanceof ConflictException
              ? conflictCode(error)
              : 'message_channel_unavailable',
        );
      }
      return {
        status: 'failed',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Transient,
        errorCode: 'message_send_failed',
        errorMessage: 'O envio falhou por um erro transitório.',
        reference: null,
      };
    }
  }
}

function refused(errorCode: string): AutomationEffectResult {
  return {
    status: 'refused',
    effectConfirmed: false,
    errorClass: LeadFlowAutomationErrorClass.Permanent,
    errorCode,
    errorMessage: 'A mensagem automática não foi permitida no estado atual.',
    reference: null,
  };
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function conflictCode(error: ConflictException): string {
  const response = error.getResponse();
  const message =
    typeof response === 'string'
      ? response
      : typeof response === 'object' && response !== null
        ? (response as Record<string, unknown>).message
        : null;
  return message ===
    'whatsapp_template_required_outside_customer_service_window'
    ? 'whatsapp_template_required'
    : 'message_send_blocked';
}
