import type {
  OperationalAnalyticsMessageFact,
  OperationalAnalyticsProjectionInput,
  OperationalAnalyticsRunFact,
  OperationalAnalyticsScoreFact,
} from '../types/operational-analytics.types';
import { projectOperationalAnalytics } from './operational-analytics-projector';

const messages: OperationalAnalyticsMessageFact[] = [
  message('m1', 'c1', 'inbound', 'contact', '2026-07-01T10:00:00.000Z'),
  message(
    'm2',
    'c1',
    'outbound',
    'agent',
    '2026-07-01T10:02:00.000Z',
    'agent-1',
  ),
  message('m3', 'c1', 'inbound', 'contact', '2026-07-01T10:03:00.000Z'),
  message('m4', 'c2', 'inbound', 'contact', '2026-07-01T11:00:00.000Z'),
  message('m5', 'c2', 'outbound', 'user', '2026-07-01T11:10:00.000Z'),
];

const scores: OperationalAnalyticsScoreFact[] = [
  score('o1', 20, 'cold', null, null, '2026-07-01T10:00:00.000Z'),
  score('o1', 80, 'hot', 20, 'cold', '2026-07-02T10:00:00.000Z'),
  score('o2', 50, 'warm', 40, 'cold', '2026-07-02T11:00:00.000Z'),
];

const runs: OperationalAnalyticsRunFact[] = [
  run('r1', 'live', 'succeeded', 200),
  run('r2', 'shadow', 'skipped', 100),
  run('r3', 'live', 'failed', 300),
];

describe('projectOperationalAnalytics', () => {
  it('derives response windows without reading message content', () => {
    const result = projectOperationalAnalytics(input());

    expect(result.messages.summary).toMatchObject({
      total: 5,
      inbound: 3,
      outbound: 2,
      automatedOutbound: 1,
      humanOutbound: 1,
      conversations: 2,
      respondedConversations: 2,
      firstResponseRate: 1,
      averageFirstResponseSeconds: 360,
      averageResponseSeconds: 360,
      leadRepliesAfterFirstAgentReply: 1,
    });
    expect(result.messages.byAgent).toEqual([
      expect.objectContaining({
        agentId: 'agent-1',
        outbound: 1,
        averageResponseSeconds: 120,
        leadRepliesAfterFirstReply: 1,
      }),
    ]);
  });

  it('does not treat a failed outbound attempt as a response', () => {
    const value = input();
    value.messages = [
      message(
        'failed-in',
        'failed-c',
        'inbound',
        'contact',
        '2026-07-01T12:00:00.000Z',
      ),
      {
        ...message(
          'failed-out',
          'failed-c',
          'outbound',
          'agent',
          '2026-07-01T12:01:00.000Z',
          'agent-1',
        ),
        status: 'failed',
      },
    ];

    const result = projectOperationalAnalytics(value);

    expect(result.messages.summary).toMatchObject({
      total: 2,
      outbound: 0,
      failedOutbound: 1,
      inboundConversations: 1,
      respondedConversations: 0,
      firstResponseRate: 0,
    });
  });

  it('uses the latest score in the period for distribution', () => {
    const result = projectOperationalAnalytics(input());

    expect(result.leadScore.summary).toMatchObject({
      calculations: 3,
      opportunities: 2,
      averageScore: 65,
      averageDelta: 35,
      hotTransitions: 1,
    });
    expect(result.leadScore.distribution).toEqual([
      { band: 'warm', opportunities: 1, share: 0.5 },
      { band: 'hot', opportunities: 1, share: 0.5 },
    ]);
  });

  it('separates live, shadow and failures and exposes effect evidence', () => {
    const result = projectOperationalAnalytics(input());

    expect(result.automations.summary).toEqual({
      runs: 3,
      live: 2,
      shadow: 1,
      dryRun: 0,
      succeeded: 1,
      skipped: 1,
      failed: 1,
      cancelled: 0,
      successRate: 0.5,
      averageDurationMs: 200,
      confirmedEffects: 1,
      failedAttempts: 2,
    });
    expect(result.automations.recentRuns[0]).toMatchObject({
      id: 'r3',
      confirmedEffects: 0,
      failedAttempts: 2,
    });
  });

  it('declares dimensions that cannot scope automation runs', () => {
    const value = input();
    value.filters = {
      channelId: 'channel-1',
      businessMode: 'general',
      agentId: 'agent-1',
    };

    const result = projectOperationalAnalytics(value);

    expect(result.dataQuality.filtersNotApplicableToAutomationRuns).toEqual([
      'channelId',
      'agentId',
    ]);
  });
});

function input(): OperationalAnalyticsProjectionInput {
  return {
    from: new Date('2026-07-01T00:00:00.000Z'),
    to: new Date('2026-07-31T23:59:59.999Z'),
    filters: { channelId: null, businessMode: null, agentId: null },
    options: {
      channels: [{ id: 'channel-1', name: 'WhatsApp', type: 'whatsapp' }],
      businessModes: ['general'],
      agents: [{ id: 'agent-1', name: 'SDR', type: 'qualifier' }],
    },
    messages,
    scores,
    runs,
    attempts: [
      { runId: 'r1', confirmedEffects: 1, failedAttempts: 0 },
      { runId: 'r3', confirmedEffects: 0, failedAttempts: 2 },
    ],
    agentNames: new Map([['agent-1', 'SDR']]),
  };
}

function message(
  id: string,
  conversationId: string,
  direction: 'inbound' | 'outbound',
  senderType: string,
  occurredAt: string,
  senderAgentId: string | null = null,
): OperationalAnalyticsMessageFact {
  return {
    id,
    conversationId,
    direction,
    senderType,
    senderAgentId,
    status: 'sent',
    occurredAt,
    channelId: 'channel-1',
    channelName: 'WhatsApp',
    channelType: 'whatsapp',
    businessMode: 'general',
    assignedAgentId: 'agent-1',
  };
}

function score(
  opportunityId: string,
  value: number,
  band: string,
  previousScore: number | null,
  previousBand: string | null,
  calculatedAt: string,
): OperationalAnalyticsScoreFact {
  return {
    opportunityId,
    score: value,
    band,
    previousScore,
    previousBand,
    policyVersion: 'v1',
    maxAchievable: 100,
    calculatedAt,
    businessMode: 'general',
    channelId: 'channel-1',
    channelType: 'whatsapp',
    assignedAgentId: 'agent-1',
  };
}

function run(
  id: string,
  mode: string,
  status: string,
  durationMs: number,
): OperationalAnalyticsRunFact {
  return {
    id,
    automationId: 'automation-1',
    automationName: 'Follow-up',
    recipeKey: 'followup_idle_lead',
    businessMode: 'general',
    mode,
    status,
    skipReason: status === 'skipped' ? 'lead_replied' : null,
    errorCode: status === 'failed' ? 'provider_failed' : null,
    attemptCount: 1,
    createdAt: `2026-07-0${id.slice(-1)}T12:00:00.000Z`,
    startedAt: null,
    finishedAt: null,
    durationMs,
  };
}
