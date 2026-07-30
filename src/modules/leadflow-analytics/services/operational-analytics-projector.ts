import type {
  OperationalAnalytics,
  OperationalAnalyticsMessageFact,
  OperationalAnalyticsProjectionInput,
  OperationalAnalyticsRunFact,
  OperationalAnalyticsScoreFact,
} from '../types/operational-analytics.types';

type ResponsePair = {
  conversationId: string;
  durationSeconds: number;
  channelKey: string;
  businessMode: string;
  responderAgentId: string | null;
};

type ConversationMetric = {
  conversationId: string;
  hasInbound: boolean;
  firstResponseSeconds: number | null;
  responsePairs: ResponsePair[];
  leadRepliedAfterFirstAgent: boolean;
  firstAgentId: string | null;
};

const SCORE_BAND_ORDER = ['cold', 'warm', 'hot'];

export function projectOperationalAnalytics(
  input: OperationalAnalyticsProjectionInput,
): OperationalAnalytics {
  const messageProjection = projectMessages(input.messages, input.agentNames);
  const scoreProjection = projectScores(input.scores);
  const automationProjection = projectAutomations(input.runs, input.attempts);

  return {
    period: {
      from: input.from.toISOString(),
      to: input.to.toISOString(),
      messageTime: 'occurred_at',
      scoreTime: 'calculated_at',
      automationTime: 'created_at',
    },
    appliedFilters: input.filters,
    filterOptions: input.options,
    messages: messageProjection.metrics,
    leadScore: scoreProjection,
    automations: automationProjection,
    dataQuality: {
      messageFacts: input.messages.length,
      scoreFacts: input.scores.length,
      runFacts: input.runs.length,
      responsePairs: messageProjection.responsePairs.length,
      scoreDistributionBasis: 'latest_calculation_in_period_per_opportunity',
      messageDimensionAttribution: 'current_conversation',
      scoreDimensionAttribution: 'current_opportunity_and_conversation',
      agentScoreAttribution: 'current_conversation_assignment',
      automationBusinessModeAttribution: 'current_automation',
      filtersNotApplicableToAutomationRuns: [
        ...(input.filters.channelId ? (['channelId'] as const) : []),
        ...(input.filters.agentId ? (['agentId'] as const) : []),
      ],
    },
  };
}

function projectMessages(
  facts: OperationalAnalyticsMessageFact[],
  agentNames: Map<string, string>,
) {
  const ordered = [...facts].sort(
    (left, right) =>
      toMillis(left.occurredAt) - toMillis(right.occurredAt) ||
      left.id.localeCompare(right.id),
  );
  const conversations = new Map<string, OperationalAnalyticsMessageFact[]>();
  for (const fact of ordered) {
    const bucket = conversations.get(fact.conversationId) ?? [];
    bucket.push(fact);
    conversations.set(fact.conversationId, bucket);
  }

  const conversationMetrics = [...conversations.values()].map(
    projectConversation,
  );
  const responsePairs = conversationMetrics.flatMap(
    (metric) => metric.responsePairs,
  );
  const inboundConversations = conversationMetrics.filter(
    (metric) => metric.hasInbound,
  );
  const firstResponses = inboundConversations
    .map((metric) => metric.firstResponseSeconds)
    .filter((value): value is number => value !== null);
  const inbound = facts.filter((fact) => fact.direction === 'inbound').length;
  const outbound = facts.filter(isSuccessfulOutbound);

  return {
    responsePairs,
    metrics: {
      summary: {
        total: facts.length,
        inbound,
        outbound: outbound.length,
        automatedOutbound: outbound.filter(
          (fact) => fact.senderType === 'agent',
        ).length,
        humanOutbound: outbound.filter((fact) => fact.senderType === 'user')
          .length,
        failedOutbound: facts.filter(
          (fact) => fact.direction === 'outbound' && fact.status === 'failed',
        ).length,
        conversations: conversations.size,
        inboundConversations: inboundConversations.length,
        respondedConversations: inboundConversations.filter(
          (metric) => metric.firstResponseSeconds !== null,
        ).length,
        firstResponseRate: ratio(
          firstResponses.length,
          inboundConversations.length,
        ),
        averageFirstResponseSeconds: average(firstResponses),
        averageResponseSeconds: average(
          responsePairs.map((pair) => pair.durationSeconds),
        ),
        leadRepliesAfterFirstAgentReply: conversationMetrics.filter(
          (metric) => metric.leadRepliedAfterFirstAgent,
        ).length,
      },
      byChannel: projectMessagesByChannel(facts, responsePairs),
      byBusinessMode: projectMessagesByBusinessMode(facts, responsePairs),
      byAgent: projectMessagesByAgent(
        facts,
        responsePairs,
        conversationMetrics,
        agentNames,
      ),
    },
  };
}

