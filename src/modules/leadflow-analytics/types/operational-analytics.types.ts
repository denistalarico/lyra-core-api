export type OperationalAnalyticsFilters = {
  channelId: string | null;
  businessMode: string | null;
  agentId: string | null;
};

export type OperationalAnalyticsMessageFact = {
  id: string;
  conversationId: string;
  direction: 'inbound' | 'outbound';
  senderType: string;
  senderAgentId: string | null;
  status: string;
  occurredAt: string;
  channelId: string | null;
  channelName: string | null;
  channelType: string | null;
  businessMode: string;
  assignedAgentId: string | null;
};

export type OperationalAnalyticsScoreFact = {
  opportunityId: string;
  score: number;
  band: string;
  previousScore: number | null;
  previousBand: string | null;
  policyVersion: string;
  maxAchievable: number;
  calculatedAt: string;
  businessMode: string;
  channelId: string | null;
  channelType: string | null;
  assignedAgentId: string | null;
};

export type OperationalAnalyticsRunFact = {
  id: string;
  automationId: string;
  automationName: string;
  recipeKey: string;
  businessMode: string;
  mode: string;
  status: string;
  skipReason: string | null;
  errorCode: string | null;
  attemptCount: number;
  createdAt: string;
  startedAt: string | null;
  finishedAt: string | null;
  durationMs: number | null;
};

export type OperationalAnalyticsAttemptMetric = {
  runId: string;
  confirmedEffects: number;
  failedAttempts: number;
};

export type OperationalAnalyticsDimensionOptions = {
  channels: Array<{
    id: string;
    name: string;
    type: string;
  }>;
  businessModes: string[];
  agents: Array<{
    id: string;
    name: string;
    type: string;
  }>;
};

export type OperationalAnalytics = {
  period: {
    from: string;
    to: string;
    messageTime: 'occurred_at';
    scoreTime: 'calculated_at';
    automationTime: 'created_at';
  };
  appliedFilters: OperationalAnalyticsFilters;
  filterOptions: OperationalAnalyticsDimensionOptions;
  messages: {
    summary: {
      total: number;
      inbound: number;
      outbound: number;
      automatedOutbound: number;
      humanOutbound: number;
      failedOutbound: number;
      conversations: number;
      inboundConversations: number;
      respondedConversations: number;
      firstResponseRate: number;
      averageFirstResponseSeconds: number;
      averageResponseSeconds: number;
      leadRepliesAfterFirstAgentReply: number;
    };
    byChannel: Array<{
      channelId: string | null;
      name: string;
      type: string;
      inbound: number;
      outbound: number;
      conversations: number;
      averageResponseSeconds: number;
    }>;
    byBusinessMode: Array<{
      businessMode: string;
      inbound: number;
      outbound: number;
      conversations: number;
      averageResponseSeconds: number;
    }>;
    byAgent: Array<{
      agentId: string;
      name: string;
      outbound: number;
      conversations: number;
      averageResponseSeconds: number;
      leadRepliesAfterFirstReply: number;
    }>;
  };
  leadScore: {
    summary: {
      calculations: number;
      opportunities: number;
      averageScore: number;
      averageAttainmentRate: number;
      averageDelta: number;
      hotTransitions: number;
    };
    distribution: Array<{
      band: string;
      opportunities: number;
      share: number;
    }>;
    byBusinessMode: Array<{
      businessMode: string;
      opportunities: number;
      averageScore: number;
      averageAttainmentRate: number;
      hot: number;
    }>;
    policyVersions: Array<{
      policyVersion: string;
      calculations: number;
      opportunities: number;
    }>;
  };
  automations: {
    summary: {
      runs: number;
      live: number;
      shadow: number;
      dryRun: number;
      succeeded: number;
      skipped: number;
      failed: number;
      cancelled: number;
      successRate: number;
      averageDurationMs: number;
      confirmedEffects: number;
      failedAttempts: number;
    };
    byRecipe: Array<{
      recipeKey: string;
      name: string;
      businessMode: string;
      runs: number;
      live: number;
      succeeded: number;
      skipped: number;
      failed: number;
      successRate: number;
      averageDurationMs: number;
    }>;
    recentRuns: Array<{
      id: string;
      automationId: string;
      automationName: string;
      recipeKey: string;
      businessMode: string;
      mode: string;
      status: string;
      skipReason: string | null;
      errorCode: string | null;
      attemptCount: number;
      confirmedEffects: number;
      failedAttempts: number;
      createdAt: string;
      startedAt: string | null;
      finishedAt: string | null;
      durationMs: number | null;
    }>;
  };
  dataQuality: {
    messageFacts: number;
    scoreFacts: number;
    runFacts: number;
    responsePairs: number;
    scoreDistributionBasis: 'latest_calculation_in_period_per_opportunity';
    messageDimensionAttribution: 'current_conversation';
    scoreDimensionAttribution: 'current_opportunity_and_conversation';
    agentScoreAttribution: 'current_conversation_assignment';
    automationBusinessModeAttribution: 'current_automation';
    filtersNotApplicableToAutomationRuns: Array<'channelId' | 'agentId'>;
  };
};

export type OperationalAnalyticsProjectionInput = {
  from: Date;
  to: Date;
  filters: OperationalAnalyticsFilters;
  options: OperationalAnalyticsDimensionOptions;
  messages: OperationalAnalyticsMessageFact[];
  scores: OperationalAnalyticsScoreFact[];
  runs: OperationalAnalyticsRunFact[];
  attempts: OperationalAnalyticsAttemptMetric[];
  agentNames: Map<string, string>;
};
