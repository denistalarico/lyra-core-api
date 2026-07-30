export type LeadFlowTelemetryConsentState =
  | 'not_configured'
  | 'opted_in'
  | 'opted_out'
  | 'erased';

export type LeadFlowTelemetryStatusResponse = {
  purpose: {
    key: string;
    description: string;
  };
  notice: {
    id: string;
    version: number;
    locale: string;
    title: string;
    body: string;
    contentHash: string;
    categories: string[];
    retentionDays: number;
    kAnonymityThreshold: number;
    legalReviewStatus: 'pending' | 'approved' | 'rejected';
    effectiveAt: string;
  } | null;
  consent: {
    state: LeadFlowTelemetryConsentState;
    occurredAt: string | null;
    noticeVersion: number | null;
    noticeContentHash: string | null;
    requiresRenewal: boolean;
  };
  collection: {
    platformGateEnabled: boolean;
    eligible: boolean;
    lastCollectedAt: string | null;
    contributedDailyFacts: number;
  };
  guarantees: {
    noMessageContent: true;
    noContactIdentity: true;
    pseudonymousFacts: true;
    identitySeparated: true;
    minimumAggregateScopes: number;
    optOutStopsCollection: true;
    erasureAvailable: true;
  };
  recentAudit: Array<{
    action: string;
    occurredAt: string;
    noticeVersion: number | null;
    details: Record<string, string | number | boolean | null>;
  }>;
};

export type LeadFlowTelemetryCollectionResponse = {
  from: string;
  to: string;
  days: number;
  factsWritten: number;
  terminalRuns: number;
  failedRuns: number;
};

export type LeadFlowProductTelemetryAggregate = {
  observedOn: string;
  metricKey: string;
  dimensionKey: string;
  metricValue: string;
  sampleSize: number;
  contributingScopes: number;
};
