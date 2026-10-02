import { ClientConversationCardRegistry } from './client-conversation-card.port';
import { SocialApprovalNotificationPublisher } from './social-approval-notification.publisher';

/**
 * CCOM2 §7/§8/§9/§51 — the card is published by the one existing fan-out point,
 * once per event, and only for the transition that means "there is something
 * new for you to review".
 */
describe('approval card publication', () => {
  const approval = {
    id: 'approval-a',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: 'client-a',
    companyContextId: 'company-a',
    requestedByUserId: 'agency-requester',
    subjectType: 'planner_content_revision',
    title: 'Post Carnaval',
    subjectVersionLabel: 'v2',
    sentToClientAt: new Date('2026-10-01T10:00:00.000Z'),
    approvedAt: new Date('2026-10-01T11:00:00.000Z'),
    supersededAt: new Date('2026-10-01T12:00:00.000Z'),
    updatedAt: new Date('2026-10-01T09:00:00.000Z'),
    status: 'awaiting_client',
  };

  type CardCall = { approval: { id: string }; dedupeKey: string };

  function build() {
    const cards = {
      // Typed arguments, so the assertions below read the real call shape
      // instead of an empty tuple inferred from a zero-arg mock.
      publishApprovalCard: jest.fn(async (_input: CardCall) => ({
        status: 'posted' as const,
      })),
      announceApprovalActivity: jest.fn(
        async (_input: {
          approval: unknown;
          reason: 'comment_created' | 'decision_changed';
        }) => undefined,
      ),
    };
    const registry = new ClientConversationCardRegistry();
    registry.register(cards);

    const processor = {
      process: jest.fn(async (_event: { eventId: string }) => ({
        status: 'created',
      })),
    };
    const publisher = new SocialApprovalNotificationPublisher(
      processor as never,
      undefined,
      registry,
    );

    return { publisher, cards, processor };
  }

  it('posts the card when an approval enters awaiting_client', async () => {
    const { publisher, cards } = build();
    await publisher.publish('awaiting_client', approval as never, 'actor-a');

    expect(cards.publishApprovalCard).toHaveBeenCalledTimes(1);
    const [input] = cards.publishApprovalCard.mock.calls[0];
    expect(input.approval.id).toBe('approval-a');
    expect(input.dedupeKey).toBeTruthy();
  });

  /**
   * §9/§51 — the dedupe key is the event's own identity, byte-for-byte the
   * `eventId` the notification ledger deduplicates on. One derivation, so the
   * card's idempotency cannot drift from the notification's.
   */
  it('reuses the ledger source-event id as the dedupe key', async () => {
    const { publisher, cards, processor } = build();
    await publisher.publish('awaiting_client', approval as never, 'actor-a');

    const [event] = processor.process.mock.calls[0];
    const [input] = cards.publishApprovalCard.mock.calls[0];

    expect(input.dedupeKey).toBe(event.eventId);
    expect(input.dedupeKey).toBe(
      'social.approval.awaiting_client:approval-a:2026-10-01T10:00:00.000Z',
    );
  });

  it('gives a retried event the same key, so the card cannot double', async () => {
    const { publisher, cards } = build();
    await publisher.publish('awaiting_client', approval as never, 'actor-a');
    await publisher.publish('awaiting_client', approval as never, 'actor-a');

    const keys = cards.publishApprovalCard.mock.calls.map(
      ([input]) => input.dedupeKey,
    );
    expect(keys).toHaveLength(2);
    expect(new Set(keys).size).toBe(1);
  });

  /**
   * §51/§52 — a new revision is a *different* approval and therefore its own
   * `awaiting_client` event, so it earns its own card while the historical ones
   * stay. The keys differ because the approval id does.
   */
  it('gives a different revision a different key', async () => {
    const { publisher, cards } = build();
    await publisher.publish('awaiting_client', approval as never, 'actor-a');
    await publisher.publish(
      'awaiting_client',
      { ...approval, id: 'approval-b', subjectVersionLabel: 'v3' } as never,
      'actor-a',
    );

    const keys = cards.publishApprovalCard.mock.calls.map(
      ([input]) => input.dedupeKey,
    );
    expect(new Set(keys).size).toBe(2);
  });

  /**
   * §30/§45/§52 — no other transition posts a card. A decision changes the
   * status the card resolves on read; creating a second card would narrate the
   * same approval twice, and `superseded` is already answered by the existing
   * card resolving as `replaced`.
   */
  it.each(['approved', 'changes_requested', 'superseded'] as const)(
    'posts no card for %s',
    async (type) => {
      const { publisher, cards } = build();
      await publisher.publish(type, approval as never, 'actor-a');
      expect(cards.publishApprovalCard).not.toHaveBeenCalled();
    },
  );

  /**
   * §10 — the approval transition is the fact and the card is an effect. A
   * publisher that throws must not surface into the transition.
   */
  it('does not fail the transition when the card publication throws', async () => {
    const registry = new ClientConversationCardRegistry();
    registry.register({
      publishApprovalCard: jest.fn(() => Promise.reject(new Error('down'))),
      announceApprovalActivity: jest.fn(async () => undefined),
    });

    const publisher = new SocialApprovalNotificationPublisher(
      { process: jest.fn(async () => ({ status: 'created' })) } as never,
      undefined,
      registry,
    );

    await expect(
      publisher.publish('awaiting_client', approval as never, 'actor-a'),
    ).resolves.toBeUndefined();
  });

  /** An unwired surface simply means no card, and no error. */
  it('is a no-op when no conversation surface is registered', async () => {
    const publisher = new SocialApprovalNotificationPublisher(
      { process: jest.fn(async () => ({ status: 'created' })) } as never,
      undefined,
      new ClientConversationCardRegistry(),
    );

    await expect(
      publisher.publish('awaiting_client', approval as never, 'actor-a'),
    ).resolves.toBeUndefined();
  });

  /**
   * §43/§45 — a comment and a decision announce activity instead of writing a
   * row. Nothing is deduplicated, because nothing is created.
   */
  it('announces timeline activity without creating a card', async () => {
    const { publisher, cards } = build();
    await publisher.announceConversationActivity(
      approval as never,
      'comment_created',
    );

    expect(cards.announceApprovalActivity).toHaveBeenCalledWith({
      approval,
      reason: 'comment_created',
    });
    expect(cards.publishApprovalCard).not.toHaveBeenCalled();
  });

  it('swallows a failed announcement', async () => {
    const registry = new ClientConversationCardRegistry();
    registry.register({
      publishApprovalCard: jest.fn(async () => ({ status: 'posted' as const })),
      announceApprovalActivity: jest.fn(() =>
        Promise.reject(new Error('socket down')),
      ),
    });

    const publisher = new SocialApprovalNotificationPublisher(
      { process: jest.fn(async () => ({ status: 'created' })) } as never,
      undefined,
      registry,
    );

    await expect(
      publisher.announceConversationActivity(
        approval as never,
        'decision_changed',
      ),
    ).resolves.toBeUndefined();
  });
});
