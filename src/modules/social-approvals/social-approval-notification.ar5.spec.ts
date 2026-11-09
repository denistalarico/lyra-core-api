import { ConflictException } from '@nestjs/common';
import {
  approvalNotificationEnabled,
  SocialApprovalNotificationPublisher,
} from './social-approval-notification.publisher';
import { ClientConversationCardRegistry } from './client-conversation-card.port';
import { TeamChatApprovalCardRegistry } from './team-chat-approval-card.port';

const approval = {
  id: 'approval-a',
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
  requestedByUserId: 'requester',
  subjectType: 'planner_content_revision',
  title: 'Post',
  subjectVersionLabel: 'r2',
  sentToClientAt: new Date('2026-11-09T10:00:00.000Z'),
  updatedAt: new Date('2026-11-09T09:00:00.000Z'),
  status: 'awaiting_client',
  batchId: null as string | null,
};

const defaults = {
  scopeKind: 'managed_client',
  internalApprovalEnabled: true,
  internalApproverUserIds: [] as string[],
  clientApproverMembershipIds: [] as string[],
  clientDecisionPolicy: 'first',
  clientCanEditText: false,
  sendToConversation: true,
  registerDecisionsInConversation: true,
  teamChatChannelId: null as string | null,
  notificationEvents: {} as Record<string, unknown>,
};

function build(settings: Partial<typeof defaults> = {}) {
  const processor = { process: jest.fn(async () => ({ status: 'created' })) };
  const conversation = {
    publishApprovalCard: jest.fn(async () => ({ status: 'posted' as const })),
    announceApprovalActivity: jest.fn(async () => undefined),
    publishDecisionLine: jest.fn(async () => undefined),
  };
  const teamChat = {
    publishCard: jest.fn(async () => undefined),
    publishDecisionReply: jest.fn(async () => undefined),
    announceCardChanged: jest.fn(async () => undefined),
  };
  const conversationRegistry = new ClientConversationCardRegistry();
  conversationRegistry.register(conversation);
  const teamChatRegistry = new TeamChatApprovalCardRegistry();
  teamChatRegistry.register(teamChat);
  const settingsService = {
    get: jest.fn(async () => ({ ...defaults, ...settings })),
    internalApproverRecipients: jest.fn(async () => ['owner-1']),
  };
  const publisher = new SocialApprovalNotificationPublisher(
    processor as never,
    undefined,
    conversationRegistry,
    teamChatRegistry,
    settingsService as never,
  );
  return { publisher, processor, conversation, teamChat, settingsService };
}

const record = {
  eventId: 'event-1',
  decision: 'approved' as const,
  stage: 'client' as const,
  actorName: 'Fulana',
  surface: 'client_conversation' as const,
};

describe('approvalNotificationEnabled (AR5 entrega 8)', () => {
  it('reads a boolean, an audience map, and defaults to on', () => {
    expect(approvalNotificationEnabled({}, 'approved', 'agency')).toBe(true);
    expect(approvalNotificationEnabled(null, 'approved', 'client')).toBe(true);
    expect(
      approvalNotificationEnabled({ approved: false }, 'approved', 'agency'),
    ).toBe(false);
    const map = { approved: { client: false } };
    expect(approvalNotificationEnabled(map, 'approved', 'client')).toBe(false);
    expect(approvalNotificationEnabled(map, 'approved', 'agency')).toBe(true);
  });
});

