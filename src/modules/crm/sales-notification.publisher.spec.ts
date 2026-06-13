import { NotificationInterestReason } from '../notifications/enums';
import { SalesNotificationPublisher } from './sales-notification.publisher';

const processor = {
  process: jest.fn(),
};

const opportunity = {
  id: 'opportunity-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  title: 'Migração de CRM',
  assignedUserId: 'user-b',
  stageId: 'stage-b',
  createdAt: new Date('2026-01-01T10:00:00.000Z'),
  updatedAt: new Date('2026-01-01T11:00:00.000Z'),
};

const quote = {
  id: 'quote-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  quoteNumber: 'Q-2026-00001',
  title: 'Proposta',
  createdByUserId: 'user-owner',
  updatedByUserId: 'user-a',
  opportunityId: 'opportunity-a',
  acceptedAt: new Date('2026-01-02T12:00:00.000Z'),
  rejectedAt: null,
  updatedAt: new Date('2026-01-02T12:00:00.000Z'),
};

describe('SalesNotificationPublisher', () => {
  beforeEach(() => {
    processor.process.mockReset();
  });

  it('publishes opportunity assignments to the assigned user with a deterministic event id', async () => {
    const publisher = new SalesNotificationPublisher(processor as never);

    await publisher.publishOpportunityAssigned({
      resource: opportunity as never,
      actorUserId: 'user-a',
      assignedUserId: 'user-b',
      occurredAt: opportunity.updatedAt,
    });

    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId:
          'sales.opportunity_assigned:opportunity-a:user-b:2026-01-01T11:00:00.000Z',
        eventType: 'sales.opportunity_assigned',
        moduleKey: 'sales',
        resourceType: 'crm_opportunity',
        resourceId: 'opportunity-a',
        recipients: [
          {
            userId: 'user-b',
            interestReason: NotificationInterestReason.ASSIGNED,
          },
        ],
        payload: expect.objectContaining({
          actionUrl: '/sales',
          opportunityId: 'opportunity-a',
        }),
      }),
    );
  });

  it('suppresses self notifications before sending to the processor', async () => {
    const publisher = new SalesNotificationPublisher(processor as never);

    await publisher.publishOpportunityAssigned({
      resource: opportunity as never,
      actorUserId: 'user-b',
      assignedUserId: 'user-b',
      occurredAt: opportunity.updatedAt,
    });

    expect(processor.process).not.toHaveBeenCalled();
  });

  it('publishes accepted quotes to the creator without leaking external signer data', async () => {
    const publisher = new SalesNotificationPublisher(processor as never);

    await publisher.publishQuoteAccepted({
      resource: quote as never,
      actorUserId: 'user-a',
      statusHistory: {
        id: 'history-a',
        changedAt: new Date('2026-01-02T12:01:00.000Z'),
      } as never,
    });

    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId:
          'sales.quote_accepted:quote-a:history-a:2026-01-02T12:00:00.000Z',
        eventType: 'sales.quote_accepted',
        recipients: [
          {
            userId: 'user-owner',
            interestReason: NotificationInterestReason.OWNER,
          },
        ],
        payload: expect.objectContaining({
          actionUrl: '/sales/quotes/quote-a',
          quoteId: 'quote-a',
          quoteNumber: 'Q-2026-00001',
        }),
      }),
    );
    expect(processor.process.mock.calls[0][0].payload).not.toHaveProperty(
      'acceptedByEmail',
    );
  });
});
