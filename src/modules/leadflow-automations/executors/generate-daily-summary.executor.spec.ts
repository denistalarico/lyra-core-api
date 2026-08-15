import type { DataSource } from 'typeorm';
import type { NotificationEventProcessorService } from '../../notifications/services';
import type { TeamChatCardPostService } from '../../team-chat/services/team-chat-card-post.service';
import type { TeamChatMessageCard } from '../../team-chat/types/team-chat-card.types';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import type { LeadFlowSummaryAgentResolver } from '../services/leadflow-summary-agent.resolver';
import type { AutomationEffectRequest } from './automation-executor.types';
import { GenerateDailySummaryExecutor } from './generate-daily-summary.executor';

function request(
  payload: Record<string, unknown> = {},
): AutomationEffectRequest {
  return {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    automationId: 'automation-1',
    runId: 'event-1',
    attemptNumber: 1,
    actionKey: 'generate_summary_placeholder',
    correlationId: 'event-1',
    idempotencyKey: 'effect:abc',
    actorRef: 'automation:automation-1',
    policyRef: 'daily_summary:version-1',
    payload: {
      localDate: '2026-08-15',
      timezone: 'America/Sao_Paulo',
      targetUserId: null,
      frequency: 'weekly',
      periodStart: '2026-08-08T11:00:00.000Z',
      periodEnd: '2026-08-15T11:00:00.000Z',
      notificationChannels: ['in_app'],
      deliverToTeamChat: false,
      teamChatChannelId: null,
      contextType: LeadFlowSettingsContextType.Agency,
      agencyClientId: null,
      ...payload,
    },
    revalidation: {
      contextSchemaVersion: 1,
      capturedAt: '2026-08-15T11:00:00Z',
      subjects: {},
      expectedVersion: null,
    },
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    key: 'user-1',
    name: null,
    openCount: '4',
    createdCount: '2',
    wonCount: '1',
    lostCount: '0',
    overdueFollowupCount: '3',
    ...overrides,
  };
}

function build(
  overrides: {
    queries?: unknown[][];
    postStatus?: 'posted' | 'duplicate' | 'channel_unavailable';
  } = {},
) {
  const results = overrides.queries ?? [
    [row()],
    [{ key: 'user-1', name: 'Ana Paula' }],
  ];
  let call = 0;
  const query = jest.fn().mockImplementation(() => {
    const next = results[call] ?? [];
    call += 1;
    return Promise.resolve(next);
  });
  const dataSource = { query } as unknown as DataSource;

  const process = jest.fn().mockResolvedValue({ status: 'created' });
  const notifications = {
    process,
  } as unknown as NotificationEventProcessorService;

  const postCard = jest.fn().mockResolvedValue({
    status: overrides.postStatus ?? 'posted',
    messageId: 'message-1',
  });
  const teamChat = { postCard } as unknown as TeamChatCardPostService;

  const resolve = jest.fn().mockResolvedValue({
    id: 'agent-1',
    name: 'Sofia',
    type: 'reception',
  });
  const agents = { resolve } as unknown as LeadFlowSummaryAgentResolver;

  return {
    executor: new GenerateDailySummaryExecutor(
      dataSource,
      notifications,
      teamChat,
      agents,
    ),
    query,
    process,
    postCard,
    resolve,
  };
}

