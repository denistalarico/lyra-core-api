import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { LeadFlowHandoffTemplateVariables } from './platform-whatsapp-notification.catalog';
import { PlatformWhatsAppNotificationDeliveryEntity } from './platform-whatsapp-notification-delivery.entity';
import {
  buildPlatformWhatsAppDeliveryKey,
  PlatformWhatsAppNotificationSender,
} from './platform-whatsapp-notification.sender';

const AGENCY_CONNECTION = 'agency';

export interface PlatformWhatsAppDeliveryRequest {
  tenantId: string;
  workspaceId: string;
  subjectType: string;
  subjectId: string;
  handoffCycleId: string | number;
  recipientUserId: string;
  templateKey: string;
  businessModeKey?: string | null;
  toPhoneE164: string;
  variables: LeadFlowHandoffTemplateVariables;
}

export type PlatformWhatsAppDeliveryResult =
  | { status: 'sent'; providerMessageId: string }
  | { status: 'already_sent'; providerMessageId: string | null }
  | { status: 'skipped'; reasonCode: string }
  | { status: 'failed'; providerCode: string | null };

/**
 * The idempotent boundary around one platform WhatsApp send.
 *
 * It is the single place that decides whether a send happens at all: if a row
 * for the idempotency key is already `sent`, it never sends again (Adendo item
 * 23). Otherwise it asks the sender and persists the sanitized outcome —
 * `sent`/`failed` only; a skip (provider off, template unavailable, recipient not
 * permitted) is not a delivery and leaves no row. A WhatsApp failure is recorded,
 * never thrown: it must not disturb the handoff or the in-app notification.
 */
@Injectable()
export class PlatformWhatsAppDeliveryService {
  constructor(
    private readonly sender: PlatformWhatsAppNotificationSender,
    @InjectRepository(
      PlatformWhatsAppNotificationDeliveryEntity,
      AGENCY_CONNECTION,
    )
    private readonly deliveries: Repository<PlatformWhatsAppNotificationDeliveryEntity>,
  ) {}

  async deliverOnce(
    request: PlatformWhatsAppDeliveryRequest,
  ): Promise<PlatformWhatsAppDeliveryResult> {
    const idempotencyKey = buildPlatformWhatsAppDeliveryKey({
      tenantId: request.tenantId,
      workspaceId: request.workspaceId,
      subjectId: request.subjectId,
      handoffCycleId: request.handoffCycleId,
      recipientUserId: request.recipientUserId,
      templateKey: request.templateKey,
    });

    const existing = await this.deliveries.findOne({
      where: { idempotencyKey },
    });
    if (existing?.status === 'sent') {
      return {
        status: 'already_sent',
        providerMessageId: existing.providerMessageId,
      };
    }

    const outcome = await this.sender.sendTemplate({
      toPhoneE164: request.toPhoneE164,
      templateKey: request.templateKey,
      businessModeKey: request.businessModeKey ?? null,
      variables: request.variables,
    });

    if (outcome.status === 'skipped') {
      // Not a delivery — nothing to record, nothing to resend.
      return { status: 'skipped', reasonCode: outcome.reasonCode };
    }

    await this.record(existing, idempotencyKey, request, outcome);

    return outcome.status === 'sent'
      ? { status: 'sent', providerMessageId: outcome.providerMessageId }
      : { status: 'failed', providerCode: outcome.providerCode };
  }

  private async record(
    existing: PlatformWhatsAppNotificationDeliveryEntity | null,
    idempotencyKey: string,
    request: PlatformWhatsAppDeliveryRequest,
    outcome:
      | { status: 'sent'; providerMessageId: string }
      | { status: 'failed'; providerCode: string | null; message: string },
  ): Promise<void> {
    const entity =
      existing ??
      this.deliveries.create({
        idempotencyKey,
        tenantId: request.tenantId,
        workspaceId: request.workspaceId,
        templateKey: request.templateKey,
        recipientUserId: request.recipientUserId,
        subjectType: request.subjectType,
        subjectId: request.subjectId,
        handoffCycleId: String(request.handoffCycleId),
        attempts: 0,
      });

    entity.status = outcome.status;
    entity.providerMessageId =
      outcome.status === 'sent' ? outcome.providerMessageId : null;
    entity.providerCode =
      outcome.status === 'failed' ? outcome.providerCode : null;
    entity.sanitizedMessage =
      outcome.status === 'failed' ? outcome.message : null;
    entity.attempts = (existing?.attempts ?? 0) + 1;

    await this.deliveries.save(entity);
  }
}
