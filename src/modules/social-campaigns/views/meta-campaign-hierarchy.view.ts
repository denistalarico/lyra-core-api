export type MetaCampaignAttentionReason =
  | 'archived'
  | 'budget_exhausted'
  | 'delivery_issue'
  | 'destination_unknown'
  | 'ended'
  | 'missing_name'
  | 'partial_data'
  | 'stale';

export type MetaCampaignNodeMetrics = {
  hasData: boolean;
  spend: string | null;
  impressions: string | null;
  clicks: string | null;
  leads: string | null;
  conversions: string | null;
  hasPartialData: boolean;
};

export type MetaCampaignOperationalNode = {
  externalId: string;
  name: string | null;
  status: string | null;
  effectiveStatus: string | null;
  archived: boolean;
  objective: string | null;
  optimizationGoal: string | null;
  billingEvent: string | null;
  destinationType: string | null;
  destinationRaw: string | null;
  budget: {
    dailyMinor: string | null;
    lifetimeMinor: string | null;
    remainingMinor: string | null;
    currency: string | null;
  };
  schedule: {
    startsAt: string | null;
    stopsAt: string | null;
  };
  freshness: {
    lastSeenAt: string;
    providerUpdatedAt: string | null;
  };
  metrics: MetaCampaignNodeMetrics;
  attentionReasons: MetaCampaignAttentionReason[];
};

export type MetaAdSetOperationalNode = MetaCampaignOperationalNode & {
  ads: MetaCampaignOperationalNode[];
};

export type MetaCampaignOperationalTree = MetaCampaignOperationalNode & {
  adSets: MetaAdSetOperationalNode[];
  unassignedAds: MetaCampaignOperationalNode[];
};

export type MetaCampaignHierarchyView = {
  connectionId: string;
  accountName: string | null;
  currency: string | null;
  timezone: string;
  connectionStatus: string;
  period: { since: string; until: string };
  filters: { status: string; search: string | null };
  freshness: {
    lastSyncedAt: string | null;
    hierarchyLastSeenAt: string | null;
    lastSyncError: string | null;
  };
  items: MetaCampaignOperationalTree[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
};
