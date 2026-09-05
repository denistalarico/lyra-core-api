import {
  BUSINESS_MODE_CURRENT_ONLY_LIMITATION,
  BUSINESS_MODE_UNKNOWN_KEY_LIMITATION,
  UNCONFIGURED_BUSINESS_MODE,
} from '../../common/intelligence';
import type { LeadFlowCohortConversation } from '../leadflow-analytics/intelligence/leadflow-attribution-cohort.port';
import type { SocialAdHierarchyPath } from '../social-integrations/analytics/social-ad-hierarchy-lookup';
import {
  OBSERVED_ATTRIBUTION_SUMMARY_CONFLICT_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_CURRENCY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_UNUSUAL_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_IMMATURE_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_MESSAGING_MULTI_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_SPEND_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_UNRESOLVED_LIMITATION,
} from './observed-attribution-summary.contract';
import { ObservedAttributionSummaryService } from './observed-attribution-summary.service';

const SCOPE = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: 'client-1',
};

const WINDOW = { since: '2026-09-01', until: '2026-09-30' };
const CONNECTION = 'connection-1';

/** A long-past instant, so cohorts are mature unless a test says otherwise. */
const OLD = '2026-09-02T10:00:00.000Z';

function conversation(
  overrides: Partial<LeadFlowCohortConversation> = {},
): LeadFlowCohortConversation {
  return {
    conversationId: 'conversation-1',
    enteredAt: OLD,
    distinctAdIds: ['ad-1'],
    observationsCount: 1,
    attributionInstants: [OLD],
    channelType: 'whatsapp',
    provider: 'meta',
    firstQualifiedAt: null,
    ...overrides,
  };
}

function path(
  overrides: Partial<SocialAdHierarchyPath> = {},
): SocialAdHierarchyPath {
  return {
    connectionId: CONNECTION,
    adId: 'ad-1',
    adsetId: 'adset-1',
    campaignId: 'campaign-1',
    accountId: 'account-1',
    adsetEntityId: 'adset-entity-1',
    adName: 'Ad One',
    adsetName: 'Adset One',
    campaignName: 'Campaign One',
    ...overrides,
  };
}

type Harness = {
  service: ObservedAttributionSummaryService;
  cohort: {
    cohortConversations: jest.Mock;
    cohortOpportunities: jest.Mock;
    cohortEligibility: jest.Mock;
  };
  hierarchy: { lookupMany: jest.Mock };
  socialReads: { listConnections: jest.Mock };
  destinations: { destinationAtMany: jest.Mock };
  businessModes: { businessMode: jest.Mock };
};

/**
 * A destination reading, keyed the way the batch service keys them.
 *
 * The helper exists so a test states `(ad set, instant) → destination` in the
 * same vocabulary the real service uses; hand-built keys here would let the
 * spec pass while the projector's own key encoding diverged.
 */
function reading(
  adEntityId: string,
  instant: string,
  value: string,
): [
  string,
  {
    value: string;
    resolution: string;
    observedAt: string | null;
    raw: string | null;
  },
] {
  return [
    `${adEntityId}|${instant}`,
    {
      value,
      resolution: 'observed_destination',
      observedAt: instant,
      raw: value.toUpperCase(),
    },
  ];
}

function harness(input: {
  conversations?: LeadFlowCohortConversation[];
  opportunities?: unknown[];
  eligible?: number;
  unsupported?: number;
  paths?: Map<string, SocialAdHierarchyPath>;
  timezone?: string | null;
  destinations?: Map<string, unknown>;
}): Harness {
  const cohort = {
    cohortConversations: jest.fn().mockResolvedValue(input.conversations ?? []),
    cohortOpportunities: jest.fn().mockResolvedValue(input.opportunities ?? []),
    cohortEligibility: jest.fn().mockResolvedValue({
      eligibleConversations: input.eligible ?? 0,
      unsupportedConversations: input.unsupported ?? 0,
    }),
  };

  const hierarchy = {
    lookupMany: jest.fn().mockResolvedValue(input.paths ?? new Map()),
  };

  const socialReads = {
    listConnections: jest.fn().mockResolvedValue([
      {
        id: CONNECTION,
        // `??` would turn an explicitly-passed null back into the default and
        // silently skip the UTC-fallback case this harness exists to cover.
        timezone: 'timezone' in input ? input.timezone : 'America/Sao_Paulo',
      },
    ]),
  };

  /**
   * Models the real batch method's contract, not just its happy path: a pair
   * with no preceding observation comes back as an explicit unavailable reading
   * rather than being absent from the map. A mock that simply returned the
   * supplied entries would let the projector's "not asked" and "nothing found"
   * paths pass untested.
   */
  const supplied = input.destinations ?? new Map<string, unknown>();
  const destinations = {
    destinationAtMany: jest
      .fn()
      .mockImplementation(
        (query: { pairs: { adEntityId: string; instant: string }[] }) => {
          const resolved = new Map<string, unknown>();

          for (const pair of query.pairs) {
            const key = `${pair.adEntityId}|${pair.instant}`;
            resolved.set(
              key,
              supplied.get(key) ?? {
                value: 'unknown',
                resolution: 'unavailable_before_first_observation',
                observedAt: null,
                raw: null,
              },
            );
          }

          return Promise.resolve(resolved);
        },
      ),
  };

  // I5's dimension. A configured mode by default, so a test that wants the
  // absent case has to ask for it rather than inherit it.
  const businessModes = {
    businessMode: jest.fn().mockResolvedValue({
      key: 'clinics_esthetics',
      label: 'Clínicas e Estética',
      resolution: 'configured',
      source: 'leadflow_client_settings',
      temporalSemantics: 'current_context_dimension',
    }),
  };

  return {
    service: new ObservedAttributionSummaryService(
      cohort as never,
      hierarchy as never,
      socialReads as never,
      destinations as never,
      businessModes as never,
    ),
    cohort,
    hierarchy,
    socialReads,
    destinations,
    businessModes,
  };
}