function projectConversation(
  facts: OperationalAnalyticsMessageFact[],
): ConversationMetric {
  const firstInbound = facts.find((fact) => fact.direction === 'inbound');
  let firstResponseSeconds: number | null = null;
  let pendingInboundAt: number | null = null;
  let firstAgentAt: number | null = null;
  let firstAgentId: string | null = null;
  let leadRepliedAfterFirstAgent = false;
  const responsePairs: ResponsePair[] = [];

  for (const fact of facts) {
    const occurredAt = toMillis(fact.occurredAt);
    if (fact.direction === 'inbound') {
      pendingInboundAt ??= occurredAt;
      if (firstAgentAt !== null && occurredAt > firstAgentAt) {
        leadRepliedAfterFirstAgent = true;
      }
      continue;
    }

    if (!isSuccessfulOutbound(fact)) {
      continue;
    }
    if (
      firstInbound &&
      firstResponseSeconds === null &&
      occurredAt >= toMillis(firstInbound.occurredAt)
    ) {
      firstResponseSeconds = secondsBetween(
        toMillis(firstInbound.occurredAt),
        occurredAt,
      );
    }
    if (pendingInboundAt !== null && occurredAt >= pendingInboundAt) {
      responsePairs.push({
        conversationId: fact.conversationId,
        durationSeconds: secondsBetween(pendingInboundAt, occurredAt),
        channelKey: fact.channelId ?? 'unassigned',
        businessMode: fact.businessMode || 'general',
        responderAgentId:
          fact.senderType === 'agent' ? fact.senderAgentId : null,
      });
      pendingInboundAt = null;
    }
    if (fact.senderType === 'agent' && firstAgentAt === null) {
      firstAgentAt = occurredAt;
      firstAgentId = fact.senderAgentId;
    }
  }

  return {
    conversationId: facts[0]?.conversationId ?? '',
    hasInbound: Boolean(firstInbound),
    firstResponseSeconds,
    responsePairs,
    leadRepliedAfterFirstAgent,
    firstAgentId,
  };
}

function projectMessagesByChannel(
  facts: OperationalAnalyticsMessageFact[],
  responsePairs: ResponsePair[],
) {
  const groups = groupBy(facts, (fact) => fact.channelId ?? 'unassigned');
  return [...groups.entries()]
    .map(([key, rows]) => {
      const first = rows[0];
      return {
        channelId: first.channelId,
        name: first.channelName ?? 'Sem canal',
        type: first.channelType ?? 'unknown',
        inbound: rows.filter((row) => row.direction === 'inbound').length,
        outbound: rows.filter(isSuccessfulOutbound).length,
        conversations: new Set(rows.map((row) => row.conversationId)).size,
        averageResponseSeconds: average(
          responsePairs
            .filter((pair) => pair.channelKey === key)
            .map((pair) => pair.durationSeconds),
        ),
      };
    })
    .sort(
      (left, right) =>
        right.inbound + right.outbound - (left.inbound + left.outbound) ||
        left.name.localeCompare(right.name),
    );
}

function projectMessagesByBusinessMode(
  facts: OperationalAnalyticsMessageFact[],
  responsePairs: ResponsePair[],
) {
  const groups = groupBy(facts, (fact) => fact.businessMode || 'general');
  return [...groups.entries()]
    .map(([businessMode, rows]) => ({
      businessMode,
      inbound: rows.filter((row) => row.direction === 'inbound').length,
      outbound: rows.filter(isSuccessfulOutbound).length,
      conversations: new Set(rows.map((row) => row.conversationId)).size,
      averageResponseSeconds: average(
        responsePairs
          .filter((pair) => pair.businessMode === businessMode)
          .map((pair) => pair.durationSeconds),
      ),
    }))
    .sort(
      (left, right) =>
        right.inbound + right.outbound - (left.inbound + left.outbound) ||
        left.businessMode.localeCompare(right.businessMode),
    );
}

