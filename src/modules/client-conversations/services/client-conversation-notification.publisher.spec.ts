import { IsNull, Not } from 'typeorm';
import {
  NotificationRecipientSurface,
} from '../../notifications/enums';
import type { NotificationSourceEvent } from '../../notifications/types';
import { ClientConversationNotificationPublisher } from './client-conversation-notification.publisher';

/**
 * NTF-C1 §39/§40/§42/§66 — conversation message notifications.
 *
 * The property under test is symmetry without duplication: one publisher, one
 * event type, and the direction decides which surface is addressed.
 */

function build(participants: unknown[] = []) {
  const events: NotificationSourceEvent[] = [];
  const process = jest.fn().mockImplementation((event: NotificationSourceEvent) => {
    events.push(event);
    return Promise.resolve({
      status: 'created',
      notificationId: 'n1',
      recipientCount: 1,
    });
  });
  const participantsRepo = {
    find: jest.fn().mockResolvedValue(participants),
  };

  const publisher = new ClientConversationNotificationPublisher(
    { process } as never,
    participantsRepo as never,
  );

  return { publisher, process, events, participantsRepo };
}

const notice = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  companyContextId: 'company-a',
  conversationId: 'conversation-1',
  messageId: 'message-1',
  authorSurface: NotificationRecipientSurface.AGENCY,
  authorUserId: 'operator-1',
  createdAt: new Date('2026-04-01T10:00:00.000Z'),
};

describe('client conversation message notifications', () => {
  it('uses one event type for both directions (§40/§41)', async () => {
    const { publisher, events } = build([
      { userId: 'operator-2', participantSurface: 'agency' },
    ]);

    await publisher.publishMessageCreated(notice);
    await publisher.publishMessageCreated({
      ...notice,
      messageId: 'message-2',
      authorSurface: NotificationRecipientSurface.CLIENT_AREA,
      authorUserId: 'client-1',
    });

    expect(events.map((event) => event.eventType)).toEqual([
      'client_conversation.message.created',
      'client_conversation.message.created',
    ]);
  });

  describe('Agency writes to the client', () => {
    it('addresses the client audience and no Agency recipient', async () => {
      const { publisher, events } = build();

      await publisher.publishMessageCreated(notice);

      expect(events[0].recipients).toEqual([]);
      expect(events[0].clientAudience).toMatchObject({
        companyContextId: 'company-a',
        requiredPermission: 'client_area.conversations.view',
        requiredModule: 'conversations',
      });
    });

    it('deep links into the client conversation, never an Agency route (§16)', async () => {
      const { publisher, events } = build();

      await publisher.publishMessageCreated(notice);

      expect(events[0].clientAudience?.actionUrl).toBe(
        '/client-area/companies/company-a/conversations',
      );
    });

    /**
     * CCOM0 §28 — the conversation is the record and the notification is a
     * pointer to it, so the message text must not travel in the notification.
     */
    it('never carries the message body', async () => {
      const { publisher, events } = build();

      await publisher.publishMessageCreated(notice);

      const serialized = JSON.stringify(events[0]);
      expect(serialized).not.toContain('message-1-body');
      expect(events[0].clientAudience?.body).toBe(
        'A agência enviou uma nova mensagem na sua conversa.',
      );
    });
  });

  describe('client writes to the Agency (§40)', () => {
    it('addresses the live Agency participants of the conversation', async () => {
      const { publisher, events, participantsRepo } = build([
        { userId: 'operator-1', participantSurface: 'agency' },
        { userId: 'operator-2', participantSurface: 'agency' },
      ]);

      await publisher.publishMessageCreated({
        ...notice,
        authorSurface: NotificationRecipientSurface.CLIENT_AREA,
        authorUserId: 'client-1',
      });

      expect(events[0].recipients?.map((recipient) => recipient.userId)).toEqual([
        'operator-1',
        'operator-2',
      ]);
      expect(
        events[0].recipients?.every(
          (recipient) => recipient.surface === NotificationRecipientSurface.AGENCY,
        ),
      ).toBe(true);
      // No client audience: the client wrote it.
      expect(events[0].clientAudience).toBeUndefined();

      // Only live participants of the Agency surface.
      expect(participantsRepo.find).toHaveBeenCalledWith({
        where: {
          conversationId: 'conversation-1',
          participantSurface: 'agency',
          leftAt: IsNull(),
          userId: Not(IsNull()),
        },
      });
    });

    it('excludes a participant who has left', async () => {
      // The repository filters on `leftAt IS NULL`, so a departed participant
      // never arrives; asserted through the query rather than a local filter.
      const { publisher, events } = build([]);

      await publisher.publishMessageCreated({
        ...notice,
        authorSurface: NotificationRecipientSurface.CLIENT_AREA,
        authorUserId: 'client-1',
      });

      expect(events[0].recipients).toEqual([]);
    });
  });

  /** §42 — twice over: by audience, and by the catalog's actor policy. */
  describe('self notification', () => {
    it('never notifies the author among the Agency participants', async () => {
      const { publisher, events } = build([
        { userId: 'client-author', participantSurface: 'agency' },
        { userId: 'operator-2', participantSurface: 'agency' },
      ]);

      await publisher.publishMessageCreated({
        ...notice,
        authorSurface: NotificationRecipientSurface.CLIENT_AREA,
        authorUserId: 'client-author',
      });

      expect(events[0].recipients?.map((recipient) => recipient.userId)).toEqual([
        'operator-2',
      ]);
    });

    it('declares the actor so the catalog policy can suppress them too', async () => {
      const { publisher, events } = build();

      await publisher.publishMessageCreated(notice);

      expect(events[0].actorUserId).toBe('operator-1');
    });
  });

  /** §11/§26 — the message id is the event identity. */
  it('keys the event by the message, so a retry cannot notify twice', async () => {
    const { publisher, events } = build();

    await publisher.publishMessageCreated(notice);

    expect(events[0].eventId).toBe(
      'client_conversation.message.created:message-1',
    );
  });

  /** §70 — the message is already persisted; a notification failure is noise. */
  it('swallows a publication failure', async () => {
    const { publisher, process } = build();
    process.mockRejectedValue(new Error('db down'));

    await expect(
      publisher.publishMessageCreated(notice),
    ).resolves.toBeUndefined();
  });
});