describe('GenerateDailySummaryExecutor', () => {
  it('reports the window the trigger closed, not the calendar day', async () => {
    const { executor, query, process } = build();

    const result = await executor.execute(request());

    expect(result.status).toBe('confirmed');
    const [, params] = query.mock.calls[0] as [string, unknown[]];
    expect((params[2] as Date).toISOString()).toBe('2026-08-08T11:00:00.000Z');
    expect((params[3] as Date).toISOString()).toBe('2026-08-15T11:00:00.000Z');
    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({ deliveryChannels: ['in_app'] }),
      }),
    );
  });

  it('falls back to the local day when the delivery carries no window', async () => {
    const { executor, query } = build();

    await executor.execute(request({ periodStart: null, periodEnd: null }));

    const [, params] = query.mock.calls[0] as [string, unknown[]];
    // 2026-08-15 00:00 in America/Sao_Paulo.
    expect((params[2] as Date).toISOString()).toBe('2026-08-15T03:00:00.000Z');
  });

  it('sends over the configured channels only', async () => {
    const { executor, process } = build();

    await executor.execute(
      request({ notificationChannels: ['push', 'email', 'sms'] }),
    );

    expect(process).toHaveBeenCalledWith(
      expect.objectContaining({
        payload: expect.objectContaining({
          deliveryChannels: ['push', 'email'],
        }),
      }),
    );
  });

  it('publishes one consolidated card as the agent, agency and clients together', async () => {
    const { executor, postCard, resolve } = build({
      queries: [
        [row({ key: 'user-1' }), row({ key: 'user-2', createdCount: '1' })],
        [
          { key: 'user-1', name: 'Ana Paula' },
          { key: 'user-2', name: 'Bruno Reis' },
        ],
        [row({ key: null }), row({ key: 'client-1', createdCount: '5' })],
        [{ key: 'client-1', name: 'Orenda Biotech' }],
      ],
    });

    const result = await executor.execute(
      request({ deliverToTeamChat: true, teamChatChannelId: 'channel-1' }),
    );

    expect(result.status).toBe('confirmed');
    expect(resolve).toHaveBeenCalledWith(
      expect.objectContaining({ agencyClientId: null }),
    );
    const posted = postCard.mock.calls[0][0] as {
      sender: { displayName: string };
      dedupeKey: string;
      body: string;
      card: TeamChatMessageCard;
    };
    expect(posted.sender.displayName).toBe('Sofia');
    expect(posted.dedupeKey).toBe('leadflow-summary:effect:abc');
    expect(posted.body).toContain('Resumo de oportunidades');
    // Totals add every owner up; the breakdowns name people and clients, with
    // the unattributed bucket reading as the agency's own work.
    expect(posted.card.metrics[0]).toEqual({ label: 'Novas', value: '3' });
    expect(posted.card.groups?.[0].rows[0].label).toBe('Ana Paula');
    expect(posted.card.groups?.[1].title).toBe('Por cliente');
    expect(posted.card.groups?.[1].rows.map((entry) => entry.label)).toEqual([
      'Orenda Biotech',
      'Agência',
    ]);
  });

  it('refuses when the chosen channel no longer exists', async () => {
    const { executor } = build({ postStatus: 'channel_unavailable' });

    const result = await executor.execute(
      request({ deliverToTeamChat: true, teamChatChannelId: 'channel-1' }),
    );

    expect(result).toMatchObject({
      status: 'refused',
      errorCode: 'daily_summary_team_chat_channel_unavailable',
    });
  });

  it('narrows the numbers when the automation belongs to a client context', async () => {
    const { executor, query } = build();

    await executor.execute(
      request({
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-9',
      }),
    );

    const [sql, params] = query.mock.calls[0] as [string, unknown[]];
    expect(sql).toContain("o.metadata ->> 'clientId' = $6");
    expect(params[5]).toBe('client-9');
  });

  it('still posts the card when nobody owns an opportunity', async () => {
    const { executor, postCard, process } = build({
      queries: [[], [], [], []],
    });

    const result = await executor.execute(
      request({ deliverToTeamChat: true, teamChatChannelId: 'channel-1' }),
    );

    expect(process).not.toHaveBeenCalled();
    expect(postCard).toHaveBeenCalled();
    expect(result.status).toBe('confirmed');
  });

  it('refuses when no destination was configured at all', async () => {
    const { executor } = build();

    const result = await executor.execute(
      request({ notificationChannels: [], deliverToTeamChat: false }),
    );

    expect(result).toMatchObject({
      status: 'refused',
      errorCode: 'daily_summary_no_delivery_target',
    });
  });
});
