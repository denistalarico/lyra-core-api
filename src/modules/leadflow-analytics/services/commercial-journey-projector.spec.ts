import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmOpportunityEventEntity } from '../../crm/entities/crm-opportunity-event.entity';
import { InboxConversationEventEntity } from '../../inbox/entities/inbox-conversation-event.entity';
import { projectCommercialJourney } from './commercial-journey-projector';

const DAY = 86_400_000;
const startedAt = new Date('2026-07-01T00:00:00.000Z');

function opportunity(
  values: Partial<CrmOpportunityEntity> = {},
): CrmOpportunityEntity {
  return {
    id: 'opportunity-1',
    tenantId: 'tenant',
    workspaceId: 'workspace',
    pipelineId: 'pipeline-b',
    stageId: 'stage-b2',
    contactId: 'contact-1',
    contactName: 'Contato',
    contactEmail: null,
    contactPhone: null,
    inboxConversationId: 'conversation-1',
    sourceOpportunityId: null,
    title: 'Negócio',
    description: null,
    valueAmount: '1250.50',
    currency: 'BRL',
    status: 'won',
    priority: 'normal',
    source: 'whatsapp',
    businessMode: 'general',
    operationalStatus: null,
    businessContext: {},
    assignedUserId: null,
    expectedCloseDate: null,
    nextFollowUpAt: null,
    lastActivityAt: null,
    wonAt: new Date(startedAt.getTime() + 5 * DAY),
    lostAt: null,
    lostReason: null,
    cardColor: null,
    sortOrder: 0,
    visibility: 'workspace',
    followMode: 'manual',
    followMessage: null,
    followSendAutomatically: false,
    metadata: {},
    rowVersion: 4,
    createdAt: startedAt,
    updatedAt: new Date(startedAt.getTime() + 5 * DAY),
    deletedAt: null,
    ...values,
  };
}

function crmEvent(
  id: string,
  day: number,
  eventType: string,
  values: Partial<CrmOpportunityEventEntity> = {},
): CrmOpportunityEventEntity {
  return {
    id,
    tenantId: 'tenant',
    workspaceId: 'workspace',
    opportunityId: 'opportunity-1',
    actorType: 'user',
    actorUserId: null,
    actorAgentId: null,
    eventType,
    title: eventType,
    description: null,
    beforeData: {},
    afterData: {},
    reason: null,
    confidence: null,
    metadata: {},
    eventVersion: 1,
    idempotencyKey: null,
    correlationId: 'correlation',
    causationId: null,
    policyVersion: null,
    createdAt: new Date(startedAt.getTime() + day * DAY),
    ...values,
  };
}

function inboxEvent(
  id: string,
  eventType: string,
): InboxConversationEventEntity {
  return {
    id,
    tenantId: 'tenant',
    workspaceId: 'workspace',
    conversationId: 'conversation-1',
    eventType,
    actorType: 'system',
    actorUserId: null,
    payload: {},
    createdAt: new Date(startedAt.getTime() + 2 * DAY),
  };
}

