import { Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { FinanceBill, FinanceInvoice, FinancePayment } from '../entities';
import {
  FinanceBillStatus,
  FinanceInvoiceStatus,
  FinancePaymentDirection,
  FinancePaymentMethod,
  FinancePaymentStatus,
} from '../enums';
import { FinanceNotificationPublisher } from './finance-notification.publisher';

describe('FinanceNotificationPublisher', () => {
  const processor = {
    process: jest.fn(),
  } as unknown as jest.Mocked<NotificationEventProcessorService>;

  beforeEach(() => {
    jest.clearAllMocks();
    processor.process.mockResolvedValue({
      status: 'created',
      notificationId: 'notification-1',
      recipientCount: 1,
    });
  });

  it('publishes invoice_issued to a real invoice route', async () => {
    const publisher = new FinanceNotificationPublisher(processor);
    const invoice = makeInvoice({ status: FinanceInvoiceStatus.Issued });

    await publisher.publishInvoiceIssued({
      resource: invoice,
      actorUserId: 'user-actor',
      recipients: [
        {
          userId: 'user-owner',
          interestReason: NotificationInterestReason.OWNER,
        },
      ],
    });

    const event = expectProcessedEvent(processor);
    expect(event).toEqual(
      expect.objectContaining({
        eventId: expect.stringContaining('finance.invoice_issued'),
        eventType: 'finance.invoice_issued',
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'finance',
        actorType: NotificationActorType.USER,
        resourceType: 'finance_invoice',
        resourceId: invoice.id,
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
        payload: expect.objectContaining({
          actionUrl: `/finance/invoices/${invoice.id}`,
        }),
      }),
    );
    expect(event.eventId).toContain(invoice.id);
    expect(event.eventId).toContain(invoice.issuedAt?.toISOString());
  });

  it('deduplicates and suppresses the actor for payment_received', async () => {
    const publisher = new FinanceNotificationPublisher(processor);

    await publisher.publishPaymentReceived({
      resource: makePayment(),
      actorUserId: 'user-actor',
      recipients: [
        {
          userId: 'user-actor',
          interestReason: NotificationInterestReason.OWNER,
        },
        {
          userId: 'user-owner',
          interestReason: NotificationInterestReason.OWNER,
        },
        {
          userId: 'user-owner',
          interestReason: NotificationInterestReason.REQUESTER,
        },
      ],
    });

    expect(expectProcessedEvent(processor).recipients).toEqual([
      {
        userId: 'user-owner',
        interestReason: NotificationInterestReason.OWNER,
      },
    ]);
  });

  it('publishes bill_paid to a real bill route', async () => {
    const publisher = new FinanceNotificationPublisher(processor);
    const bill = makeBill();

    await publisher.publishBillPaid({
      resource: bill,
      recipients: [
        {
          userId: 'user-owner',
          interestReason: NotificationInterestReason.OWNER,
        },
      ],
    });

    expect(expectProcessedEvent(processor).payload).toEqual(
      expect.objectContaining({
        actionUrl: `/finance/bills/${bill.id}`,
      }),
    );
  });

  it('captures processor errors without rethrowing', async () => {
    const publisher = new FinanceNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    processor.process.mockRejectedValueOnce(new Error('processor failed'));

    await expect(
      publisher.publishPaymentFailed({
        resource: makePayment({ status: FinancePaymentStatus.Failed }),
        actorType: NotificationActorType.INTEGRATION,
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
      }),
    ).resolves.toBeUndefined();

    expect(processor.process).toHaveBeenCalledTimes(1);
    loggerSpy.mockRestore();
  });
});

function expectProcessedEvent(
  processor: jest.Mocked<NotificationEventProcessorService>,
) {
  expect(processor.process).toHaveBeenCalledTimes(1);
  return processor.process.mock.calls[0][0];
}

function makeInvoice(overrides: Partial<FinanceInvoice> = {}): FinanceInvoice {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'invoice-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    customerId: null,
    sourceModule: null,
    sourceId: null,
    invoiceNumber: 'INV-00001',
    status: FinanceInvoiceStatus.Issued,
    currency: 'BRL',
    issueDate: '2026-06-12',
    dueDate: null,
    periodStart: null,
    periodEnd: null,
    subtotalAmount: '100.00',
    taxAmount: '0.00',
    discountAmount: '0.00',
    totalAmount: '100.00',
    paidAmount: '0.00',
    balanceDue: '100.00',
    terms: null,
    notes: null,
    issuedAt: now,
    paidAt: null,
    cancelledAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makePayment(overrides: Partial<FinancePayment> = {}): FinancePayment {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'payment-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    direction: FinancePaymentDirection.Customer,
    status: FinancePaymentStatus.Completed,
    method: FinancePaymentMethod.Pix,
    contactId: null,
    bankAccountId: null,
    paymentDate: '2026-06-12',
    amount: '100.00',
    allocatedAmount: '0.00',
    currency: 'BRL',
    externalProvider: null,
    externalReference: null,
    description: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}

function makeBill(overrides: Partial<FinanceBill> = {}): FinanceBill {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'bill-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    vendorId: null,
    billNumber: 'BILL-00001',
    status: FinanceBillStatus.Paid,
    currency: 'BRL',
    issueDate: null,
    dueDate: null,
    periodStart: null,
    periodEnd: null,
    subtotalAmount: '100.00',
    taxAmount: '0.00',
    totalAmount: '100.00',
    paidAmount: '100.00',
    balanceDue: '0.00',
    categoryId: null,
    costCenterId: null,
    notes: null,
    paidAt: now,
    cancelledAt: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
