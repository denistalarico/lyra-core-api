import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxNotificationPublisher } from './inbox-notification.publisher';

describe('InboxNotificationPublisher', () => {
  it('publishes one actionable Portuguese notification for a handoff route', async () => {
    const process = jest.fn().mockResolvedValue({ status: 'created' });
    const publisher = new InboxNotificationPublisher({ process } as never);
    const conversation = {
      id: 'conversation-1',
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      ownershipVersion: 4,
      ownershipChangedAt: new Date('2026-07-22T12:00:00.000Z'),
    } as InboxConversationEntity;

    await publisher.publishHandoffRequested({
      conversation,
      recipientUserIds: ['user-1', 'user-1'],
      clientId: 'client-1',
    });

    expect(process).toHaveBeenCalledTimes(1);
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        eventId: 'inbox.handoff_requested:conversation-1:4',
        eventType: 'inbox.handoff_requested',
        resourceType: 'inbox_conversation',
        resourceId: 'conversation-1',
        recipients: [expect.objectContaining({ userId: 'user-1' })],
        payload: expect.objectContaining({
          title: 'Atendimento solicitado',
          actionUrl: '/leadflow/inbox?client=client-1',
          autoReadWhenInboxActive: true,
        }),
      }),
    );
  });

  it('does not create a notification without a scoped recipient', async () => {
    const process = jest.fn();
    const publisher = new InboxNotificationPublisher({ process } as never);

    await publisher.publishHandoffRequested({
      conversation: {} as InboxConversationEntity,
      recipientUserIds: [],
    });

    expect(process).not.toHaveBeenCalled();
  });
});
