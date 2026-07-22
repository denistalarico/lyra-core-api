import type { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import type { CrmOpportunityEventEntity } from '../../crm/entities/crm-opportunity-event.entity';
import type { InboxConversationEventEntity } from '../../inbox/entities/inbox-conversation-event.entity';

export type CommercialJourneyPipelineMetric = {
  pipelineId: string;
  name: string;
  cohortEntries: number;
  entries: number;
  uniqueOpportunities: number;
  transfersIn: number;
  transfersOut: number;
  wins: number;
  losses: number;
  openAtEnd: number;
  averageTimeSeconds: number;
};

export type CommercialJourneyStageMetric = {
  stageId: string;
  pipelineId: string;
  name: string;
  entries: number;
  uniqueOpportunities: number;
  wins: number;
  losses: number;
  openAtEnd: number;
  averageTimeSeconds: number;
};

export type CommercialJourneyAnalytics = {
  period: {
    from: string;
    to: string;
    cohort: 'opportunity_created_at';
  };
  summary: {
    opportunities: number;
    open: number;
    won: number;
    lost: number;
    archived: number;
    winRate: number;
    transfers: number;
    transferredOpportunities: number;
    linkedConversations: number;
    handoffRequested: number;
    handoffAccepted: number;
    handoffRate: number;
    handoffTransferCompleted: number;
    handoffTransferFailed: number;
    aiInfluencedOpportunities: number;
    aiInfluencedWins: number;
    aiInfluenceRate: number;
  };
  wonValueByCurrency: Array<{
    currency: string;
    amount: string;
    opportunities: number;
  }>;
  pipelines: CommercialJourneyPipelineMetric[];
  stages: CommercialJourneyStageMetric[];
  dataQuality: {
    missingCreationFacts: number;
    legacyJourneyFallbacks: number;
  };
};

export type CommercialJourneyProjectionInput = {
  from: Date;
  to: Date;
  opportunities: CrmOpportunityEntity[];
  opportunityEvents: CrmOpportunityEventEntity[];
  conversationEvents: InboxConversationEventEntity[];
  pipelineNames: Map<string, string>;
  stageNames: Map<string, { name: string; pipelineId: string }>;
};
