import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { NotificationExplicitRecipient } from '../../notifications/types';
import { ContractRecord } from '../entities';
import { ContractTargetType } from '../enums';

type ContractNotificationInput = {
  contract: ContractRecord;
  actorType?: NotificationActorType;
  actorUserId?: string | null;
  initiatedByUserId?: string | null;
  occurredAt?: Date;
  sourceEventId?: string | null;
  recipients?: ContractRecipientInput[];
};

type ContractRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

@Injectable()
export class ContractNotificationPublisher {
  private readonly logger = new Logger(ContractNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishSentForSignature(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.sent_for_signature',
      eventIdParts: [
        'contract.sent_for_signature',
        input.contract.id,
        input.sourceEventId,
        this.timestampFor(input.occurredAt ?? input.contract.updatedAt),
      ],
      title: 'Contrato enviado para assinatura',
      body: `O contrato "${input.contract.title}" foi enviado para assinatura.`,
    });
  }

  publishViewed(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      actorType: input.actorType ?? NotificationActorType.INTEGRATION,
      eventType: 'contract.viewed',
      eventIdParts: [
        'contract.viewed',
        input.contract.id,
        input.sourceEventId,
        this.timestampFor(input.occurredAt ?? input.contract.updatedAt),
      ],
      title: 'Contrato visualizado',
      body: `O contrato "${input.contract.title}" foi visualizado.`,
    });
  }

  publishSigned(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.signed',
      eventIdParts: [
        'contract.signed',
        input.contract.id,
        this.timestampFor(input.contract.signedAt ?? input.occurredAt),
        input.sourceEventId,
      ],
      title: 'Contrato assinado',
      body: `O contrato "${input.contract.title}" foi assinado.`,
    });
  }

  publishRejected(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.rejected',
      eventIdParts: [
        'contract.rejected',
        input.contract.id,
        input.sourceEventId,
        this.timestampFor(input.occurredAt ?? input.contract.updatedAt),
      ],
      title: 'Contrato recusado',
      body: `O contrato "${input.contract.title}" foi recusado.`,
    });
  }

  publishCanceled(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.canceled',
      eventIdParts: [
        'contract.canceled',
        input.contract.id,
        this.timestampFor(input.contract.cancelledAt ?? input.occurredAt),
        input.sourceEventId,
      ],
      title: 'Contrato cancelado',
      body: `O contrato "${input.contract.title}" foi cancelado.`,
    });
  }

  publishDocumentGenerated(input: ContractNotificationInput & {
    documentId?: string | null;
  }) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.document_generated',
      eventIdParts: [
        'contract.document_generated',
        input.contract.id,
        input.documentId,
        input.sourceEventId,
      ],
      title: 'Documento do contrato gerado',
      body: `O documento do contrato "${input.contract.title}" foi gerado.`,
      payload: {
        documentId: input.documentId ?? null,
      },
    });
  }

  publishProviderFailed(input: ContractNotificationInput & {
    provider?: string | null;
    failureCode?: string | null;
  }) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.provider_failed',
      eventIdParts: [
        'contract.provider_failed',
        input.contract.id,
        input.provider,
        input.failureCode,
        input.sourceEventId,
        this.timestampFor(input.occurredAt ?? input.contract.updatedAt),
      ],
      title: 'Falha no provedor de assinatura',
      body: `Nao foi possivel concluir a operacao do provedor para o contrato "${input.contract.title}".`,
      payload: {
        provider: input.provider ?? null,
        failureCode: input.failureCode ?? null,
      },
    });
  }

  publishVersionCreated(input: ContractNotificationInput & {
    templateId?: string | null;
    versionId?: string | null;
    version?: number | null;
  }) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.version_created',
      eventIdParts: [
        'contract.version_created',
        input.templateId,
        input.versionId,
        String(input.version ?? 'none'),
      ],
      title: 'Versao de contrato criada',
      body: 'Uma nova versao de modelo de contrato foi criada.',
      resourceType: 'contract_template',
      resourceId: input.templateId ?? input.versionId ?? null,
      payload: {
        templateId: input.templateId ?? null,
        versionId: input.versionId ?? null,
        version: input.version ?? null,
      },
    });
  }

  publishManualSignaturePending(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.manual_signature_pending',
      eventIdParts: [
        'contract.manual_signature_pending',
        input.contract.id,
        input.sourceEventId,
        this.timestampFor(input.occurredAt ?? input.contract.updatedAt),
      ],
      title: 'Assinatura manual pendente',
      body: `O contrato "${input.contract.title}" aguarda assinatura manual.`,
    });
  }

  publishReviewRequested(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.review_requested',
      eventIdParts: ['contract.review_requested', input.contract.id, input.sourceEventId],
      title: 'Revisao de contrato solicitada',
      body: `O contrato "${input.contract.title}" precisa de revisao.`,
    });
  }

  publishApprovalRequested(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.approval_requested',
      eventIdParts: ['contract.approval_requested', input.contract.id, input.sourceEventId],
      title: 'Aprovacao de contrato solicitada',
      body: `O contrato "${input.contract.title}" precisa de aprovacao.`,
    });
  }

  publishExpiring(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.expiring',
      eventIdParts: ['contract.expiring', input.contract.id, input.contract.validUntil],
      title: 'Contrato perto do vencimento',
      body: `O contrato "${input.contract.title}" esta perto do vencimento.`,
    });
  }

  publishExpired(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.expired',
      eventIdParts: ['contract.expired', input.contract.id, input.contract.validUntil],
      title: 'Contrato vencido',
      body: `O contrato "${input.contract.title}" venceu.`,
    });
  }

  publishSignatureReminderDue(input: ContractNotificationInput) {
    return this.publishContractEvent({
      ...input,
      eventType: 'contract.signature_reminder_due',
      eventIdParts: ['contract.signature_reminder_due', input.contract.id, input.sourceEventId],
      title: 'Lembrete de assinatura pendente',
      body: `O contrato "${input.contract.title}" ainda precisa de assinatura.`,
    });
  }

  private async publishContractEvent(input: ContractNotificationInput & {
    eventType: string;
    eventIdParts: Array<string | null | undefined>;
    title: string;
    body: string;
    resourceType?: string;
    resourceId?: string | null;
    payload?: Record<string, unknown>;
  }) {
    const recipients = this.normalizeRecipients(
      input.recipients ?? [],
      input.actorUserId,
    );

    if (recipients.length === 0) {
      return;
    }

    try {
      await this.notificationEventProcessor.process({
        eventId: this.buildEventId(input.eventIdParts),
        eventType: input.eventType,
        tenantId: input.contract.tenantId,
        workspaceId: input.contract.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'contracts',
        actorType: input.actorType ?? NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        initiatedByUserId: input.initiatedByUserId ?? null,
        resourceType: input.resourceType ?? 'contract',
        resourceId: input.resourceId ?? input.contract.id,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: this.resolveActionUrl(input.contract),
          contractId: input.contract.id,
          contractTitle: input.contract.title,
          status: input.contract.status,
          signatureMode: input.contract.signatureMode,
          signatureProvider: input.contract.signatureProvider,
          targetType: input.contract.targetType,
          targetId: input.contract.targetId,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for contract ${input.contract.id} tenant ${input.contract.tenantId} workspace ${input.contract.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeRecipients(
    recipients: ContractRecipientInput[],
    actorUserId?: string | null,
  ): NotificationExplicitRecipient[] {
    const normalized = new Map<string, NotificationInterestReason>();

    for (const recipient of recipients) {
      const userId = recipient.userId?.trim();

      if (!userId || userId === actorUserId) {
        continue;
      }

      if (!normalized.has(userId)) {
        normalized.set(userId, recipient.interestReason);
      }
    }

    return Array.from(normalized.entries()).map(
      ([userId, interestReason]) => ({
        userId,
        interestReason,
      }),
    );
  }

  private resolveActionUrl(contract: ContractRecord) {
    if (contract.targetType === ContractTargetType.Client && contract.targetId) {
      return `/clients/${contract.targetId}`;
    }

    if (
      contract.targetType === ContractTargetType.TeamMember &&
      contract.targetId
    ) {
      return `/team/members/${contract.targetId}`;
    }

    return '/clients';
  }

  private buildEventId(parts: Array<string | null | undefined>) {
    return parts.map((part) => part ?? 'none').join(':');
  }

  private timestampFor(value?: Date | string | null) {
    if (!value) {
      return new Date().toISOString();
    }

    return value instanceof Date ? value.toISOString() : value;
  }
}