function projectMessagesByAgent(
  facts: OperationalAnalyticsMessageFact[],
  responsePairs: ResponsePair[],
  conversations: ConversationMetric[],
  agentNames: Map<string, string>,
) {
  const outboundByAgent = groupBy(
    facts.filter(
      (fact) =>
        isSuccessfulOutbound(fact) &&
        fact.senderType === 'agent' &&
        fact.senderAgentId,
    ),
    (fact) => fact.senderAgentId as string,
  );
  return [...outboundByAgent.entries()]
    .map(([agentId, rows]) => ({
      agentId,
      name: agentNames.get(agentId) ?? 'Agente removido',
      outbound: rows.length,
      conversations: new Set(rows.map((row) => row.conversationId)).size,
      averageResponseSeconds: average(
        responsePairs
          .filter((pair) => pair.responderAgentId === agentId)
          .map((pair) => pair.durationSeconds),
      ),
      leadRepliesAfterFirstReply: conversations.filter(
        (conversation) =>
          conversation.firstAgentId === agentId &&
          conversation.leadRepliedAfterFirstAgent,
      ).length,
    }))
    .sort(
      (left, right) =>
        right.outbound - left.outbound || left.name.localeCompare(right.name),
    );
}

function projectScores(facts: OperationalAnalyticsScoreFact[]) {
  const latestByOpportunity = new Map<string, OperationalAnalyticsScoreFact>();
  for (const fact of facts) {
    const current = latestByOpportunity.get(fact.opportunityId);
    if (
      !current ||
      toMillis(fact.calculatedAt) >= toMillis(current.calculatedAt)
    ) {
      latestByOpportunity.set(fact.opportunityId, fact);
    }
  }
  const latest = [...latestByOpportunity.values()];
  const bandGroups = groupBy(latest, (fact) => fact.band || 'unknown');
  const orderedBands = [...bandGroups.keys()].sort((left, right) => {
    const leftIndex = SCORE_BAND_ORDER.indexOf(left);
    const rightIndex = SCORE_BAND_ORDER.indexOf(right);
    if (leftIndex === -1 && rightIndex === -1) return left.localeCompare(right);
    if (leftIndex === -1) return 1;
    if (rightIndex === -1) return -1;
    return leftIndex - rightIndex;
  });
  const businessModeGroups = groupBy(
    latest,
    (fact) => fact.businessMode || 'general',
  );
  const policyGroups = groupBy(facts, (fact) => fact.policyVersion);

  return {
    summary: {
      calculations: facts.length,
      opportunities: latest.length,
      averageScore: average(latest.map((fact) => fact.score)),
      averageAttainmentRate: average(
        latest.map((fact) =>
          fact.maxAchievable > 0 ? fact.score / fact.maxAchievable : 0,
        ),
        4,
      ),
      averageDelta: average(
        facts
          .filter((fact) => fact.previousScore !== null)
          .map((fact) => fact.score - (fact.previousScore as number)),
      ),
      hotTransitions: facts.filter(
        (fact) => fact.band === 'hot' && fact.previousBand !== 'hot',
      ).length,
    },
    distribution: orderedBands.map((band) => ({
      band,
      opportunities: bandGroups.get(band)?.length ?? 0,
      share: ratio(bandGroups.get(band)?.length ?? 0, latest.length),
    })),
    byBusinessMode: [...businessModeGroups.entries()]
      .map(([businessMode, rows]) => ({
        businessMode,
        opportunities: rows.length,
        averageScore: average(rows.map((row) => row.score)),
        averageAttainmentRate: average(
          rows.map((row) =>
            row.maxAchievable > 0 ? row.score / row.maxAchievable : 0,
          ),
          4,
        ),
        hot: rows.filter((row) => row.band === 'hot').length,
      }))
      .sort(
        (left, right) =>
          right.opportunities - left.opportunities ||
          left.businessMode.localeCompare(right.businessMode),
      ),
    policyVersions: [...policyGroups.entries()]
      .map(([policyVersion, rows]) => ({
        policyVersion,
        calculations: rows.length,
        opportunities: new Set(rows.map((row) => row.opportunityId)).size,
      }))
      .sort(
        (left, right) =>
          right.calculations - left.calculations ||
          left.policyVersion.localeCompare(right.policyVersion),
      ),
  };
}

