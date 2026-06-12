import { Logger } from '@nestjs/common';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
} from '../../notifications/enums';
import { NotificationEventProcessorService } from '../../notifications/services';
import { ContractRecord } from '../entities';
import {
  ContractSignatureMode,
  ContractSignatureProvider,
  ContractStatus,
  ContractTargetType,
} from '../enums';
import { ContractNotificationPublisher } from './contract-notification.publisher';

describe('ContractNotificationPublisher', () => {
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

  it('publishes sent_for_signature with deterministic metadata and a real client route', async () => {
    const publisher = new ContractNotificationPublisher(processor);
    const contract = makeContract();

    await publisher.publishSentForSignature({
      contract,
      actorUserId: 'user-actor',
      sourceEventId: 'event-signature-sent',
      occurredAt: contract.updatedAt,
      recipients: [
        {
          userId: 'user-requester',
          interestReason: NotificationInterestReason.REQUESTER,
        },
      ],
    });

    const event = expectProcessedEvent(processor);
    expect(event).toEqual(
      expect.objectContaining({
        eventId: expect.stringContaining('contract.sent_for_signature'),
        eventType: 'contract.sent_for_signature',
        productKey: NotificationProductKey.AGENCY,
        moduleKey: 'contracts',
        actorType: NotificationActorType.USER,
        actorUserId: 'user-actor',
        resourceType: 'contract',
        resourceId: contract.id,
        recipients: [
          {
            userId: 'user-requester',
            interestReason: NotificationInterestReason.REQUESTER,
          },
        ],
        payload: expect.objectContaining({
          actionUrl: '/clients/client-1',
          contractId: contract.id,
        }),
      }),
    );
    expect(event.eventId).toContain(contract.id);
    expect(event.eventId).toContain('event-signature-sent');
    expect(event.eventId).toContain(contract.updatedAt.toISOString());
  });

  it('removes empty, duplicate, and actor recipients', async () => {
    const publisher = new ContractNotificationPublisher(processor);

    await publisher.publishCanceled({
      contract: makeContract(),
      actorUserId: 'user-actor',
      recipients: [
        {
          userId: '',
          interestReason: NotificationInterestReason.REQUESTER,
        },
        {
          userId: 'user-actor',
          interestReason: NotificationInterestReason.REQUESTER,
        },
        {
          userId: 'user-owner',
          interestReason: NotificationInterestReason.REQUESTER,
        },
        {
          userId: 'user-owner',
          interestReason: NotificationInterestReason.PARTICIPANT,
        },
      ],
    });

    expect(expectProcessedEvent(processor).recipients).toEqual([
      {
        userId: 'user-owner',
        interestReason: NotificationInterestReason.REQUESTER,
      },
    ]);
  });

  it('keeps integration signed events prepared', async () => {
    const publisher = new ContractNotificationPublisher(processor);
    const contract = makeContract({
      signedAt: new Date('2026-06-12T14:00:00.000Z'),
    });

    await publisher.publishSigned({
      contract,
      actorType: NotificationActorType.INTEGRATION,
      initiatedByUserId: 'user-requester',
      recipients: [
        {
          userId: 'user-requester',
          interestReason: NotificationInterestReason.REQUESTER,
        },
      ],
    });

    const event = expectProcessedEvent(processor);
    expect(event).toEqual(
      expect.objectContaining({
        eventType: 'contract.signed',
        actorType: NotificationActorType.INTEGRATION,
        actorUserId: null,
        initiatedByUserId: 'user-requester',
      }),
    );
    expect(event.eventId).toContain(contract.signedAt?.toISOString());
  });

  it('captures processor errors without rethrowing', async () => {
    const publisher = new ContractNotificationPublisher(processor);
    const loggerSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    processor.process.mockRejectedValueOnce(new Error('processor failed'));

    await expect(
      publisher.publishProviderFailed({
        contract: makeContract(),
        actorType: NotificationActorType.INTEGRATION,
        provider: 'autentique',
        failureCode: 'provider_error',
        recipients: [
          {
            userId: 'user-requester',
            interestReason: NotificationInterestReason.REQUESTER,
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

function makeContract(overrides: Partial<ContractRecord> = {}): ContractRecord {
  const now = new Date('2026-06-12T12:00:00.000Z');

  return {
    id: 'contract-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    title: 'Contrato de prestacao de servicos',
    targetType: ContractTargetType.Client,
    targetId: 'client-1',
    templateId: null,
    templateVersionId: null,
    status: ContractStatus.SentForSignature,
    signatureMode: ContractSignatureMode.Digital,
    signatureProvider: ContractSignatureProvider.Autentique,
    externalDocumentId: null,
    variablesData: {},
    generatedHtml: null,
    validFrom: null,
    validUntil: null,
    signedAt: null,
    completedAt: null,
    cancelledAt: null,
    archivedAt: null,
    createdById: 'user-requester',
    updatedById: 'user-actor',
    cancelledById: null,
    metadata: {},
    createdAt: now,
    updatedAt: now,
    ...overrides,
  };
}
