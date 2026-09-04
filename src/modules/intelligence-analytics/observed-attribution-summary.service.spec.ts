import type { LeadFlowCohortConversation } from '../leadflow-analytics/intelligence/leadflow-attribution-cohort.port';
import type { SocialAdHierarchyPath } from '../social-integrations/analytics/social-ad-hierarchy-lookup';
import {
  OBSERVED_ATTRIBUTION_SUMMARY_CONFLICT_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_CURRENCY_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_DESTINATION_LIMITATION,
  OBSERVED_ATTRIBUTION_SUMMARY_IMMATURE_LIMITATION,
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
};

function harness(input: {
  conversations?: LeadFlowCohortConversation[];
  opportunities?: unknown[];
  eligible?: number;
  unsupported?: number;
  paths?: Map<string, SocialAdHierarchyPath>;
  timezone?: string | null;
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

  return {
    service: new ObservedAttributionSummaryService(
      cohort as never,
      hierarchy as never,
      socialReads as never,
    ),
    cohort,
    hierarchy,
    socialReads,
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
});