function projectAutomations(
  runs: OperationalAnalyticsRunFact[],
  attemptMetrics: OperationalAnalyticsProjectionInput['attempts'],
) {
  const attempts = new Map(
    attemptMetrics.map((metric) => [metric.runId, metric]),
  );
  const durations = runs
    .map((run) => run.durationMs)
    .filter((duration): duration is number => duration !== null);
  const terminal = runs.filter((run) =>
    ['succeeded', 'failed'].includes(run.status),
  );
  const recipeGroups = groupBy(
    runs,
    (run) => `${run.recipeKey}\u0000${run.businessMode}`,
  );

  return {
    summary: {
      runs: runs.length,
      live: countBy(runs, 'mode', 'live'),
      shadow: countBy(runs, 'mode', 'shadow'),
      dryRun: countBy(runs, 'mode', 'dry_run'),
      succeeded: countBy(runs, 'status', 'succeeded'),
      skipped: countBy(runs, 'status', 'skipped'),
      failed: countBy(runs, 'status', 'failed'),
      cancelled: countBy(runs, 'status', 'cancelled'),
      successRate: ratio(countBy(runs, 'status', 'succeeded'), terminal.length),
      averageDurationMs: average(durations),
      confirmedEffects: sum(
        attemptMetrics.map((metric) => metric.confirmedEffects),
      ),
      failedAttempts: sum(
        attemptMetrics.map((metric) => metric.failedAttempts),
      ),
    },
    byRecipe: [...recipeGroups.values()]
      .map((rows) => projectRecipe(rows))
      .sort(
        (left, right) =>
          right.runs - left.runs || left.name.localeCompare(right.name),
      ),
    recentRuns: [...runs]
      .sort(
        (left, right) =>
          toMillis(right.createdAt) - toMillis(left.createdAt) ||
          right.id.localeCompare(left.id),
      )
      .slice(0, 50)
      .map((run) => ({
        ...run,
        confirmedEffects: attempts.get(run.id)?.confirmedEffects ?? 0,
        failedAttempts: attempts.get(run.id)?.failedAttempts ?? 0,
      })),
  };
}

function projectRecipe(rows: OperationalAnalyticsRunFact[]) {
  const first = rows[0];
  const terminal = rows.filter((row) =>
    ['succeeded', 'failed'].includes(row.status),
  );
  return {
    recipeKey: first.recipeKey,
    name: first.automationName,
    businessMode: first.businessMode,
    runs: rows.length,
    live: countBy(rows, 'mode', 'live'),
    succeeded: countBy(rows, 'status', 'succeeded'),
    skipped: countBy(rows, 'status', 'skipped'),
    failed: countBy(rows, 'status', 'failed'),
    successRate: ratio(countBy(rows, 'status', 'succeeded'), terminal.length),
    averageDurationMs: average(
      rows
        .map((row) => row.durationMs)
        .filter((duration): duration is number => duration !== null),
    ),
  };
}

function groupBy<T>(items: T[], key: (item: T) => string) {
  const groups = new Map<string, T[]>();
  for (const item of items) {
    const value = key(item);
    groups.set(value, [...(groups.get(value) ?? []), item]);
  }
  return groups;
}

function countBy<T extends Record<string, unknown>>(
  items: T[],
  key: keyof T,
  value: unknown,
) {
  return items.filter((item) => item[key] === value).length;
}

function average(values: number[], precision = 2) {
  if (values.length === 0) return 0;
  return round(sum(values) / values.length, precision);
}

function sum(values: number[]) {
  return values.reduce((total, value) => total + value, 0);
}

function ratio(numerator: number, denominator: number) {
  return denominator === 0 ? 0 : round(numerator / denominator, 4);
}

function round(value: number, precision: number) {
  const factor = 10 ** precision;
  return Math.round(value * factor) / factor;
}

function secondsBetween(from: number, to: number) {
  return Math.max(0, Math.round((to - from) / 1000));
}

function toMillis(value: string) {
  return new Date(value).getTime();
}

function isSuccessfulOutbound(fact: OperationalAnalyticsMessageFact) {
  return (
    fact.direction === 'outbound' &&
    ['sent', 'delivered', 'read'].includes(fact.status)
  );
}
