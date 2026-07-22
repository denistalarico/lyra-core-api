import type { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import type { CrmOpportunityEventEntity } from '../../crm/entities/crm-opportunity-event.entity';
import type { InboxConversationEventEntity } from '../../inbox/entities/inbox-conversation-event.entity';
import type {
  CommercialJourneyAnalytics,
  CommercialJourneyPipelineMetric,
  CommercialJourneyProjectionInput,
  CommercialJourneyStageMetric,
} from '../types/commercial-journey-analytics.types';

type PipelineAccumulator = Omit<
  CommercialJourneyPipelineMetric,
  'uniqueOpportunities' | 'averageTimeSeconds'
> & {
  opportunityIds: Set<string>;
  durationMs: number;
};

type StageAccumulator = Omit<
  CommercialJourneyStageMetric,
  'uniqueOpportunities' | 'averageTimeSeconds'
> & {
  opportunityIds: Set<string>;
  durationMs: number;
};

type Journey = {
  pipelineId: string;
  stageId: string;
  status: string;
  pipelineEnteredAt: number;
  stageEnteredAt: number;
  terminalAt: number | null;
  transfers: number;
  aiInfluenced: boolean;
  wonValueAmount: string | null;
  wonCurrency: string | null;
  missingCreationFact: boolean;
  legacyFallback: boolean;
};

const TERMINAL_STATUSES = new Set(['won', 'lost', 'archived', 'cancelled']);

export function projectCommercialJourney(
  input: CommercialJourneyProjectionInput,
): CommercialJourneyAnalytics {
  const toMs = input.to.getTime();
  const eventsByOpportunity = groupBy(
    input.opportunityEvents.filter(
      (event) => event.createdAt.getTime() <= toMs,
    ),
    (event) => event.opportunityId,
  );
  const conversationEvents = groupBy(
    input.conversationEvents.filter(
      (event) =>
        event.createdAt.getTime() >= input.from.getTime() &&
        event.createdAt.getTime() <= toMs,
    ),
    (event) => event.conversationId,
  );
  const pipelines = new Map<string, PipelineAccumulator>();
  const stages = new Map<string, StageAccumulator>();
  const statuses = { open: 0, won: 0, lost: 0, archived: 0 };
  const wonValues = new Map<
    string,
    { amount: number; opportunities: number }
  >();
  const transferredIds = new Set<string>();
  const aiInfluencedIds = new Set<string>();
  const linkedConversationIds = new Set(
    input.opportunities
      .map((opportunity) => opportunity.inboxConversationId)
      .filter((id): id is string => Boolean(id)),
  );
  let transfers = 0;
  let aiInfluencedWins = 0;
  let missingCreationFacts = 0;
  let legacyJourneyFallbacks = 0;

  for (const opportunity of input.opportunities) {
    const events = [...(eventsByOpportunity.get(opportunity.id) ?? [])].sort(
      compareEvents,
    );
    const journey = initializeJourney(opportunity, events);
    if (journey.missingCreationFact) missingCreationFacts += 1;
    enterPipeline(pipelines, journey.pipelineId, opportunity.id, true, input);
    enterStage(
      stages,
      journey.stageId,
      journey.pipelineId,
      opportunity.id,
      input,
    );

    for (const event of events) {
      if (event.eventType === 'opportunity_created') continue;
      if (isAiInfluence(event)) journey.aiInfluenced = true;
      const occurredAt = event.createdAt.getTime();

      if (event.eventType === 'stage_changed') {
        const targetStageId = readString(event.afterData, 'stageId');
        if (targetStageId && targetStageId !== journey.stageId) {
          closeStage(stages, journey, occurredAt);
          journey.stageId = targetStageId;
          journey.stageEnteredAt = occurredAt;
          enterStage(
            stages,
            targetStageId,
            journey.pipelineId,
            opportunity.id,
            input,
          );
        }
      }

      if (event.eventType === 'pipeline_transferred') {
        const targetPipelineId = readString(event.afterData, 'pipelineId');
        const targetStageId = readString(event.afterData, 'stageId');
        if (targetPipelineId && targetPipelineId !== journey.pipelineId) {
          closeStage(stages, journey, occurredAt);
          closePipeline(pipelines, journey, occurredAt);
          pipelineMetric(pipelines, journey.pipelineId, input).transfersOut +=
            1;
          journey.pipelineId = targetPipelineId;
          journey.stageId = targetStageId || journey.stageId;
          journey.pipelineEnteredAt = occurredAt;
          journey.stageEnteredAt = occurredAt;
          journey.transfers += 1;
          enterPipeline(
            pipelines,
            journey.pipelineId,
            opportunity.id,
            false,
            input,
          );
          pipelineMetric(pipelines, journey.pipelineId, input).transfersIn += 1;
          enterStage(
            stages,
            journey.stageId,
            journey.pipelineId,
            opportunity.id,
            input,
          );
        }
      }

      const nextStatus = statusAfter(event);
      if (nextStatus) {
        journey.status = nextStatus;
        if (nextStatus === 'won' && journey.terminalAt === null) {
          journey.wonValueAmount = readNumberishString(
            event.afterData,
            'valueAmount',
          );
          journey.wonCurrency = readString(event.afterData, 'currency') || null;
          if (!journey.wonCurrency) journey.legacyFallback = true;
        }
        if (TERMINAL_STATUSES.has(nextStatus) && journey.terminalAt === null) {
          journey.terminalAt = occurredAt;
          closeStage(stages, journey, occurredAt);
          closePipeline(pipelines, journey, occurredAt);
        }
      }
    }

    if (
      journey.terminalAt === null &&
      TERMINAL_STATUSES.has(opportunity.status) &&
      opportunity.updatedAt.getTime() <= toMs
    ) {
      journey.status = opportunity.status;
      journey.terminalAt = terminalTimestamp(opportunity, toMs);
      journey.legacyFallback = true;
      closeStage(stages, journey, journey.terminalAt);
      closePipeline(pipelines, journey, journey.terminalAt);
    }

    if (journey.terminalAt === null) {
      journey.status = 'open';
      closeStage(stages, journey, toMs);
      closePipeline(pipelines, journey, toMs);
      pipelineMetric(pipelines, journey.pipelineId, input).openAtEnd += 1;
      stageMetric(
        stages,
        journey.stageId,
        journey.pipelineId,
        input,
      ).openAtEnd += 1;
    }

    if (journey.legacyFallback) legacyJourneyFallbacks += 1;
    if (journey.transfers > 0) {
      transfers += journey.transfers;
      transferredIds.add(opportunity.id);
    }
    if (journey.aiInfluenced) {
      aiInfluencedIds.add(opportunity.id);
      if (journey.status === 'won') aiInfluencedWins += 1;
    }

    if (journey.status === 'won') {
      statuses.won += 1;
      pipelineMetric(pipelines, journey.pipelineId, input).wins += 1;
      stageMetric(stages, journey.stageId, journey.pipelineId, input).wins += 1;
      addWonValue(wonValues, opportunity, journey);
    } else if (journey.status === 'lost') {
      statuses.lost += 1;
      pipelineMetric(pipelines, journey.pipelineId, input).losses += 1;
      stageMetric(stages, journey.stageId, journey.pipelineId, input).losses +=
        1;
    } else if (
      journey.status === 'archived' ||
      journey.status === 'cancelled'
    ) {
      statuses.archived += 1;
    } else {
      statuses.open += 1;
    }
  }

  const handoff = projectHandoffs(linkedConversationIds, conversationEvents);
  const opportunityCount = input.opportunities.length;

  return {
    period: {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      cohort: 'opportunity_created_at',
    },
    summary: {
      opportunities: opportunityCount,
      ...statuses,
      winRate: ratio(statuses.won, opportunityCount),
      transfers,
      transferredOpportunities: transferredIds.size,
      linkedConversations: linkedConversationIds.size,
      handoffRequested: handoff.requested,
      handoffAccepted: handoff.accepted,
      handoffRate: ratio(handoff.requested, linkedConversationIds.size),
      handoffTransferCompleted: handoff.transferCompleted,
      handoffTransferFailed: handoff.transferFailed,
      aiInfluencedOpportunities: aiInfluencedIds.size,
      aiInfluencedWins,
      aiInfluenceRate: ratio(aiInfluencedIds.size, opportunityCount),
    },
    wonValueByCurrency: [...wonValues.entries()]
      .map(([currency, value]) => ({
        currency,
        amount: value.amount.toFixed(2),
        opportunities: value.opportunities,
      }))
      .sort((first, second) => first.currency.localeCompare(second.currency)),
    pipelines: [...pipelines.values()]
      .map((metric) => ({
        pipelineId: metric.pipelineId,
        name: metric.name,
        cohortEntries: metric.cohortEntries,
        entries: metric.entries,
        uniqueOpportunities: metric.opportunityIds.size,
        transfersIn: metric.transfersIn,
        transfersOut: metric.transfersOut,
        wins: metric.wins,
        losses: metric.losses,
        openAtEnd: metric.openAtEnd,
        averageTimeSeconds: averageSeconds(metric.durationMs, metric.entries),
      }))
      .sort(metricOrder),
    stages: [...stages.values()]
      .map((metric) => ({
        stageId: metric.stageId,
        pipelineId: metric.pipelineId,
        name: metric.name,
        entries: metric.entries,
        uniqueOpportunities: metric.opportunityIds.size,
        wins: metric.wins,
        losses: metric.losses,
        openAtEnd: metric.openAtEnd,
        averageTimeSeconds: averageSeconds(metric.durationMs, metric.entries),
      }))
      .sort(metricOrder),
    dataQuality: { missingCreationFacts, legacyJourneyFallbacks },
  };
}

function initializeJourney(
  opportunity: CrmOpportunityEntity,
  events: CrmOpportunityEventEntity[],
): Journey {
  const creation = events.find(
    (event) => event.eventType === 'opportunity_created',
  );
  const firstTransfer = events.find(
    (event) => event.eventType === 'pipeline_transferred',
  );
  const initialPipelineId =
    readString(creation?.afterData, 'pipelineId') ||
    readString(firstTransfer?.beforeData, 'pipelineId') ||
    opportunity.pipelineId;
  const initialStageId =
    readString(creation?.afterData, 'stageId') ||
    readString(firstTransfer?.beforeData, 'stageId') ||
    opportunity.stageId;
  const enteredAt =
    creation?.createdAt.getTime() ?? opportunity.createdAt.getTime();

  return {
    pipelineId: initialPipelineId,
    stageId: initialStageId,
    status: readString(creation?.afterData, 'status') || 'open',
    pipelineEnteredAt: enteredAt,
    stageEnteredAt: enteredAt,
    terminalAt: null,
    transfers: 0,
    aiInfluenced: Boolean(creation && isAiInfluence(creation)),
    wonValueAmount: null,
    wonCurrency: null,
    missingCreationFact: !creation,
    legacyFallback: !creation && !firstTransfer,
  };
}

function enterPipeline(
  metrics: Map<string, PipelineAccumulator>,
  pipelineId: string,
  opportunityId: string,
  cohortEntry: boolean,
  input: CommercialJourneyProjectionInput,
) {
  const metric = pipelineMetric(metrics, pipelineId, input);
  metric.entries += 1;
  if (cohortEntry) metric.cohortEntries += 1;
  metric.opportunityIds.add(opportunityId);
}

function enterStage(
  metrics: Map<string, StageAccumulator>,
  stageId: string,
  pipelineId: string,
  opportunityId: string,
  input: CommercialJourneyProjectionInput,
) {
  const metric = stageMetric(metrics, stageId, pipelineId, input);
  metric.entries += 1;
  metric.opportunityIds.add(opportunityId);
}

function closePipeline(
  metrics: Map<string, PipelineAccumulator>,
  journey: Journey,
  at: number,
) {
  const metric = metrics.get(journey.pipelineId);
  if (metric) metric.durationMs += Math.max(0, at - journey.pipelineEnteredAt);
  journey.pipelineEnteredAt = at;
}

function closeStage(
  metrics: Map<string, StageAccumulator>,
  journey: Journey,
  at: number,
) {
  const metric = metrics.get(journey.stageId);
  if (metric) metric.durationMs += Math.max(0, at - journey.stageEnteredAt);
  journey.stageEnteredAt = at;
}

function pipelineMetric(
  metrics: Map<string, PipelineAccumulator>,
  pipelineId: string,
  input: CommercialJourneyProjectionInput,
) {
  const existing = metrics.get(pipelineId);
  if (existing) return existing;
  const created: PipelineAccumulator = {
    pipelineId,
    name: input.pipelineNames.get(pipelineId) ?? pipelineId,
    cohortEntries: 0,
    entries: 0,
    opportunityIds: new Set(),
    transfersIn: 0,
    transfersOut: 0,
    wins: 0,
    losses: 0,
    openAtEnd: 0,
    durationMs: 0,
  };
  metrics.set(pipelineId, created);
  return created;
}

function stageMetric(
  metrics: Map<string, StageAccumulator>,
  stageId: string,
  pipelineId: string,
  input: CommercialJourneyProjectionInput,
) {
  const existing = metrics.get(stageId);
  if (existing) return existing;
  const definition = input.stageNames.get(stageId);
  const created: StageAccumulator = {
    stageId,
    pipelineId: definition?.pipelineId ?? pipelineId,
    name: definition?.name ?? stageId,
    entries: 0,
    opportunityIds: new Set(),
    wins: 0,
    losses: 0,
    openAtEnd: 0,
    durationMs: 0,
  };
  metrics.set(stageId, created);
  return created;
}

function projectHandoffs(
  conversationIds: Set<string>,
  eventsByConversation: Map<string, InboxConversationEventEntity[]>,
) {
  let requested = 0;
  let accepted = 0;
  let transferCompleted = 0;
  let transferFailed = 0;
  for (const conversationId of conversationIds) {
    const types = new Set(
      (eventsByConversation.get(conversationId) ?? []).map(
        (event) => event.eventType,
      ),
    );
    if (types.has('ownership_request_handoff')) requested += 1;
    if (types.has('ownership_assume')) accepted += 1;
    if (types.has('handoff_transfer_completed')) transferCompleted += 1;
    if (types.has('handoff_transfer_failed')) transferFailed += 1;
  }
  return { requested, accepted, transferCompleted, transferFailed };
}

function statusAfter(event: CrmOpportunityEventEntity) {
  const status = readString(event.afterData, 'status');
  if (status) return status;
  if (event.eventType === 'opportunity_won') return 'won';
  if (event.eventType === 'opportunity_lost') return 'lost';
  return null;
}

function isAiInfluence(event: CrmOpportunityEventEntity) {
  return (
    event.actorType === 'ai' ||
    event.reason === 'governed_autonomy' ||
    typeof event.metadata?.governedActionId === 'string'
  );
}

function addWonValue(
  values: Map<string, { amount: number; opportunities: number }>,
  opportunity: CrmOpportunityEntity,
  journey: Journey,
) {
  const amount = Number(journey.wonValueAmount ?? opportunity.valueAmount ?? 0);
  const currency = (journey.wonCurrency ?? opportunity.currency) || 'BRL';
  const current = values.get(currency) ?? { amount: 0, opportunities: 0 };
  current.amount += Number.isFinite(amount) ? amount : 0;
  current.opportunities += 1;
  values.set(currency, current);
}

function terminalTimestamp(opportunity: CrmOpportunityEntity, toMs: number) {
  const candidate =
    opportunity.status === 'won'
      ? opportunity.wonAt
      : opportunity.status === 'lost'
        ? opportunity.lostAt
        : opportunity.updatedAt;
  return Math.min(
    candidate?.getTime() ?? opportunity.updatedAt.getTime(),
    toMs,
  );
}

function readString(value: Record<string, unknown> | undefined, key: string) {
  const candidate = value?.[key];
  return typeof candidate === 'string' ? candidate : '';
}

function readNumberishString(
  value: Record<string, unknown> | undefined,
  key: string,
) {
  const candidate = value?.[key];
  return typeof candidate === 'string' || typeof candidate === 'number'
    ? String(candidate)
    : null;
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const grouped = new Map<string, T[]>();
  for (const item of items) {
    const id = key(item);
    grouped.set(id, [...(grouped.get(id) ?? []), item]);
  }
  return grouped;
}

function compareEvents(
  first: CrmOpportunityEventEntity,
  second: CrmOpportunityEventEntity,
) {
  return (
    first.createdAt.getTime() - second.createdAt.getTime() ||
    first.id.localeCompare(second.id)
  );
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : Number((numerator / denominator).toFixed(4));
}

function averageSeconds(durationMs: number, entries: number) {
  return entries === 0 ? 0 : Math.round(durationMs / entries / 1000);
}

function metricOrder(
  first: { entries: number; name: string },
  second: { entries: number; name: string },
) {
  return (
    second.entries - first.entries || first.name.localeCompare(second.name)
  );
}
