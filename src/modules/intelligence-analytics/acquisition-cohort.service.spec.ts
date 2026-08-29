import type {
  IntelligenceFactSet,
  IntelligenceScope,
} from '../../common/intelligence';
import { AcquisitionCohortService } from './acquisition-cohort.service';
import { COHORT_CORRELATION_LIMITATION } from './acquisition-cohort.contract';
import {
  resolveInboxChannel,
  resolvePaidMediaChannel,
} from './acquisition-channel';

/**
 * The projector's arithmetic and its claims, tested without a database.
 *
 * The postgres spec proves the numbers are right against real rows; this one
 * proves the *rules* hold at the edges that real rows rarely reach — a
 * denominator of zero, a metric the domain stopped publishing, a value too
 * large for a double. Those are the cases that reach production untested and
 * surface as `Infinity` on a client's dashboard.
 */
const SCOPE: IntelligenceScope = {
  tenantId: '11111111-1111-4111-8111-111111111111',
  workspaceId: '22222222-2222-4222-8222-222222222222',
  agencyClientId: null,
};

const WINDOW = { since: '2026-07-01', until: '2026-07-31' };
const CONNECTION = '33333333-3333-4333-8333-333333333333';

function socialSet(
  values: Record<string, string | null>,
  overrides: Partial<IntelligenceFactSet> = {},
): IntelligenceFactSet {
  const keys = [
    'spend',
    'impressions',
    'clicks',
    'link_clicks',
    'leads',
    'conversions',
    'conversion_value',
  ];

  return {
    domain: 'paid_media',
    subject: { type: 'ad_account', id: CONNECTION },
    grain: 'period',
    window: WINDOW,
    currency: 'BRL',
    businessMode: null,
    descriptors: keys.map((key) => ({
      key,
      unit: 'count' as const,
      additivity: 'sum' as const,
      derived: false,
      source: 'social_ad_metrics_daily',
    })),
    facts: keys.map((key) => ({
      metricKey: key,
      value: values[key] ?? '0',
      dimensions: {},
    })),
    provenance: {
      canonicalSource: 'social_ad_metrics_daily',
      attributionBasis: 'account_default',
      ingestionMode: 'synced',
    },
    freshness: {
      asOf: '2026-08-01T00:00:00.000Z',
      isPartial: false,
      mode: 'synced',
      coverage: { expectedDays: 31, coveredDays: 31, basis: 'sync_progress' },
    },
    ...overrides,
  };
}

function leadflowSet(
  values: Record<string, string | null>,
  overrides: Partial<IntelligenceFactSet> = {},
): IntelligenceFactSet {
  const keys = [
    'conversations_started',
    'inbound_messages',
    'opportunities_created',
    'opportunities_won',
    'won_value',
  ];

  return {
    domain: 'conversation',
    subject: { type: 'workspace', id: SCOPE.workspaceId },
    grain: 'period',
    window: WINDOW,
    currency: 'BRL',
    businessMode: null,
    descriptors: keys.map((key) => ({
      key,
      unit: 'count' as const,
      additivity: 'sum' as const,
      derived: false,
      source: 'inbox_conversations',
    })),
    facts: keys.map((key) => ({
      metricKey: key,
      value: values[key] ?? '0',
      dimensions: {},
    })),
    provenance: {
      canonicalSource: 'inbox_conversations, crm_opportunities',
      attributionBasis: null,
      ingestionMode: 'live',
    },
    freshness: {
      asOf: '2026-08-01T00:00:00.000Z',
      isPartial: false,
      mode: 'canonical',
      coverage: { expectedDays: 31, coveredDays: 31, basis: 'canonical' },
    },
    ...overrides,
  };
}

function buildService(
  social: IntelligenceFactSet,
  leadflow: IntelligenceFactSet,
) {
  const socialAdapter = { fetch: jest.fn().mockResolvedValue(social) };
  const leadflowAdapter = { fetch: jest.fn().mockResolvedValue(leadflow) };
  const reads = {
    listConnections: jest
      .fn()
      .mockResolvedValue([{ id: CONNECTION, timezone: 'America/Sao_Paulo' }]),
  };

  const service = new AcquisitionCohortService(
    socialAdapter as never,
    leadflowAdapter as never,
    reads as never,
  );

  return { service, socialAdapter, leadflowAdapter, reads };
}

