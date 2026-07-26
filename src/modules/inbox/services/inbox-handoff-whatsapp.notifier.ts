import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import {
  AgencyUserProfileEntity,
  AgencyWorkspaceCompanySettingsEntity,
} from '../../agency/entities/agency-settings.entities';
import {
  LEADFLOW_HANDOFF_TEMPLATE_KEY,
  type LeadFlowHandoffTemplateVariables,
} from '../../notifications/platform-whatsapp/platform-whatsapp-notification.catalog';
import { PlatformWhatsAppDeliveryService } from '../../notifications/platform-whatsapp/platform-whatsapp-delivery.service';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';

const AGENCY_CONNECTION = 'agency';

/**
 * The additional WhatsApp attempt on a handoff, layered on top of the in-app
 * notification (Adendo 1, canonical delivery: handoff → in-app persisted →
 * realtime → WhatsApp attempt).
 *
 * It runs strictly AFTER the in-app notification is published and is fully
 * isolated: any failure is swallowed, so it can never undo the handoff, remove
 * the in-app notification, or fail the caller. The platform provider is
 * default-disabled and fail-closed on recipients, so this is inert until a
 * tenant is explicitly enabled and allow-listed in staging.
 *
 * The variables carry only a workspace name, a contact display name (or a masked
 * phone) and a short governed reason — never conversation content, LLM reasoning,
 * or sensitive data.
 */
@Injectable()
export class InboxHandoffWhatsAppNotifier {
  private readonly logger = new Logger(InboxHandoffWhatsAppNotifier.name);

  constructor(
    private readonly delivery: PlatformWhatsAppDeliveryService,
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
  ) {}

  async notifyHandoff(input: {
    conversation: InboxConversationEntity;
    recipientUserIds: string[];
  }): Promise<void> {
    try {
      const recipients = [...new Set(input.recipientUserIds.filter(Boolean))];
      if (recipients.length === 0) {
        return;
      }

      const variables = await this.resolveSharedVariables(input.conversation);

      for (const userId of recipients) {
        try {
          await this.notifyRecipient(input.conversation, userId, variables);
        } catch (error) {
          this.logFailure(error);
        }
      }
    } catch (error) {
      // Never let the WhatsApp attempt disturb the handoff or in-app notification.
      this.logFailure(error);
    }
  }

  private async notifyRecipient(
    conversation: InboxConversationEntity,
    recipientUserId: string,
    variables: LeadFlowHandoffTemplateVariables,
  ): Promise<void> {
    const profile = await this.dataSource
      .getRepository(AgencyUserProfileEntity)
      .findOne({
        where: { tenantId: conversation.tenantId, userId: recipientUserId },
        select: { id: true, phone: true },
      });

    const phone = profile?.phone?.trim();
    if (!phone) {
      // No number on file — nothing to attempt. The in-app notification stands.
      return;
    }

    await this.delivery.deliverOnce({
      tenantId: conversation.tenantId,
      workspaceId: conversation.workspaceId,
      subjectType: 'inbox_conversation',
      subjectId: conversation.id,
      handoffCycleId: conversation.ownershipVersion,
      recipientUserId,
      templateKey: LEADFLOW_HANDOFF_TEMPLATE_KEY,
      toPhoneE164: phone,
      variables,
    });
  }

  private async resolveSharedVariables(
    conversation: InboxConversationEntity,
  ): Promise<LeadFlowHandoffTemplateVariables> {
    const company = await this.dataSource
      .getRepository(AgencyWorkspaceCompanySettingsEntity)
      .findOne({
        where: {
          tenantId: conversation.tenantId,
          workspaceId: conversation.workspaceId,
        },
        select: {
          id: true,
          workspaceName: true,
          tradeName: true,
          legalName: true,
        },
      });

    // Empty strings are fine: the provider applies the terminal fallbacks
    // ("Sua empresa" / "Contato sem nome" / "Solicitação de atendimento humano").
    const workspaceName =
      firstNonEmpty(
        company?.workspaceName,
        company?.tradeName,
        company?.legalName,
      ) ?? '';
    const contactDisplayName =
      firstNonEmpty(conversation.title, maskPhone(conversation.externalThreadId)) ??
      '';
    const handoffReason = conversation.ownershipReason?.trim() ?? '';

    return { workspaceName, contactDisplayName, handoffReason };
  }

  private logFailure(error: unknown): void {
    // Codes/messages only — never any credential or message payload detail.
    this.logger.warn(
      `Platform WhatsApp handoff attempt failed: ${
        error instanceof Error ? error.name : 'unknown_error'
      }`,
    );
  }
}

function firstNonEmpty(
  ...values: (string | null | undefined)[]
): string | null {
  for (const value of values) {
    const trimmed = value?.trim();
    if (trimmed) {
      return trimmed;
    }
  }
  return null;
}

/** Partially masks a phone/thread id, keeping only the last four digits. */
function maskPhone(value: string | null | undefined): string | null {
  const digits = (value ?? '').replace(/[^\d]/g, '');
  if (digits.length < 4) {
    return null;
  }
  return `••••${digits.slice(-4)}`;
}
