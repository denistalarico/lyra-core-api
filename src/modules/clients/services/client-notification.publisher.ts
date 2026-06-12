import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { NotificationExplicitRecipient } from '../../notifications/types';
import { AgencyClient } from '../entities';

type ClientRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

type ClientNotificationInput = {
  client: AgencyClient;
  actorUserId?: string | null;
  occurredAt?: Date;
  recipients?: ClientRecipientInput[];
};

@Injectable()
export class ClientNotificationPublisher {
  private readonly logger = new Logger(ClientNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishAssigned(input: ClientNotificationInput) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.assigned',
      eventIdParts: [
        'client.assigned',
        input.client.id,
        input.client.accountOwnerId,
        this.timestampFor(input.occurredAt ?? input.client.updatedAt),
      ],
      recipients:
        input.recipients ??
        [
          {
            userId: input.client.accountOwnerId,
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
      title: 'Cliente atribuído a você',
      body: `O cliente "${input.client.displayName}" foi atribuído a você.`,
    });
  }

  publishOwnerChanged(
    input: ClientNotificationInput & { previousOwnerId?: string | null },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.owner_changed',
      eventIdParts: [
        'client.owner_changed',
        input.client.id,
        input.previousOwnerId,
        input.client.accountOwnerId,
        this.timestampFor(input.occurredAt ?? input.client.updatedAt),
      ],
      recipients:
        input.recipients ??
        [
          {
            userId: input.client.accountOwnerId,
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      title: 'Você agora é responsável por este cliente',
      body: `Você passou a ser o responsável pelo cliente "${input.client.displayName}".`,
    });
  }

