/**
 * The consent scope, as a contributing domain sees it.
 *
 * Structurally identical to `IntelligenceScope` and deliberately declared here
 * rather than imported from it: this is the *consent* grain — the four columns
 * every consent, identity link and audit row is keyed by — and it must not drift
 * to follow an analytics type. `contextType` is omitted because it is derived
 * from `agencyClientId` and duplicating it would allow the two to disagree.
 *
 * No `userId` and no `role`. Consent belongs to the context, never to the person
 * who happened to accept the notice.
 */
export type TelemetryContributionScope = {
  tenantId: string;
  workspaceId: string;
  /** `null` means the agency's own context, never "any client". */
  agencyClientId: string | null;
};

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
    legalReviewStatus: 'pending' | 'provisional' | 'approved' | 'rejected';
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
  /**
   * What each registered contributing domain produced, by source key.
   *
   * Reported so that "Social contributed nothing" is visible as a zero rather
   * than as an absence indistinguishable from Social not being wired at all —
   * the two have very different causes and only one is a bug.
   */
  contributionsBySource: Array<{
    sourceKey: string;
    factsWritten: number;
  }>;
};

export type LeadFlowProductTelemetryAggregate = {
  observedOn: string;
  metricKey: string;
  dimensionKey: string;
  metricValue: string;
  sampleSize: number;
  contributingScopes: number;
};