describe('SocialApprovalNotificationPublisher AR5', () => {
  it('respects send_to_conversation', async () => {
    const off = build({ sendToConversation: false });
    await off.publisher.publish('awaiting_client', approval as never, 'actor');
    expect(off.conversation.publishApprovalCard).not.toHaveBeenCalled();

    const on = build();
    await on.publisher.publish('awaiting_client', approval as never, 'actor');
    expect(on.conversation.publishApprovalCard).toHaveBeenCalledTimes(1);
  });

  it('a batch shares one event id, so it is one card and one notification', async () => {
    const { publisher, processor, conversation } = build();
    const first = { ...approval, id: 'a-1', batchId: 'batch-1' };
    const second = {
      ...approval,
      id: 'a-2',
      batchId: 'batch-1',
      sentToClientAt: new Date('2026-11-09T11:00:00.000Z'),
    };
    await publisher.publish('awaiting_client', first as never, 'actor');
    await publisher.publish('awaiting_client', second as never, 'actor');

    const ids = (
      processor.process.mock.calls as unknown as Array<[{ eventId: string }]>
    ).map(([event]) => event.eventId);
    expect(new Set(ids).size).toBe(1);
    const keys = (
      conversation.publishApprovalCard.mock.calls as unknown as Array<
        [{ dedupeKey: string }]
      >
    ).map(([input]) => input.dedupeKey);
    expect(new Set(keys).size).toBe(1);
    expect(keys[0]).toBe('social.approval.awaiting_client:batch:batch-1');
  });

  it('only the announcement is grouped: decisions stay per approval', async () => {
    const { publisher, processor } = build();
    await publisher.publish(
      'approved',
      { ...approval, id: 'a-1', batchId: 'batch-1' } as never,
      'actor',
    );
    const [[event]] = processor.process.mock.calls as unknown as Array<
      [{ eventId: string }]
    >;
    expect(event.eventId).toContain('a-1');
    expect(event.eventId).not.toContain('batch');
  });

  it('turns off each audience independently', async () => {
    const noAgency = build({
      notificationEvents: { awaiting_client: { agency: false } },
    });
    await noAgency.publisher.publish(
      'awaiting_client',
      approval as never,
      'actor',
    );
    const [[event]] = noAgency.processor.process.mock.calls as unknown as Array<
      [{ recipients: unknown[]; clientAudience?: unknown }]
    >;
    expect(event.recipients).toEqual([]);
    expect(event.clientAudience).toBeDefined();

    const off = build({ notificationEvents: { awaiting_client: false } });
    await off.publisher.publish('awaiting_client', approval as never, 'actor');
    expect(off.processor.process).not.toHaveBeenCalled();
    // The switch is about notifying; the card still follows its own setting.
    expect(off.conversation.publishApprovalCard).toHaveBeenCalledTimes(1);
  });

  it('internal review notifies approvers and posts to the configured channel', async () => {
    const { publisher, processor, teamChat } = build({
      teamChatChannelId: 'channel-1',
    });
    await publisher.publishInternalReview(
      { ...approval, status: 'awaiting_internal_review' } as never,
      'actor',
      'sent-event',
    );
    expect(processor.process).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'social.approval.awaiting_internal_review',
        recipients: [expect.objectContaining({ userId: 'owner-1' })],
      }),
    );
    expect(teamChat.publishCard).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        dedupeKey:
          'social.approval.awaiting_internal_review:approval-a:sent-event',
      }),
    );
  });

  it('without a channel there is no card, and the notification still goes', async () => {
    const { publisher, processor, teamChat } = build();
    await publisher.publishInternalReview(approval as never, 'actor', 'e');
    expect(teamChat.publishCard).not.toHaveBeenCalled();
    expect(processor.process).toHaveBeenCalledTimes(1);
  });

  it('writes a client decision in the conversation', async () => {
    const { publisher, conversation, teamChat } = build();
    await publisher.publishDecisionRecord(approval as never, record);
    expect(conversation.publishDecisionLine).toHaveBeenCalledTimes(1);
    expect(teamChat.publishDecisionReply).toHaveBeenCalledTimes(1);
  });

  it('never writes an internal decision in the client conversation', async () => {
    const { publisher, conversation, teamChat } = build();
    await publisher.publishDecisionRecord(approval as never, {
      ...record,
      stage: 'internal',
    });
    expect(conversation.publishDecisionLine).not.toHaveBeenCalled();
    expect(teamChat.publishDecisionReply).toHaveBeenCalledTimes(1);
  });

  it('shows an override to the client, whatever the stage', async () => {
    const { publisher, conversation } = build();
    await publisher.publishDecisionRecord(approval as never, {
      ...record,
      decision: 'agency_override',
      stage: 'internal',
    });
    expect(conversation.publishDecisionLine).toHaveBeenCalledTimes(1);
  });

  it('respects register_decisions_in_conversation', async () => {
    const { publisher, conversation } = build({
      registerDecisionsInConversation: false,
    });
    await publisher.publishDecisionRecord(approval as never, record);
    expect(conversation.publishDecisionLine).not.toHaveBeenCalled();
  });

  it('a publication that fails never reaches the transition', async () => {
    const { publisher, conversation, teamChat, settingsService } = build({
      teamChatChannelId: 'channel-1',
    });
    conversation.publishDecisionLine.mockRejectedValue(new Error('down'));
    teamChat.publishDecisionReply.mockRejectedValue(new Error('down'));
    teamChat.publishCard.mockRejectedValue(new Error('down'));
    teamChat.announceCardChanged.mockRejectedValue(new Error('down'));

    await expect(
      publisher.publishDecisionRecord(approval as never, record),
    ).resolves.toBeUndefined();
    await expect(
      publisher.publishInternalReview(approval as never, 'a', 'e'),
    ).resolves.toBeUndefined();
    await expect(
      publisher.announceTeamChatCardChanged(approval as never),
    ).resolves.toBeUndefined();

    settingsService.get.mockRejectedValue(new ConflictException('nope'));
    await expect(
      publisher.publish('approved', approval as never, 'a'),
    ).resolves.toBeUndefined();
  });
});