  publishStatusChanged(
    input: ClientNotificationInput & { previousStatus?: string | null },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.status_changed',
      eventIdParts: [
        'client.status_changed',
        input.client.id,
        input.previousStatus,
        input.client.status,
        this.timestampFor(input.occurredAt ?? input.client.updatedAt),
      ],
      recipients: input.recipients ?? [],
      title: 'Status do cliente alterado',
      body: `O status do cliente "${input.client.displayName}" foi alterado.`,
      payload: {
        previousStatus: input.previousStatus ?? null,
        status: input.client.status,
      },
    });
  }

  publishOnboardingStarted(input: ClientNotificationInput) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.onboarding_started',
      eventIdParts: [
        'client.onboarding_started',
        input.client.id,
        this.timestampFor(input.occurredAt ?? input.client.updatedAt),
      ],
      recipients:
        input.recipients ??
        [
          {
            userId: input.client.accountOwnerId,
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      title: 'Onboarding do cliente iniciado',
      body: `O onboarding do cliente "${input.client.displayName}" foi iniciado.`,
    });
  }

  publishOnboardingCompleted(input: ClientNotificationInput) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.onboarding_completed',
      eventIdParts: [
        'client.onboarding_completed',
        input.client.id,
        this.timestampFor(input.occurredAt ?? input.client.updatedAt),
      ],
      recipients:
        input.recipients ??
        [
          {
            userId: input.client.accountOwnerId,
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      title: 'Onboarding do cliente concluído',
      body: `O onboarding do cliente "${input.client.displayName}" foi concluído.`,
    });
  }

  publishDocumentRequested(
    input: ClientNotificationInput & {
      documentType?: string | null;
    },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.document_requested',
      eventIdParts: [
        'client.document_requested',
        input.client.id,
        input.documentType,
        this.timestampFor(input.occurredAt),
      ],
      recipients: input.recipients ?? [],
      title: 'Documento do cliente solicitado',
      body: `Um documento foi solicitado para o cliente "${input.client.displayName}".`,
      payload: {
        documentType: input.documentType ?? null,
      },
    });
  }

  publishDocumentReceived(
    input: ClientNotificationInput & {
      documentType?: string | null;
    },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.document_received',
      eventIdParts: [
        'client.document_received',
        input.client.id,
        input.documentType,
        this.timestampFor(input.occurredAt),
      ],
      recipients:
        input.recipients ??
        [
          {
            userId: input.client.accountOwnerId,
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      title: 'Documento do cliente recebido',
      body: `Um documento foi recebido do cliente "${input.client.displayName}".`,
      payload: {
        documentType: input.documentType ?? null,
      },
    });
  }

  publishPlanChanged(
    input: ClientNotificationInput & {
      previousPlan?: string | null;
      plan?: string | null;
    },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.plan_changed',
      eventIdParts: [
        'client.plan_changed',
        input.client.id,
        input.previousPlan,
        input.plan,
        this.timestampFor(input.occurredAt ?? input.client.updatedAt),
      ],
      recipients: input.recipients ?? [],
      title: 'Plano do cliente alterado',
      body: `O plano do cliente "${input.client.displayName}" foi alterado.`,
      payload: {
        previousPlan: input.previousPlan ?? null,
        plan: input.plan ?? null,
      },
    });
  }

  publishProductActivated(
    input: ClientNotificationInput & {
      productKey?: string | null;
    },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.product_activated',
      eventIdParts: [
        'client.product_activated',
        input.client.id,
        input.productKey,
        this.timestampFor(input.occurredAt),
      ],
      recipients: input.recipients ?? [],
      title: 'Produto ativado para o cliente',
      body: `Um produto foi ativado para o cliente "${input.client.displayName}".`,
      payload: {
        productKey: input.productKey ?? null,
      },
    });
  }

  publishProductDeactivated(
    input: ClientNotificationInput & {
      productKey?: string | null;
    },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.product_deactivated',
      eventIdParts: [
        'client.product_deactivated',
        input.client.id,
        input.productKey,
        this.timestampFor(input.occurredAt),
      ],
      recipients: input.recipients ?? [],
      title: 'Produto desativado para o cliente',
      body: `Um produto foi desativado para o cliente "${input.client.displayName}".`,
      payload: {
        productKey: input.productKey ?? null,
      },
    });
  }

  publishManagedTenantConnected(input: ClientNotificationInput) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.managed_tenant_connected',
      eventIdParts: [
        'client.managed_tenant_connected',
        input.client.id,
        input.client.managedTenantId,
        this.timestampFor(input.occurredAt ?? input.client.updatedAt),
      ],
      recipients:
        input.recipients ??
        [
          {
            userId: input.client.accountOwnerId,
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      title: 'Workspace gerenciado conectado',
      body: `O cliente "${input.client.displayName}" foi conectado a um workspace gerenciado.`,
    });
  }

  publishManagedTenantDisconnected(
    input: ClientNotificationInput & { previousManagedTenantId?: string | null },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.managed_tenant_disconnected',
      eventIdParts: [
        'client.managed_tenant_disconnected',
        input.client.id,
        input.previousManagedTenantId,
        this.timestampFor(input.occurredAt ?? input.client.updatedAt),
      ],
      recipients:
        input.recipients ??
        [
          {
            userId: input.client.accountOwnerId,
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      title: 'Workspace gerenciado desconectado',
      body: `O cliente "${input.client.displayName}" foi desconectado do workspace gerenciado.`,
    });
  }

  publishContractExpiring(
    input: ClientNotificationInput & {
      contractId?: string | null;
      validUntil?: string | null;
    },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.contract_expiring',
      eventIdParts: [
        'client.contract_expiring',
        input.client.id,
        input.contractId,
        input.validUntil,
      ],
      recipients:
        input.recipients ??
        [
          {
            userId: input.client.accountOwnerId,
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      title: 'Contrato do cliente perto do vencimento',
      body: `O contrato do cliente "${input.client.displayName}" está perto do vencimento.`,
      payload: {
        contractId: input.contractId ?? null,
        validUntil: input.validUntil ?? null,
      },
    });
  }

  publishRiskDetected(
    input: ClientNotificationInput & {
      riskReason?: string | null;
    },
  ) {
    return this.publishClientEvent({
      ...input,
      eventType: 'client.risk_detected',
      eventIdParts: [
        'client.risk_detected',
        input.client.id,
        input.riskReason,
        this.timestampFor(input.occurredAt ?? input.client.updatedAt),
      ],
      recipients:
        input.recipients ??
        [
          {
            userId: input.client.accountOwnerId,
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      title: 'Risco identificado no cliente',
      body: `Um risco foi identificado para o cliente "${input.client.displayName}".`,
      payload: {
        riskReason: input.riskReason ?? null,
      },
    });
  }

  private async publishClientEvent(input: ClientNotificationInput & {
    eventType: string;
    eventIdParts: Array<string | null | undefined>;
    recipients: ClientRecipientInput[];
    title: string;
    body: string;
    payload?: Record<string, unknown>;
  }) {
    const recipients = this.normalizeRecipients(
      input.recipients,
      input.actorUserId,
    );

    if (recipients.length === 0) {
      return;
    }

    try {
      await this.notificationEventProcessor.process({
        eventId: this.buildEventId(input.eventIdParts),
        eventType: input.eventType,
        tenantId: input.client.tenantId,
        workspaceId: input.client.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'clients',
        actorType: NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        resourceType: 'client',
        resourceId: input.client.id,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: this.resolveActionUrl(input.client),
          clientId: input.client.id,
          clientDisplayName: input.client.displayName,
          status: input.client.status,
          lifecycleStage: input.client.lifecycleStage,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for client ${input.client.id} tenant ${input.client.tenantId} workspace ${input.client.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeRecipients(
    recipients: ClientRecipientInput[],
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

  private resolveActionUrl(client: AgencyClient) {
    return `/clients/${client.id}`;
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