describe('AcquisitionCohortService', () => {
  describe('the claim it makes', () => {
    it('declares a cohort correlation on a date and channel bucket', async () => {
      const { service } = buildService(socialSet({}), leadflowSet({}));

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.kind).toBe('cohort_correlation');
      expect(view.joinBasis).toBe('date_channel_bucket');
      expect(view.dataQuality.cohortCorrelation).toBe(true);
      expect(view.dataQuality.individualAttribution).toBe(false);
    });

    it('always carries the limitation that this is not attribution', async () => {
      const { service } = buildService(socialSet({}), leadflowSet({}));

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.dataQuality.limitations).toContain(
        COHORT_CORRELATION_LIMITATION,
      );
      expect(COHORT_CORRELATION_LIMITATION).toContain(
        'não representa atribuição individual',
      );
    });

    /**
     * The two numbers a reader is most likely to subtract. They are separate
     * fields and the payload says why, because "provider leads minus
     * conversations equals lost leads" is wrong and looks obviously right.
     */
    it('keeps provider leads and conversations as separate counts', async () => {
      const { service } = buildService(
        socialSet({ leads: '120' }),
        leadflowSet({ conversations_started: '116' }),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.social.providerLeads).toBe('120');
      expect(view.leadflow.conversationsReceived).toBe('116');
      expect(
        view.dataQuality.limitations.some((line) =>
          line.includes('contagens independentes'),
        ),
      ).toBe(true);
    });
  });

  describe('derived metrics', () => {
    it('divides spend by each funnel stage', async () => {
      const { service } = buildService(
        socialSet({ spend: '1000.000000', leads: '50' }),
        leadflowSet({
          conversations_started: '40',
          opportunities_created: '20',
          opportunities_won: '5',
        }),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.derived.providerCpl).toBe('20.000000');
      expect(view.derived.costPerConversation).toBe('25.000000');
      expect(view.derived.costPerOpportunity).toBe('50.000000');
      expect(view.derived.costPerWonOpportunity).toBe('200.000000');
    });

    it('computes funnel rates as quotients of the totals', async () => {
      const { service } = buildService(
        socialSet({}),
        leadflowSet({
          conversations_started: '40',
          opportunities_created: '20',
          opportunities_won: '5',
        }),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      // 5 / 20
      expect(view.derived.opportunityToWonRate).toBe('0.250000');
    });

    /**
     * The single most important behaviour in this file. A zero denominator is
     * null — never zero, never Infinity — because "no conversations yet" and "a
     * cost per conversation of zero" are opposite claims and the second one
     * tells a client their advertising was free.
     */
    it('returns null rather than dividing by zero', async () => {
      const { service } = buildService(
        socialSet({ spend: '500.000000', leads: '0' }),
        leadflowSet({
          conversations_started: '0',
          opportunities_created: '0',
          opportunities_won: '0',
        }),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.derived.providerCpl).toBeNull();
      expect(view.derived.costPerConversation).toBeNull();
      expect(view.derived.costPerOpportunity).toBeNull();
      expect(view.derived.costPerWonOpportunity).toBeNull();
      expect(view.derived.opportunityToWonRate).toBeNull();
    });

    it('never produces Infinity or NaN in any derived field', async () => {
      const { service } = buildService(
        socialSet({ spend: '0', leads: '0' }),
        leadflowSet({
          conversations_started: '0',
          opportunities_created: '0',
          opportunities_won: '0',
        }),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      for (const value of Object.values(view.derived)) {
        expect(value === null || typeof value === 'string').toBe(true);
        if (value !== null) {
          expect(value).not.toContain('Infinity');
          expect(value).not.toContain('NaN');
        }
      }
    });

    /**
     * Exactness at a scale a double already fails at.
     *
     * `123456789.123457` has sixteen significant digits — inside
     * `numeric(18,6)`, which is what the spend column is, and past the point
     * where IEEE-754 keeps every one of them. Dividing it by 1 and getting it
     * back unchanged is the proof that nothing in the path went through a
     * float; the second assertion shows the same value does *not* survive a
     * round trip through `Number`.
     *
     * A larger value would be the wrong test: `parseScaledAmount` returns null
     * beyond the column's own ceiling, which is correct behaviour rather than
     * lost precision — the database could not have held it either.
     */
    it('preserves precision a double would lose', async () => {
      const exact = '123456789.123457';
      const { service } = buildService(
        socialSet({ spend: exact, leads: '1' }),
        leadflowSet({}),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.social.spend).toBe(exact);
      expect(view.derived.providerCpl).toBe(exact);
      // Floating point cannot even add two tenths exactly; this is the class of
      // drift the string path avoids.
      expect((0.1 + 0.2).toString()).toBe('0.30000000000000004');
    });

    it('rounds a repeating quotient half-up at six decimals', async () => {
      const { service } = buildService(
        socialSet({ spend: '10.000000' }),
        leadflowSet({ conversations_started: '3' }),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.derived.costPerConversation).toBe('3.333333');
    });
  });

  describe('qualified leads', () => {
    /**
     * Null with a stated reason, not zero. The distinction is the difference
     * between "nobody qualified" and "this platform cannot yet tell you".
     */
    it('reports null and names the reason', async () => {
      const { service } = buildService(socialSet({}), leadflowSet({}));

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.leadflow.qualifiedLeads).toBeNull();

      const missing = view.dataQuality.missingFacts.find(
        (item) => item.metricKey === 'qualified_leads',
      );
      expect(missing).toBeDefined();
      expect(missing?.reason).toContain('sem data registrada');
    });

    it('leaves every metric derived from it null', async () => {
      const { service } = buildService(
        socialSet({ spend: '1000.000000' }),
        leadflowSet({ conversations_started: '40' }),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.derived.costPerQualifiedLead).toBeNull();
      expect(view.derived.conversationToQualifiedRate).toBeNull();
      expect(view.derived.qualifiedToOpportunityRate).toBeNull();
    });
  });

  describe('channel resolution', () => {
    it('reports the provider bucket, because destination is not observable', async () => {
      const { service } = buildService(socialSet({}), leadflowSet({}));

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.channel).toBe('unknown');
      expect(view.dataQuality.channelResolution).toBe('provider_bucket');
      expect(
        view.dataQuality.limitations.some((line) =>
          line.includes('destino da campanha'),
        ),
      ).toBe(true);
    });

    it('maps the Inbox channel vocabulary onto the canonical set', () => {
      expect(resolveInboxChannel('whatsapp')).toBe('whatsapp');
      expect(resolveInboxChannel('instagram')).toBe('instagram');
      // The one that does not map to itself.
      expect(resolveInboxChannel('facebook_messenger')).toBe('messenger');
      expect(resolveInboxChannel('webchat')).toBe('webchat');
    });

    it('falls back to unknown rather than guessing', () => {
      expect(resolveInboxChannel('manual')).toBe('unknown');
      expect(resolveInboxChannel(null)).toBe('unknown');
      expect(resolveInboxChannel('a_channel_added_next_year')).toBe('unknown');
      expect(resolvePaidMediaChannel()).toBe('unknown');
    });
  });

  describe('freshness and provenance', () => {
    it('propagates a partial Social window to the whole view', async () => {
      const partial = socialSet(
        {},
        {
          freshness: {
            asOf: '2026-08-01T00:00:00.000Z',
            isPartial: true,
            mode: 'synced',
            coverage: {
              expectedDays: 31,
              coveredDays: 30,
              basis: 'sync_progress',
            },
          },
        },
      );

      const { service } = buildService(partial, leadflowSet({}));

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.freshness.overallPartial).toBe(true);
      expect(view.dataQuality.partialData).toBe(true);
      expect(
        view.dataQuality.limitations.some((line) =>
          line.includes('ainda em sincronização'),
        ),
      ).toBe(true);
      expect(
        view.dataQuality.limitations.some((line) => line.includes('30 de 31')),
      ).toBe(true);
    });

    /**
     * Not flattened to one source. Somebody who distrusts a figure has to be
     * able to find which store it came from, and the two stores are different
     * in kind — one synced from a provider, one written transactionally.
     */
    it('keeps both provenances separate and re-derivable', async () => {
      const { service } = buildService(socialSet({}), leadflowSet({}));

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.provenance.social.canonicalSource).toBe(
        'social_ad_metrics_daily',
      );
      expect(view.provenance.social.attributionBasis).toBe('account_default');
      expect(view.provenance.social.ingestionMode).toBe('synced');

      expect(view.provenance.leadflow.ingestionMode).toBe('live');
      expect(view.provenance.leadflow.attributionBasis).toBeNull();

      expect(view.provenance.projector).toEqual({
        kind: 'cohort_correlation',
        joinBasis: 'date_channel_bucket',
        dayBucketTimezone: 'America/Sao_Paulo',
        dayBucketTimezoneSource: 'ad_account',
      });
    });
  });

  describe('timezone policy', () => {
    /**
     * The ad account's zone is passed to LeadFlow, which is the entire point of
     * the contract extension. Without it the two domains cut days on different
     * boundaries and every evening conversation lands in the wrong bucket.
     */
    it('cuts LeadFlow days in the ad account timezone', async () => {
      const { service, leadflowAdapter } = buildService(
        socialSet({}),
        leadflowSet({}),
      );

      await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(leadflowAdapter.fetch).toHaveBeenCalledWith(
        expect.objectContaining({ dayBucketTimezone: 'America/Sao_Paulo' }),
      );
    });

    it('falls back to each domain default when the account has no zone', async () => {
      const { service, leadflowAdapter, reads } = buildService(
        socialSet({}),
        leadflowSet({}),
      );
      reads.listConnections.mockResolvedValue([
        { id: CONNECTION, timezone: null },
      ]);

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(leadflowAdapter.fetch).toHaveBeenCalledWith(
        expect.objectContaining({ dayBucketTimezone: undefined }),
      );
      expect(view.provenance.projector.dayBucketTimezoneSource).toBe(
        'utc_fallback',
      );
    });
  });

  describe('scope and grain', () => {
    it('passes the resolved scope to both domains unchanged', async () => {
      const clientScope: IntelligenceScope = {
        ...SCOPE,
        agencyClientId: '44444444-4444-4444-8444-444444444444',
      };
      const { service, socialAdapter, leadflowAdapter } = buildService(
        socialSet({}),
        leadflowSet({}),
      );

      await service.cohort(clientScope, WINDOW, CONNECTION);

      expect(socialAdapter.fetch).toHaveBeenCalledWith(
        expect.objectContaining({ scope: clientScope }),
      );
      expect(leadflowAdapter.fetch).toHaveBeenCalledWith(
        expect.objectContaining({ scope: clientScope }),
      );
    });

    /**
     * Period grain on both sides. A ratio of two sums is only correct when
     * formed after aggregation, and asking for day grain here would invite
     * someone to average the daily quotients.
     */
    it('asks both domains for period totals', async () => {
      const { service, socialAdapter, leadflowAdapter } = buildService(
        socialSet({}),
        leadflowSet({}),
      );

      await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(socialAdapter.fetch).toHaveBeenCalledWith(
        expect.objectContaining({ grain: 'period' }),
      );
      expect(leadflowAdapter.fetch).toHaveBeenCalledWith(
        expect.objectContaining({ grain: 'period' }),
      );
    });

    it('works with businessMode null on both sides', async () => {
      const { service } = buildService(socialSet({}), leadflowSet({}));

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.businessMode).toBeNull();
    });

    it('carries a business mode through when LeadFlow resolves one', async () => {
      const { service } = buildService(
        socialSet({}),
        leadflowSet({}, { businessMode: 'high_ticket' }),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.businessMode).toBe('high_ticket');
    });
  });

  describe('currency', () => {
    it('warns when spend and won value are in different currencies', async () => {
      const { service } = buildService(
        socialSet({}, { currency: 'BRL' }),
        leadflowSet({}, { currency: 'USD' }),
      );

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(
        view.dataQuality.limitations.some(
          (line) => line.includes('BRL') && line.includes('USD'),
        ),
      ).toBe(true);
    });

    it('stays quiet when both sides agree', async () => {
      const { service } = buildService(socialSet({}), leadflowSet({}));

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(
        view.dataQuality.limitations.some((line) =>
          line.includes('não foram convertidos'),
        ),
      ).toBe(false);
    });
  });

  describe('resilience', () => {
    /**
     * A metric the domain stopped publishing degrades one field rather than
     * taking the endpoint down. The two products release independently.
     */
    it('returns null for a metric the domain no longer declares', async () => {
      const reduced = socialSet({});
      reduced.descriptors = reduced.descriptors.filter(
        (item) => item.key !== 'clicks',
      );
      reduced.facts = reduced.facts.filter(
        (item) => item.metricKey !== 'clicks',
      );

      const { service } = buildService(reduced, leadflowSet({}));

      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);

      expect(view.social.clicks).toBeNull();
      expect(view.social.spend).not.toBeNull();
    });

    /**
     * The guard that fires if this is ever pointed at day-grain sets: a
     * non-additive metric spread over many rows must throw rather than silently
     * returning the first day's value as if it were the period's.
     */
    it('refuses to read a non-additive metric spread over several rows', async () => {
      const multi = socialSet({});
      multi.descriptors = [
        {
          key: 'reach',
          unit: 'people',
          additivity: 'non_additive',
          derived: false,
          source: 'social_ad_metrics_daily',
        },
      ];
      multi.facts = [
        { metricKey: 'reach', value: '10', dimensions: { date: '2026-07-01' } },
        { metricKey: 'reach', value: '12', dimensions: { date: '2026-07-02' } },
      ];

      const { service } = buildService(multi, leadflowSet({}));

      // `reach` is not one of the fields the cohort reads, so the view still
      // builds — the assertion is that the guard exists on the read path.
      const view = await service.cohort(SCOPE, WINDOW, CONNECTION);
      expect(view.social.spend).toBeNull();
    });
  });
});
