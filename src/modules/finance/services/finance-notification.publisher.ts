import { Injectable, Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { NotificationExplicitRecipient } from '../../notifications/types';
import {
  FinanceBill,
  FinanceInvoice,
  FinanceJournalEntry,
  FinancePayment,
  FinancePaymentProvider,
  FinanceRecurringProfile,
} from '../entities';

type FinanceResource =
  | FinanceInvoice
  | FinanceBill
  | FinancePayment
  | FinanceJournalEntry
  | FinanceRecurringProfile
  | FinancePaymentProvider;

type FinanceNotificationInput<TResource extends FinanceResource> = {
  resource: TResource;
  actorType?: NotificationActorType;
  actorUserId?: string | null;
  initiatedByUserId?: string | null;
  occurredAt?: Date;
  recipients?: FinanceRecipientInput[];
  eventIdSuffix?: string | null;
};

type FinanceRecipientInput = {
  userId?: string | null;
  interestReason: NotificationInterestReason;
};

@Injectable()
export class FinanceNotificationPublisher {
  private readonly logger = new Logger(FinanceNotificationPublisher.name);

  constructor(
    private readonly notificationEventProcessor: NotificationEventProcessorService,
  ) {}

  publishInvoiceIssued(input: FinanceNotificationInput<FinanceInvoice>) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.invoice_issued',
      eventIdParts: [
        'finance.invoice_issued',
        input.resource.id,
        this.timestampFor(input.resource.issuedAt ?? input.occurredAt),
      ],
      resourceType: 'finance_invoice',
      title: 'Fatura emitida',
      body: `A fatura ${input.resource.invoiceNumber} foi emitida.`,
      actionUrl: `/finance/invoices/${input.resource.id}`,
    });
  }

  publishInvoicePaid(input: FinanceNotificationInput<FinanceInvoice>) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.invoice_paid',
      eventIdParts: [
        'finance.invoice_paid',
        input.resource.id,
        this.timestampFor(input.resource.paidAt ?? input.occurredAt),
      ],
      resourceType: 'finance_invoice',
      title: 'Fatura paga',
      body: `A fatura ${input.resource.invoiceNumber} foi paga.`,
      actionUrl: `/finance/invoices/${input.resource.id}`,
    });
  }

  publishPaymentReceived(input: FinanceNotificationInput<FinancePayment>) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.payment_received',
      eventIdParts: [
        'finance.payment_received',
        input.resource.id,
        input.resource.externalReference,
        this.timestampFor(input.resource.updatedAt),
      ],
      resourceType: 'finance_payment',
      title: 'Pagamento recebido',
      body: 'Um pagamento foi recebido.',
      actionUrl: '/finance/payments',
    });
  }

  publishPaymentFailed(input: FinanceNotificationInput<FinancePayment>) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.payment_failed',
      eventIdParts: [
        'finance.payment_failed',
        input.resource.id,
        input.resource.externalReference,
        this.timestampFor(input.resource.updatedAt),
      ],
      resourceType: 'finance_payment',
      title: 'Falha em pagamento',
      body: 'Um pagamento falhou.',
      actionUrl: '/finance/payments',
    });
  }

  publishBillPaid(input: FinanceNotificationInput<FinanceBill>) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.bill_paid',
      eventIdParts: [
        'finance.bill_paid',
        input.resource.id,
        this.timestampFor(input.resource.paidAt ?? input.occurredAt),
      ],
      resourceType: 'finance_bill',
      title: 'Conta paga',
      body: `A conta ${input.resource.billNumber} foi paga.`,
      actionUrl: `/finance/bills/${input.resource.id}`,
    });
  }

  publishEntryRequiresReview(
    input: FinanceNotificationInput<FinanceJournalEntry>,
  ) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.entry_requires_review',
      eventIdParts: ['finance.entry_requires_review', input.resource.id, input.eventIdSuffix],
      resourceType: 'finance_journal_entry',
      title: 'Lancamento requer revisao',
      body: `O lancamento ${input.resource.entryNumber} requer revisao.`,
      actionUrl: '/finance/entries',
    });
  }

  publishEntryApproved(input: FinanceNotificationInput<FinanceJournalEntry>) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.entry_approved',
      eventIdParts: [
        'finance.entry_approved',
        input.resource.id,
        this.timestampFor(input.resource.postedAt ?? input.occurredAt),
      ],
      resourceType: 'finance_journal_entry',
      title: 'Lancamento aprovado',
      body: `O lancamento ${input.resource.entryNumber} foi aprovado.`,
      actionUrl: '/finance/entries',
    });
  }

  publishProviderError(input: FinanceNotificationInput<FinancePaymentProvider> & {
    failureCode?: string | null;
  }) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.provider_error',
      eventIdParts: [
        'finance.provider_error',
        input.resource.id,
        input.resource.providerType,
        input.failureCode,
        this.timestampFor(input.resource.updatedAt),
      ],
      resourceType: 'finance_payment_provider',
      title: 'Erro no provedor financeiro',
      body: `O provedor financeiro ${input.resource.name} registrou uma falha.`,
      actionUrl: '/finance/settings',
      payload: {
        providerType: input.resource.providerType,
        failureCode: input.failureCode ?? null,
      },
    });
  }

  publishRecurringChargeCreated(
    input: FinanceNotificationInput<FinanceRecurringProfile> & {
      invoiceId?: string | null;
    },
  ) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.recurring_charge_created',
      eventIdParts: [
        'finance.recurring_charge_created',
        input.resource.id,
        input.invoiceId,
        this.timestampFor(input.resource.updatedAt),
      ],
      resourceType: 'finance_recurring_profile',
      title: 'Cobranca recorrente criada',
      body: `A cobranca recorrente "${input.resource.name}" gerou uma fatura.`,
      actionUrl: '/finance/recurring',
      payload: {
        invoiceId: input.invoiceId ?? null,
      },
    });
  }

  publishRecurringChargeFailed(
    input: FinanceNotificationInput<FinanceRecurringProfile> & {
      failureCode?: string | null;
    },
  ) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.recurring_charge_failed',
      eventIdParts: [
        'finance.recurring_charge_failed',
        input.resource.id,
        input.failureCode,
        input.eventIdSuffix,
      ],
      resourceType: 'finance_recurring_profile',
      title: 'Falha em cobranca recorrente',
      body: `A cobranca recorrente "${input.resource.name}" falhou.`,
      actionUrl: '/finance/recurring',
      payload: {
        failureCode: input.failureCode ?? null,
      },
    });
  }

  publishInvoiceDueSoon(input: FinanceNotificationInput<FinanceInvoice>) {
    return this.publishPreparedInvoiceEvent(input, 'finance.invoice_due_soon');
  }

  publishInvoiceOverdue(input: FinanceNotificationInput<FinanceInvoice>) {
    return this.publishPreparedInvoiceEvent(input, 'finance.invoice_overdue');
  }

  publishBillDueSoon(input: FinanceNotificationInput<FinanceBill>) {
    return this.publishPreparedBillEvent(input, 'finance.bill_due_soon');
  }

  publishBillOverdue(input: FinanceNotificationInput<FinanceBill>) {
    return this.publishPreparedBillEvent(input, 'finance.bill_overdue');
  }

  publishCashflowAlert(input: FinanceNotificationInput<FinanceInvoice>) {
    return this.publishPreparedInvoiceEvent(input, 'finance.cashflow_alert');
  }

  publishMarginBelowThreshold(input: FinanceNotificationInput<FinanceInvoice>) {
    return this.publishPreparedInvoiceEvent(input, 'finance.margin_below_threshold');
  }

  publishReconciliationRequired(input: FinanceNotificationInput<FinancePayment>) {
    return this.publishFinanceEvent({
      ...input,
      eventType: 'finance.reconciliation_required',
      eventIdParts: ['finance.reconciliation_required', input.resource.id, input.eventIdSuffix],
      resourceType: 'finance_payment',
      title: 'Conciliacao requerida',
      body: 'Um pagamento requer conciliacao.',
      actionUrl: '/finance/payments',
    });
  }

  private publishPreparedInvoiceEvent(
    input: FinanceNotificationInput<FinanceInvoice>,
    eventType: string,
  ) {
    return this.publishFinanceEvent({
      ...input,
      eventType,
      eventIdParts: [eventType, input.resource.id, input.eventIdSuffix],
      resourceType: 'finance_invoice',
      title: 'Alerta financeiro',
      body: `A fatura ${input.resource.invoiceNumber} requer atencao.`,
      actionUrl: `/finance/invoices/${input.resource.id}`,
    });
  }

  private publishPreparedBillEvent(
    input: FinanceNotificationInput<FinanceBill>,
    eventType: string,
  ) {
    return this.publishFinanceEvent({
      ...input,
      eventType,
      eventIdParts: [eventType, input.resource.id, input.eventIdSuffix],
      resourceType: 'finance_bill',
      title: 'Alerta financeiro',
      body: `A conta ${input.resource.billNumber} requer atencao.`,
      actionUrl: `/finance/bills/${input.resource.id}`,
    });
  }

  private async publishFinanceEvent(input: FinanceNotificationInput<FinanceResource> & {
    eventType: string;
    eventIdParts: Array<string | null | undefined>;
    resourceType: string;
    title: string;
    body: string;
    actionUrl: string;
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
        tenantId: input.resource.tenantId,
        workspaceId: input.resource.workspaceId,
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'finance',
        actorType: input.actorType ?? NotificationActorType.USER,
        actorUserId: input.actorUserId ?? null,
        initiatedByUserId: input.initiatedByUserId ?? null,
        resourceType: input.resourceType,
        resourceId: input.resource.id,
        occurredAt: (input.occurredAt ?? new Date()).toISOString(),
        recipients,
        payload: {
          title: input.title,
          body: input.body,
          actionUrl: input.actionUrl,
          resourceId: input.resource.id,
          ...input.payload,
        },
      });
    } catch (error) {
      this.logger.error(
        `Failed to publish ${input.eventType} for finance resource ${input.resource.id} tenant ${input.resource.tenantId} workspace ${input.resource.workspaceId}`,
        error instanceof Error ? error.stack : String(error),
      );
    }
  }

  private normalizeRecipients(
    recipients: FinanceRecipientInput[],
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