describe('ObservedAttributionSummaryService', () => {
  describe('counting', () => {
    it('aggregates a single matched conversation', async () => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.kind).toBe('observed_attribution_summary');
      expect(view.groups).toHaveLength(1);
      expect(view.groups[0].key).toBe('ad-1');
      expect(view.groups[0].attributedConversations).toBe(1);
      expect(view.coverage.matchedConversations).toBe(1);
    });

    /**
     * §3, and the failure this guards is the one that most flatters the numbers:
     * a repeat clicker counted three times would make every ad look better the
     * more often its own audience returned.
     */
    it('counts a multiple_consistent conversation once', async () => {
      const { service } = harness({
        conversations: [conversation({ observationsCount: 3 })],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups[0].attributedConversations).toBe(1);
      expect(view.groups[0].observationsCount).toBe(3);
    });

    it('preserves observationsCount across conversations', async () => {
      const { service } = harness({
        conversations: [
          conversation({ conversationId: 'c1', observationsCount: 2 }),
          conversation({ conversationId: 'c2', observationsCount: 5 }),
        ],
        eligible: 2,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups[0].attributedConversations).toBe(2);
      expect(view.groups[0].observationsCount).toBe(7);
    });
  });

  describe('exclusions', () => {
    /**
     * §18. Counted in quality, present in no group, and — the part that matters
     * — not split between the two ads it named.
     */
    it('excludes conflicting conversations from every group', async () => {
      const { service, hierarchy } = harness({
        conversations: [conversation({ distinctAdIds: ['ad-1', 'ad-2'] })],
        eligible: 1,
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups).toHaveLength(0);
      expect(view.coverage.conflictingConversations).toBe(1);
      expect(view.coverage.matchedConversations).toBe(0);
      expect(view.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_SUMMARY_CONFLICT_LIMITATION,
      );
      // Never even offered to the hierarchy, so no path can bring it back.
      expect(hierarchy.lookupMany).toHaveBeenCalledWith(
        expect.objectContaining({ adIds: [] }),
      );
    });

    /** §19: an observed id the mirror cannot place is reported, not bucketed. */
    it('excludes conversations whose ad does not resolve', async () => {
      const { service } = harness({
        conversations: [conversation({ distinctAdIds: ['ghost-ad'] })],
        eligible: 1,
        paths: new Map(),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups).toHaveLength(0);
      expect(view.coverage.unresolvedConversations).toBe(1);
      expect(view.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_SUMMARY_UNRESOLVED_LIMITATION,
      );
    });

    /**
     * A matched ad whose campaign never synced is skipped at that level rather
     * than bucketed under a placeholder — an "unknown campaign" row would be
     * read as a real campaign that happens to be unnamed.
     */
    it('skips a group whose level did not resolve', async () => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path({ campaignId: null })]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      expect(view.groups).toHaveLength(0);
      // Still matched — the attribution is real even where the hierarchy is not.
      expect(view.coverage.matchedConversations).toBe(1);
    });
  });

  describe('grouping levels', () => {
    it.each([
      ['ad', 'ad-1', 'Ad One'],
      ['adset', 'adset-1', 'Adset One'],
      ['campaign', 'campaign-1', 'Campaign One'],
      ['account', 'account-1', null],
    ] as const)('groups by %s', async (groupBy, key, name) => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, groupBy);

      expect(view.groupBy).toBe(groupBy);
      expect(view.groups[0].key).toBe(key);
      expect(view.groups[0].level).toBe(groupBy);
      expect(view.groups[0].name).toBe(name);
    });

    /**
     * Two ads under one campaign collapse at campaign level and stay separate at
     * ad level — the check that grouping actually regroups rather than relabels.
     */
    it('collapses sibling ads at the campaign level', async () => {
      const paths = new Map([
        ['ad-1', path()],
        ['ad-2', path({ adId: 'ad-2', adsetId: 'adset-2', adName: 'Ad Two' })],
      ]);

      const conversations = [
        conversation({ conversationId: 'c1', distinctAdIds: ['ad-1'] }),
        conversation({ conversationId: 'c2', distinctAdIds: ['ad-2'] }),
      ];

      const byAd = await harness({
        conversations,
        eligible: 2,
        paths,
      }).service.summary(SCOPE, WINDOW, CONNECTION, 'ad');
      const byCampaign = await harness({
        conversations,
        eligible: 2,
        paths,
      }).service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      expect(byAd.groups).toHaveLength(2);
      expect(byCampaign.groups).toHaveLength(1);
      expect(byCampaign.groups[0].attributedConversations).toBe(2);
    });
  });

  describe('qualification', () => {
    it('counts a qualified conversation once', async () => {
      const { service } = harness({
        conversations: [
          conversation({ firstQualifiedAt: '2026-09-03T10:00:00.000Z' }),
        ],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups[0].qualifiedConversations).toBe(1);
    });

    /**
     * §9's entry-cohort rule: a qualification after the window still counts,
     * because the conversation entered inside it. Clipping would report a young
     * cohort as failing.
     */
    it('counts a qualification that happened after the window', async () => {
      const { service } = harness({
        conversations: [
          conversation({ firstQualifiedAt: '2026-11-15T10:00:00.000Z' }),
        ],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups[0].qualifiedConversations).toBe(1);
    });

    it('does not count an unqualified conversation', async () => {
      const { service } = harness({
        conversations: [conversation({ firstQualifiedAt: null })],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups[0].qualifiedConversations).toBe(0);
    });
  });

  describe('outcomes', () => {
    /** §13: several opportunities on one conversation, still one conversation. */
    it('counts multiple opportunities without multiplying the conversation', async () => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
        opportunities: [
          {
            conversationId: 'conversation-1',
            opportunityId: 'o1',
            status: 'won',
            isWon: true,
            wonAt: OLD,
            valueAmount: '100.00',
            currency: 'BRL',
          },
          {
            conversationId: 'conversation-1',
            opportunityId: 'o2',
            status: 'open',
            isWon: false,
            wonAt: null,
            valueAmount: '50.00',
            currency: 'BRL',
          },
        ],
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups[0].attributedConversations).toBe(1);
      expect(view.groups[0].opportunities).toBe(2);
      expect(view.groups[0].wonOpportunities).toBe(1);
      // Only the won deal contributes to the total.
      expect(view.groups[0].wonOpportunityValue).toBe('100.00');
    });

    it('sums won value within one currency', async () => {
      const { service } = harness({
        conversations: [
          conversation({ conversationId: 'c1' }),
          conversation({ conversationId: 'c2' }),
        ],
        eligible: 2,
        paths: new Map([['ad-1', path()]]),
        opportunities: [
          {
            conversationId: 'c1',
            opportunityId: 'o1',
            status: 'won',
            isWon: true,
            wonAt: OLD,
            valueAmount: '1234.56',
            currency: 'BRL',
          },
          {
            conversationId: 'c2',
            opportunityId: 'o2',
            status: 'won',
            isWon: true,
            wonAt: OLD,
            valueAmount: '0.44',
            currency: 'BRL',
          },
        ],
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      // Scaled-integer arithmetic: floating point would give 1235.0000000000002.
      expect(view.groups[0].wonOpportunityValue).toBe('1235.00');
      expect(view.groups[0].currency).toBe('BRL');
    });

    /**
     * §14. Null rather than a sum, because a single number on a campaign row
     * gives no hint that two units were added.
     */
    it('refuses to total across currencies', async () => {
      const { service } = harness({
        conversations: [
          conversation({ conversationId: 'c1' }),
          conversation({ conversationId: 'c2' }),
        ],
        eligible: 2,
        paths: new Map([['ad-1', path()]]),
        opportunities: [
          {
            conversationId: 'c1',
            opportunityId: 'o1',
            status: 'won',
            isWon: true,
            wonAt: OLD,
            valueAmount: '100.00',
            currency: 'BRL',
          },
          {
            conversationId: 'c2',
            opportunityId: 'o2',
            status: 'won',
            isWon: true,
            wonAt: OLD,
            valueAmount: '100.00',
            currency: 'USD',
          },
        ],
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups[0].wonOpportunityValue).toBeNull();
      expect(view.groups[0].currency).toBeNull();
      expect(view.groups[0].multiCurrency).toBe(true);
      expect(view.dataQuality.currencyCompatibility).toBe('mixed');
      expect(view.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_SUMMARY_CURRENCY_LIMITATION,
      );
    });

    /** A status of `won` with no `won_at` is an inconsistent write, not a win. */
    it('does not count a won status without a timestamp', async () => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
        opportunities: [
          {
            conversationId: 'conversation-1',
            opportunityId: 'o1',
            status: 'won',
            // The adapter resolves `isWon` from the canonical pair; a false
            // here is what a missing `won_at` produces.
            isWon: false,
            wonAt: null,
            valueAmount: '999.00',
            currency: 'BRL',
          },
        ],
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups[0].opportunities).toBe(1);
      expect(view.groups[0].wonOpportunities).toBe(0);
      expect(view.groups[0].wonOpportunityValue).toBe('0.00');
    });
  });

  describe('coverage', () => {
    it('divides matched by eligible', async () => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 4,
        unsupported: 7,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.coverage.observedCoverage).toBe(0.25);
      // Unsupported channels are reported, never in the denominator.
      expect(view.coverage.unsupportedConversations).toBe(7);
    });

    /**
     * §16's arithmetic guard: were unsupported conversations folded into the
     * denominator, this would be 1/8 rather than 1/1.
     */
    it('excludes unsupported channels from the denominator', async () => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        unsupported: 7,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.coverage.observedCoverage).toBe(1);
    });

    /** A ratio over nothing is undefined, not 0%. */
    it('returns a null coverage when nothing was eligible', async () => {
      const { service } = harness({ eligible: 0 });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.coverage.observedCoverage).toBeNull();
      expect(view.coverage.eligibleConversations).toBe(0);
    });

    it('returns an empty summary rather than failing on zero observations', async () => {
      const { service } = harness({ eligible: 12 });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.groups).toEqual([]);
      expect(view.coverage.matchedConversations).toBe(0);
      expect(view.coverage.observedCoverage).toBe(0);
      expect(view.cohort.latestAttributionAt).toBeNull();
      expect(view.cohort.cohortAgeHours).toBeNull();
      expect(view.dataQuality.immatureCohort).toBe(false);
    });
  });

  describe('maturity', () => {
    it('flags a cohort whose newest attribution is recent', async () => {
      const { service } = harness({
        conversations: [
          conversation({
            enteredAt: new Date(Date.now() - 3_600_000).toISOString(),
          }),
        ],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.dataQuality.immatureCohort).toBe(true);
      expect(view.cohort.cohortAgeHours).toBeCloseTo(1, 0);
      expect(view.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_SUMMARY_IMMATURE_LIMITATION,
      );
    });

    it('does not flag an old cohort', async () => {
      const { service } = harness({
        conversations: [
          conversation({ enteredAt: '2026-01-01T00:00:00.000Z' }),
        ],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.dataQuality.immatureCohort).toBe(false);
      expect(view.dataQuality.limitations).not.toContain(
        OBSERVED_ATTRIBUTION_SUMMARY_IMMATURE_LIMITATION,
      );
    });

    it('reports dataAsOf and the latest attribution', async () => {
      const { service } = harness({
        conversations: [
          conversation({ conversationId: 'c1', enteredAt: OLD }),
          conversation({
            conversationId: 'c2',
            enteredAt: '2026-09-20T10:00:00.000Z',
          }),
        ],
        eligible: 2,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      // The adapter returns the cohort ordered by entry, so the last is newest.
      expect(view.cohort.latestAttributionAt).toBe('2026-09-20T10:00:00.000Z');
      expect(Date.parse(view.cohort.dataAsOf)).toBeGreaterThan(0);
    });
  });

  describe('window', () => {
    /**
     * The upper bound is exclusive and lands on the day *after* `until`, which
     * is the only formulation that includes the last day in full. A `<=` against
     * `until 00:00` would drop 23h59 of it and look like a quiet decline.
     */
    it('widens the window in the account timezone', async () => {
      const { service, cohort } = harness({
        eligible: 0,
        timezone: 'America/Sao_Paulo',
      });

      await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(cohort.cohortConversations).toHaveBeenCalledWith(
        expect.anything(),
        {
          fromInstant: '2026-09-01T03:00:00.000Z',
          untilInstant: '2026-10-01T03:00:00.000Z',
        },
      );
    });

    it('falls back to UTC when the connection has no timezone', async () => {
      const { service, cohort } = harness({ eligible: 0, timezone: null });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.cohort.timezone).toBe('UTC');
      expect(view.cohort.timezoneSource).toBe('utc_fallback');
      expect(cohort.cohortConversations).toHaveBeenCalledWith(
        expect.anything(),
        {
          fromInstant: '2026-09-01T00:00:00.000Z',
          untilInstant: '2026-10-01T00:00:00.000Z',
        },
      );
    });

    /**
     * A DST boundary inside the window, in the zone this deployment actually
     * runs in. A fixed-offset implementation shifts these by an hour, which
     * moves every conversation that arrived near midnight into the wrong day.
     */
    it('resolves the boundary across a DST transition', async () => {
      const { service, cohort } = harness({
        eligible: 0,
        timezone: 'America/New_York',
      });

      await service.summary(
        SCOPE,
        { since: '2026-03-08', until: '2026-11-01' },
        CONNECTION,
        'ad',
      );

      expect(cohort.cohortConversations).toHaveBeenCalledWith(
        expect.anything(),
        {
          // 2026-03-08 is a spring-forward day; the day still begins at 05:00Z.
          fromInstant: '2026-03-08T05:00:00.000Z',
          // 2026-11-02 is after the autumn transition, so the offset is -05:00.
          untilInstant: '2026-11-02T05:00:00.000Z',
        },
      );
    });

    it('reports the timezone it used', async () => {
      const { service } = harness({
        eligible: 0,
        timezone: 'America/Sao_Paulo',
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.cohort.timezone).toBe('America/Sao_Paulo');
      expect(view.cohort.timezoneSource).toBe('ad_account');
      expect(view.cohort.from).toBe('2026-09-01');
      expect(view.cohort.until).toBe('2026-09-30');
    });
  });

  describe('contract', () => {
    it('states entry-cohort semantics and individual-only attribution', async () => {
      const { service } = harness({ eligible: 0 });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.cohort.semantics).toBe('entry_cohort');
      expect(view.dataQuality.individualAttributionOnly).toBe(true);
    });

    it('names the supported provider and channel', async () => {
      const { service } = harness({ eligible: 0 });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.dataQuality.supportedProviderCoverage).toEqual({
        channelType: 'whatsapp',
        provider: 'meta',
      });
    });

    it('separates every provenance layer', async () => {
      const { service } = harness({ eligible: 0 });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.provenance.observation).toBe(
        'inbox_attribution_observations',
      );
      expect(view.provenance.conversation).toBe('inbox_conversations');
      expect(view.provenance.paidMedia).toBe('social_ad_entities');
      expect(view.provenance.qualification).toBe('inbox_conversation_events');
      expect(view.provenance.opportunity).toBe('crm_opportunities');
      expect(view.provenance.projector).toContain(
        'observed attribution summary',
      );
    });

    /** §21 and §15 are disclosed on every response, not only when relevant. */
    it('always discloses the absence of spend and of destination grouping', async () => {
      const { service } = harness({ eligible: 0 });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(view.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_SUMMARY_SPEND_LIMITATION,
      );
      expect(view.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION,
      );
    });

    it('never exposes an internal join key', async () => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');
      const rendered = JSON.stringify(view);

      expect(rendered).not.toContain('adsetEntityId');
      expect(rendered).not.toContain('adset-entity-1');
    });
  });

  describe('scope', () => {
    it('passes the client scope to both domains', async () => {
      const { service, cohort, hierarchy } = harness({ eligible: 0 });

      await service.summary(SCOPE, WINDOW, CONNECTION, 'ad');

      expect(cohort.cohortConversations).toHaveBeenCalledWith(
        {
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          contextType: 'client',
          clientId: 'client-1',
        },
        expect.anything(),
      );

      expect(hierarchy.lookupMany).toHaveBeenCalledWith(
        expect.objectContaining({
          tenantId: 'tenant-1',
          workspaceId: 'workspace-1',
          agencyClientId: 'client-1',
          connectionId: CONNECTION,
        }),
      );
    });

    /** A null client is the agency's own context, never "every client". */
    it('resolves an agency context', async () => {
      const { service, cohort } = harness({ eligible: 0 });

      await service.summary(
        { ...SCOPE, agencyClientId: null },
        WINDOW,
        CONNECTION,
        'ad',
      );

      expect(cohort.cohortConversations).toHaveBeenCalledWith(
        expect.objectContaining({ contextType: 'agency', clientId: null }),
        expect.anything(),
      );
    });
  });

  // ------------------------------------------------------------------- I4.3

  describe('destination grouping', () => {
    const LATER = '2026-09-05T10:00:00.000Z';

    /**
     * The canonical vocabulary, exercised end to end.
     *
     * Every one of these is a bucket a real account can produce — `on_post`,
     * `profile`, `messaging_multi` and `unknown` all appear in production today
     * — and each is asserted rather than sampled, because the mapping is the
     * layer most likely to silently lose a value when Meta adds one.
     */
    it.each([
      'whatsapp',
      'instagram_direct',
      'messenger',
      'messaging_multi',
      'website',
      'lead_form',
      'app',
      'phone',
      'profile',
      'on_post',
      'unknown',
    ])('groups a conversation whose ad set pointed at %s', async (value) => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([reading('adset-entity-1', OLD, value)]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.groups).toHaveLength(1);
      expect(view.groups[0].key).toBe(value);
      expect(view.groups[0].level).toBe('destination');
      expect(view.groups[0].attributedConversations).toBe(1);
      expect(view.destinationCoverage.destinationResolvedConversations).toBe(1);
    });

    /**
     * §6, and the single most important behaviour in this slice.
     *
     * The ad never changed — the attribution is perfectly consistent. What
     * changed is where the ad set pointed between two of this conversation's own
     * clicks, so there are two true answers and no single destination. The
     * conversation stays matched, stays in coverage, and enters *neither*
     * bucket.
     */
    it('places a temporally-varying conversation in no destination group', async () => {
      const { service } = harness({
        conversations: [
          conversation({
            observationsCount: 2,
            attributionInstants: [OLD, LATER],
          }),
        ],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([
          reading('adset-entity-1', OLD, 'whatsapp'),
          reading('adset-entity-1', LATER, 'instagram_direct'),
        ]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.groups).toHaveLength(0);
      expect(view.groups.map((group) => group.key)).not.toContain('whatsapp');
      expect(view.groups.map((group) => group.key)).not.toContain(
        'instagram_direct',
      );

      // Still attributed, still counted — only unplaceable.
      expect(view.coverage.matchedConversations).toBe(1);
      expect(
        view.destinationCoverage.destinationTemporalVariationConversations,
      ).toBe(1);
      expect(view.destinationCoverage.destinationResolvedConversations).toBe(0);
      expect(view.dataQuality.destinationTemporalVariation).toBe(1);
    });

    /** §12: several observations, one destination — one conversation, N observations. */
    it('counts a multi-observation conversation once', async () => {
      const { service } = harness({
        conversations: [
          conversation({
            observationsCount: 3,
            attributionInstants: [OLD, LATER],
          }),
        ],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([
          reading('adset-entity-1', OLD, 'whatsapp'),
          reading('adset-entity-1', LATER, 'whatsapp'),
        ]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.groups[0].attributedConversations).toBe(1);
      expect(view.groups[0].observationsCount).toBe(3);
    });

    /**
     * §7: the two causes of "no destination" are different facts.
     *
     * `unknown` means Meta was asked and answered UNDEFINED — a real property of
     * the ad set, and a bucket. `unavailable` means nobody had looked yet — an
     * absence in Lyra's own observation history, and no bucket at all. Merging
     * them would make a fixable gap indistinguishable from a stated fact.
     */
    it('separates an unavailable history from a provider unknown', async () => {
      const { service } = harness({
        conversations: [
          conversation({ conversationId: 'c-known' }),
          conversation({
            conversationId: 'c-unseen',
            distinctAdIds: ['ad-2'],
          }),
        ],
        eligible: 2,
        paths: new Map([
          ['ad-1', path()],
          ['ad-2', path({ adId: 'ad-2', adsetEntityId: 'adset-entity-2' })],
        ]),
        // Only the first ad set has any observation history.
        destinations: new Map([reading('adset-entity-1', OLD, 'unknown')]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      // The stated unknown is a group; the unobserved one is not.
      expect(view.groups).toHaveLength(1);
      expect(view.groups[0].key).toBe('unknown');
      expect(view.groups[0].attributedConversations).toBe(1);

      expect(view.destinationCoverage.destinationUnavailableConversations).toBe(
        1,
      );
      expect(view.destinationCoverage.destinationResolvedConversations).toBe(1);
    });

    /**
     * §9: a non-messaging destination is preserved, not discarded.
     *
     * Unlike I3.5, this view does not need a LeadFlow equivalent per
     * destination — the conversation already exists and is already attributed.
     * A website destination on an attributed conversation is a possible fact and
     * is reported with a limitation rather than treated as an error.
     */
    it('keeps a non-messaging destination and flags it', async () => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([reading('adset-entity-1', OLD, 'website')]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.groups[0].key).toBe('website');
      expect(view.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_UNUSUAL_LIMITATION,
      );
    });

    /**
     * §10/§36: `messaging_multi` is never resolved to the arrival channel.
     *
     * The conversation is on WhatsApp. The ad set offered a choice of apps. It
     * stays `messaging_multi`, because reading the inbound channel back onto the
     * ad set would answer the exact question the destination comparison exists
     * to ask.
     */
    it('never rewrites messaging_multi to the inbound channel', async () => {
      const { service } = harness({
        conversations: [conversation({ channelType: 'whatsapp' })],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([
          reading('adset-entity-1', OLD, 'messaging_multi'),
        ]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.groups).toHaveLength(1);
      expect(view.groups[0].key).toBe('messaging_multi');
      expect(view.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_SUMMARY_MESSAGING_MULTI_LIMITATION,
      );
    });

    /** An ad whose ad set never synced has nothing to carry destination evidence. */
    it('reports an unresolved ad set separately', async () => {
      const { service } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path({ adsetEntityId: null })]]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.groups).toHaveLength(0);
      expect(
        view.destinationCoverage.destinationAdsetUnresolvedConversations,
      ).toBe(1);
      expect(view.destinationCoverage.destinationUnavailableConversations).toBe(
        0,
      );
    });

    /**
     * §5 case C, at the boundary that matters: a conflicting attribution never
     * reaches destination resolution at all.
     */
    it('excludes a conflicting attribution before destinations are asked', async () => {
      const { service, destinations } = harness({
        conversations: [conversation({ distinctAdIds: ['ad-1', 'ad-2'] })],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.groups).toHaveLength(0);
      expect(view.coverage.conflictingConversations).toBe(1);
      expect(destinations.destinationAtMany).toHaveBeenCalledWith(
        expect.objectContaining({ pairs: [] }),
      );
    });

    /**
     * §30: one batched read for the whole cohort, never one per conversation.
     */
    it('resolves every conversation in a single batched read', async () => {
      const conversations = Array.from({ length: 25 }, (_, index) =>
        conversation({
          conversationId: `conversation-${index}`,
          attributionInstants: [OLD, LATER],
        }),
      );

      const { service, destinations } = harness({
        conversations,
        eligible: 25,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([
          reading('adset-entity-1', OLD, 'whatsapp'),
          reading('adset-entity-1', LATER, 'whatsapp'),
        ]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(destinations.destinationAtMany).toHaveBeenCalledTimes(1);
      expect(view.groups[0].attributedConversations).toBe(25);
    });

    /**
     * §17: two different measurements, and the destination one must not move
     * the attribution one.
     */
    it('leaves attribution coverage untouched', async () => {
      const { service } = harness({
        conversations: [
          conversation({ conversationId: 'c-1' }),
          conversation({
            conversationId: 'c-2',
            attributionInstants: [OLD, LATER],
          }),
        ],
        eligible: 4,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([
          reading('adset-entity-1', OLD, 'whatsapp'),
          reading('adset-entity-1', LATER, 'website'),
        ]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      // Attribution: both matched, 2 of 4 eligible.
      expect(view.coverage.matchedConversations).toBe(2);
      expect(view.coverage.observedCoverage).toBe(0.5);

      // Destination: only one of the two could be placed.
      expect(view.destinationCoverage.matchedConversations).toBe(2);
      expect(view.destinationCoverage.destinationResolvedConversations).toBe(1);
      expect(view.destinationCoverage.destinationCoverage).toBe(0.5);
    });

    /** A ratio over nothing is undefined, never 0% (the §29 empty-production shape). */
    it('reports a null destination coverage on an empty cohort', async () => {
      const { service } = harness({ eligible: 0 });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.groups).toEqual([]);
      expect(view.destinationCoverage.destinationCoverage).toBeNull();
      expect(view.coverage.observedCoverage).toBeNull();
      expect(view.dataQuality.individualAttributionOnly).toBe(true);
    });

    /**
     * §11: destination groups carry the same outcomes as hierarchy groups,
     * because they run the same accumulator.
     */
    it('carries the full funnel into a destination group', async () => {
      const { service } = harness({
        conversations: [
          conversation({
            conversationId: 'c-1',
            firstQualifiedAt: '2026-10-01T00:00:00.000Z',
          }),
        ],
        opportunities: [
          {
            conversationId: 'c-1',
            opportunityId: 'o-1',
            status: 'won',
            isWon: true,
            wonAt: '2026-10-05T00:00:00.000Z',
            valueAmount: '1500.00',
            currency: 'BRL',
          },
          {
            conversationId: 'c-1',
            opportunityId: 'o-2',
            status: 'open',
            isWon: false,
            wonAt: null,
            valueAmount: '900.00',
            currency: 'BRL',
          },
        ],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([reading('adset-entity-1', OLD, 'whatsapp')]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      const group = view.groups[0];
      expect(group.attributedConversations).toBe(1);
      expect(group.qualifiedConversations).toBe(1);
      expect(group.opportunities).toBe(2);
      expect(group.wonOpportunities).toBe(1);
      expect(group.wonOpportunityValue).toBe('1500.00');
      expect(group.currency).toBe('BRL');
    });

    /** §16: mixed currencies refuse to total, on this axis as on the others. */
    it('refuses to total a destination group across currencies', async () => {
      const { service } = harness({
        conversations: [
          conversation({ conversationId: 'c-1' }),
          conversation({ conversationId: 'c-2' }),
        ],
        opportunities: [
          {
            conversationId: 'c-1',
            opportunityId: 'o-1',
            status: 'won',
            isWon: true,
            wonAt: OLD,
            valueAmount: '100.00',
            currency: 'BRL',
          },
          {
            conversationId: 'c-2',
            opportunityId: 'o-2',
            status: 'won',
            isWon: true,
            wonAt: OLD,
            valueAmount: '100.00',
            currency: 'USD',
          },
        ],
        eligible: 2,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([reading('adset-entity-1', OLD, 'whatsapp')]),
      });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.groups[0].wonOpportunityValue).toBeNull();
      expect(view.groups[0].multiCurrency).toBe(true);
      expect(view.dataQuality.currencyCompatibility).toBe('mixed');
    });

    /**
     * §2/§19 of the delivery list: adding the axis did not change the others.
     *
     * The same cohort grouped by campaign must produce exactly what it produced
     * before destination existed, and must still sum to `matchedConversations`
     * — which the destination axis deliberately does not.
     */
    it('leaves the hierarchy axes unchanged', async () => {
      const input = {
        conversations: [
          conversation({ conversationId: 'c-1' }),
          conversation({
            conversationId: 'c-2',
            attributionInstants: [OLD, LATER],
          }),
        ],
        eligible: 2,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([
          reading('adset-entity-1', OLD, 'whatsapp'),
          reading('adset-entity-1', LATER, 'website'),
        ]),
      };

      const byCampaign = await harness(input).service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'campaign',
      );
      const byDestination = await harness(input).service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      // The hierarchy axis partitions the cohort.
      expect(byCampaign.groups).toHaveLength(1);
      expect(byCampaign.groups[0].key).toBe('campaign-1');
      expect(byCampaign.groups[0].attributedConversations).toBe(2);

      // The destination axis does not, and says so.
      expect(
        byDestination.groups.reduce(
          (total, group) => total + group.attributedConversations,
          0,
        ),
      ).toBe(1);

      // Destination quality is reported on *both*, so a reader on the campaign
      // axis can see the enrichment gap before switching.
      expect(byCampaign.dataQuality.destinationTemporalVariation).toBe(1);
      expect(byCampaign.destinationCoverage.destinationCoverage).toBe(0.5);
    });

    /** §19: destination provenance is its own layer, never folded in. */
    it('states destination provenance separately', async () => {
      const { service } = harness({ eligible: 0 });

      const view = await service.summary(
        SCOPE,
        WINDOW,
        CONNECTION,
        'destination',
      );

      expect(view.provenance.destination).toBe(
        'social_ad_destination_observations',
      );
      expect(view.provenance.paidMedia).not.toBe(view.provenance.destination);
    });

    /**
     * §24: the two temporal semantics are different on purpose, and this test
     * exists to stop a later "standardisation" collapsing them.
     *
     * The cohort window is widened into instants in the *ad account's zone*,
     * because it selects calendar days. Destination is resolved at the
     * observation's *absolute instant*, never truncated to a day — a message at
     * 09:00 and an ad set observed at 21:00 are the same calendar day and the
     * wrong answer.
     */
    it('keeps cohort days zoned and destination instants absolute', async () => {
      const { service, cohort, destinations } = harness({
        conversations: [conversation()],
        eligible: 1,
        paths: new Map([['ad-1', path()]]),
        destinations: new Map([reading('adset-entity-1', OLD, 'whatsapp')]),
        timezone: 'America/Sao_Paulo',
      });

      await service.summary(SCOPE, WINDOW, CONNECTION, 'destination');

      // The window became instants in São Paulo's zone (UTC-3).
      expect(cohort.cohortConversations).toHaveBeenCalledWith(
        expect.anything(),
        {
          fromInstant: '2026-09-01T03:00:00.000Z',
          untilInstant: '2026-10-01T03:00:00.000Z',
        },
      );

      // The destination was asked at the observation's own instant, untouched:
      // no day truncation, no zone conversion, no rounding.
      expect(destinations.destinationAtMany).toHaveBeenCalledWith(
        expect.objectContaining({
          pairs: [{ adEntityId: 'adset-entity-1', instant: OLD }],
        }),
      );
    });
  });
  /**
   * I5 §12 — the dimension rides along and touches nothing.
   *
   * Every test here exists to prove a negative: attribution, grouping and every
   * count are exactly what they were before the mode was in the response.
   */
  /**
   * A cohort with real content, so every "changed nothing" assertion below has
   * numbers to compare rather than two empty responses.
   */
  function modeHarness(): Harness {
    return harness({
      conversations: [
        conversation({ conversationId: 'conversation-1' }),
        conversation({
          conversationId: 'conversation-2',
          distinctAdIds: ['ad-2'],
          attributionInstants: [OLD],
        }),
      ],
      eligible: 3,
      paths: new Map([
        ['ad-1', path()],
        [
          'ad-2',
          path({
            adId: 'ad-2',
            adsetId: 'adset-2',
            adsetEntityId: 'adset-entity-2',
          }),
        ],
      ]),
      destinations: new Map([
        reading('adset-entity-1', OLD, 'whatsapp'),
        reading('adset-entity-2', OLD, 'website'),
      ]),
    });
  }

  describe('business mode dimension (I5)', () => {
    it('reports the context mode at the response level', async () => {
      const { service } = modeHarness();

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      expect(view.businessMode).toEqual({
        key: 'clinics_esthetics',
        label: 'Clínicas e Estética',
        resolution: 'configured',
        source: 'leadflow_client_settings',
        temporalSemantics: 'current_context_dimension',
      });
    });

    /**
     * The structural half of §12, asserted on the payload rather than only in
     * the boundary spec: no group carries a mode of its own.
     */
    it('puts no business mode inside any group', async () => {
      const { service } = modeHarness();

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      expect(view.groups.length).toBeGreaterThan(0);
      for (const group of view.groups) {
        expect(group).not.toHaveProperty('businessMode');
      }
    });

    it('reports an unconfigured context without failing', async () => {
      const { service, businessModes } = modeHarness();
      businessModes.businessMode.mockResolvedValue(UNCONFIGURED_BUSINESS_MODE);

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      // The Social-only shape: null everywhere, and a response that still
      // carries every attribution number it would otherwise have.
      expect(view.businessMode.key).toBeNull();
      expect(view.businessMode.resolution).toBe('unconfigured');
      expect(view.coverage.matchedConversations).toBeGreaterThan(0);
      expect(view.dataQuality.businessMode).toEqual({
        configured: false,
        recognized: false,
        temporalSemantics: 'current_context_dimension',
      });
    });

    it('distinguishes an unrecognised stored key', async () => {
      const { service, businessModes } = modeHarness();
      businessModes.businessMode.mockResolvedValue({
        key: 'retired_custom_mode',
        label: null,
        resolution: 'unknown_key',
        source: 'leadflow_client_settings',
        temporalSemantics: 'current_context_dimension',
      });

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      expect(view.businessMode.key).toBe('retired_custom_mode');
      expect(view.dataQuality.businessMode).toEqual({
        configured: true,
        recognized: false,
        temporalSemantics: 'current_context_dimension',
      });
      expect(view.dataQuality.limitations).toContain(
        BUSINESS_MODE_UNKNOWN_KEY_LIMITATION,
      );
    });

    it('states the current-configuration limitation when a mode is present', async () => {
      const { service } = modeHarness();

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      expect(view.dataQuality.limitations).toContain(
        BUSINESS_MODE_CURRENT_ONLY_LIMITATION,
      );
    });

    it('omits it when there is no mode to misdate', async () => {
      const { service, businessModes } = modeHarness();
      businessModes.businessMode.mockResolvedValue(UNCONFIGURED_BUSINESS_MODE);

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      expect(view.dataQuality.limitations).not.toContain(
        BUSINESS_MODE_CURRENT_ONLY_LIMITATION,
      );
    });

    // §13: one scope for the whole request — the mode is asked about the same
    // context the conversations were selected from.
    it('asks for the mode with the analysis scope', async () => {
      const { service, businessModes } = modeHarness();

      await service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      expect(businessModes.businessMode).toHaveBeenCalledTimes(1);
      expect(businessModes.businessMode).toHaveBeenCalledWith(SCOPE);
    });

    /**
     * §12's core claim, checked on the numbers rather than on a keyword.
     *
     * Every axis, run under a configured mode and under none, must produce
     * identical groups. A mode that ever reached a predicate would show up here
     * however it was spelled.
     */
    it.each(['campaign', 'adset', 'ad', 'account', 'destination'] as const)(
      'changes nothing about %s grouping',
      async (groupBy) => {
        const { service, businessModes } = modeHarness();

        const configured = await service.summary(
          SCOPE,
          WINDOW,
          CONNECTION,
          groupBy,
        );

        businessModes.businessMode.mockResolvedValue(
          UNCONFIGURED_BUSINESS_MODE,
        );
        const unconfigured = await service.summary(
          SCOPE,
          WINDOW,
          CONNECTION,
          groupBy,
        );

        expect(unconfigured.groups).toEqual(configured.groups);
        expect(unconfigured.coverage).toEqual(configured.coverage);
        expect(unconfigured.destinationCoverage).toEqual(
          configured.destinationCoverage,
        );
      },
    );

    // §18: the mode is not an entitlement gate. A context with no LeadFlow
    // configuration still gets every attribution figure the request earned.
    it('still reports individual attribution with no mode configured', async () => {
      const { service, businessModes } = modeHarness();
      businessModes.businessMode.mockResolvedValue(UNCONFIGURED_BUSINESS_MODE);

      const view = await service.summary(SCOPE, WINDOW, CONNECTION, 'campaign');

      expect(view.dataQuality.individualAttributionOnly).toBe(true);
      expect(view.groups.length).toBeGreaterThan(0);
    });
  });
});