describe('commercial journey projector', () => {
  it('preserves origin, visited pipelines, closing pipeline, durations and unique gain', () => {
    const result = projectCommercialJourney({
      from: startedAt,
      to: new Date(startedAt.getTime() + 7 * DAY),
      opportunities: [opportunity()],
      opportunityEvents: [
        crmEvent('event-1', 0, 'opportunity_created', {
          actorType: 'automation',
          reason: 'governed_autonomy',
          afterData: {
            pipelineId: 'pipeline-a',
            stageId: 'stage-a',
            status: 'open',
          },
        }),
        crmEvent('event-2', 2, 'pipeline_transferred', {
          beforeData: { pipelineId: 'pipeline-a', stageId: 'stage-a' },
          afterData: { pipelineId: 'pipeline-b', stageId: 'stage-b1' },
        }),
        crmEvent('event-3', 3, 'stage_changed', {
          actorType: 'ai',
          beforeData: { stageId: 'stage-b1', status: 'open' },
          afterData: { stageId: 'stage-b2', status: 'open' },
        }),
        crmEvent('event-4', 5, 'status_changed', {
          beforeData: { status: 'open' },
          afterData: {
            status: 'won',
            pipelineId: 'pipeline-b',
            stageId: 'stage-b2',
            valueAmount: '1250.50',
            currency: 'BRL',
          },
        }),
        crmEvent('event-5', 5, 'opportunity_won', {
          afterData: { status: 'won' },
        }),
        crmEvent('event-6', 5, 'opportunity_won', {
          afterData: { status: 'won' },
        }),
      ],
      conversationEvents: [
        inboxEvent('inbox-1', 'ownership_request_handoff'),
        inboxEvent('inbox-2', 'ownership_assume'),
        inboxEvent('inbox-3', 'handoff_transfer_completed'),
      ],
      pipelineNames: new Map([
        ['pipeline-a', 'Aquisição'],
        ['pipeline-b', 'Vendas'],
      ]),
      stageNames: new Map([
        ['stage-a', { name: 'Novo', pipelineId: 'pipeline-a' }],
        ['stage-b1', { name: 'Recebido', pipelineId: 'pipeline-b' }],
        ['stage-b2', { name: 'Fechamento', pipelineId: 'pipeline-b' }],
      ]),
    });

    expect(result.summary).toMatchObject({
      opportunities: 1,
      won: 1,
      winRate: 1,
      transfers: 1,
      transferredOpportunities: 1,
      linkedConversations: 1,
      handoffRequested: 1,
      handoffAccepted: 1,
      handoffRate: 1,
      handoffTransferCompleted: 1,
      aiInfluencedOpportunities: 1,
      aiInfluencedWins: 1,
    });
    expect(result.wonValueByCurrency).toEqual([
      { currency: 'BRL', amount: '1250.50', opportunities: 1 },
    ]);
    expect(result.pipelines).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          pipelineId: 'pipeline-a',
          cohortEntries: 1,
          transfersOut: 1,
          wins: 0,
          averageTimeSeconds: 2 * 24 * 60 * 60,
        }),
        expect.objectContaining({
          pipelineId: 'pipeline-b',
          cohortEntries: 0,
          transfersIn: 1,
          wins: 1,
          averageTimeSeconds: 3 * 24 * 60 * 60,
        }),
      ]),
    );
    expect(result.stages).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          stageId: 'stage-a',
          averageTimeSeconds: 2 * 24 * 60 * 60,
        }),
        expect.objectContaining({
          stageId: 'stage-b1',
          averageTimeSeconds: 24 * 60 * 60,
        }),
        expect.objectContaining({
          stageId: 'stage-b2',
          wins: 1,
          averageTimeSeconds: 2 * 24 * 60 * 60,
        }),
      ]),
    );
  });

  it('keeps distinct opportunities for the same contact and flags legacy fallbacks', () => {
    const first = opportunity({
      id: 'opportunity-legacy-1',
      inboxConversationId: null,
      contactId: 'same-contact',
      pipelineId: 'pipeline-a',
      stageId: 'stage-a',
      status: 'lost',
      valueAmount: null,
      wonAt: null,
      lostAt: new Date(startedAt.getTime() + DAY),
      updatedAt: new Date(startedAt.getTime() + DAY),
    });
    const second = opportunity({
      id: 'opportunity-legacy-2',
      inboxConversationId: null,
      contactId: 'same-contact',
      pipelineId: 'pipeline-a',
      stageId: 'stage-a',
      createdAt: new Date(startedAt.getTime() + 2 * DAY),
    });

    const result = projectCommercialJourney({
      from: startedAt,
      to: new Date(startedAt.getTime() + 7 * DAY),
      opportunities: [first, second],
      opportunityEvents: [],
      conversationEvents: [],
      pipelineNames: new Map([['pipeline-a', 'Aquisição']]),
      stageNames: new Map([
        ['stage-a', { name: 'Novo', pipelineId: 'pipeline-a' }],
      ]),
    });

    expect(result.summary).toMatchObject({
      opportunities: 2,
      won: 1,
      lost: 1,
    });
    expect(result.dataQuality).toEqual({
      missingCreationFacts: 2,
      legacyJourneyFallbacks: 2,
    });
  });
});
