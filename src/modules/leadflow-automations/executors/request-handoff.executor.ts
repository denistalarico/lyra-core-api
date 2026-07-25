import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { RequestContext } from '../../../common/context/request-context.interface';
import { ConversationOwnershipService } from '../../inbox/services/conversation-ownership.service';
import { LeadFlowAutomationErrorClass } from '../enums/leadflow-automation-run.enums';
import { executorAvailability } from './automation-executors.registry';
import type {
  AutomationEffectRequest,
  AutomationEffectResult,
  AutomationExecutor,
  AutomationExecutorAvailability,
} from './automation-executor.types';

/**
 * The handoff executor: an automation hands a conversation to a human.
 *
 * Like the CRM executors, it owns none of the rules. It resolves the target
 * conversation and a sanitized reason from the request, then calls the inbox's
 * canonical `ConversationOwnershipService.requestHandoff` as the `automation`
 * actor. That service performs the whole governed transition in one
 * transaction — flips ownership to `handoff_requested`, disables the AI,
 * invalidates any in-flight agent decision, emits
 * `leadflow.inbox.conversation.handoff.requested`, and publishes exactly one
 * in-app notification per ownership cycle.
 *
 * It is idempotent by ownership version: a second request on an
 * already-handed-off conversation is a clean no-op that neither re-notifies nor
 * bumps the cycle. That is what makes "one handoff → one notification per cycle"
 * hold even under retry or a trigger that fires on the handoff event itself.
 */
@Injectable()
export class RequestHandoffExecutor implements AutomationExecutor {
  readonly actionKey = 'request_handoff';

  constructor(private readonly ownership: ConversationOwnershipService) {}

  availability(): AutomationExecutorAvailability {
    return executorAvailability(this.actionKey);
  }

  async execute(
    request: AutomationEffectRequest,
  ): Promise<AutomationEffectResult> {
    const conversationId = stringField(request.payload.conversationId);
    if (!conversationId) {
      return {
        status: 'refused',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Permanent,
        errorCode: 'handoff_unconfigured',
        errorMessage:
          'O handoff exige uma conversa de destino no envelope do evento.',
        reference: null,
      };
    }

    const ctx: RequestContext = {
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
    };

    try {
      const conversation = await this.ownership.requestHandoff(
        ctx,
        conversationId,
        resolveReason(request.payload.reason),
      );

      return {
        status: 'confirmed',
        effectConfirmed: true,
        reference: conversation.id,
      };
    } catch (error) {
      // A governed refusal — the conversation is gone, or a managed-context
      // mismatch hides it from this scope — is a clean "no", not a fault; a
      // retry with the same inputs cannot change it.
      if (
        error instanceof ConflictException ||
        error instanceof NotFoundException
      ) {
        return {
          status: 'refused',
          effectConfirmed: false,
          errorClass: LeadFlowAutomationErrorClass.Permanent,
          errorCode:
            error instanceof NotFoundException
              ? 'conversation_not_found'
              : 'handoff_blocked',
          errorMessage: refusalMessage(error),
          reference: null,
        };
      }

      return {
        status: 'failed',
        effectConfirmed: false,
        errorClass: LeadFlowAutomationErrorClass.Transient,
        errorCode: 'handoff_failed',
        errorMessage: 'O handoff falhou por um erro transitório.',
        reference: null,
      };
    }
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

/** A short, catalog-safe reason; the domain clamps to 180 chars anyway. */
function resolveReason(value: unknown): string {
  const text = typeof value === 'string' ? value.trim() : '';
  return text !== '' ? text.slice(0, 180) : 'automation_handoff';
}

/** A business-facing message with no internal payload detail. */
function refusalMessage(error: ConflictException | NotFoundException): string {
  const response = error.getResponse();
  if (typeof response === 'object' && response !== null) {
    const message = (response as Record<string, unknown>).message;
    if (typeof message === 'string' && message.length <= 200) return message;
  }
  return 'O handoff não foi permitido pela política vigente.';
}
