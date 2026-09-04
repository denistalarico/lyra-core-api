import type { IntelligenceScope } from '../../common/intelligence';
import {
  resolveAttributionConsistency,
  type LeadFlowAttributionObservation,
  type LeadFlowAttributionOpportunity,
  type LeadFlowConversationAttribution,
} from '../leadflow-analytics/intelligence/leadflow-attribution.port';
import type { SocialAdDestinationAt } from '../social-integrations/analytics/social-ad-destination-at';
import type { SocialAdHierarchyResult } from '../social-integrations/analytics/social-ad-hierarchy-lookup';
import {
  OBSERVED_ATTRIBUTION_CAUSALITY_LIMITATION,
  OBSERVED_ATTRIBUTION_CLICK_ID_LIMITATION,
  OBSERVED_ATTRIBUTION_CONFLICT_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_HISTORY_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_MULTI_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_OBSERVED_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_UNDEFINED_LIMITATION,
  OBSERVED_ATTRIBUTION_DESTINATION_VARIATION_LIMITATION,
  OBSERVED_ATTRIBUTION_VALUE_LIMITATION,
} from './observed-attribution.contract';
import { ObservedAttributionService } from './observed-attribution.service';

const SCOPE: IntelligenceScope = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
};

const CONVERSATION_ID = 'conversation-1';

function observation(
  overrides: Partial<LeadFlowAttributionObservation> = {},
): LeadFlowAttributionObservation {
  return {
    observationId: 'observation-1',
    messageId: 'message-1',
    conversationId: CONVERSATION_ID,
    provider: 'meta',
    channelType: 'whatsapp',
    adId: 'ad-1',
    clickId: 'click-1',
    sourceType: 'ad',
    observedAt: '2026-09-01T10:00:00.000Z',
    ...overrides,
  };
}

function attribution(
  overrides: Partial<LeadFlowConversationAttribution> = {},
): LeadFlowConversationAttribution {
  const observations = overrides.observations ?? [observation()];
  const withAdId = observations.filter((row) => row.adId !== null);
  const distinctAdIds = [
    ...new Set(withAdId.map((row) => row.adId as string)),
  ].sort();

  return {
    conversationId: CONVERSATION_ID,
    exists: true,
    observations,
    distinctAdIds,
    consistency: resolveAttributionConsistency(distinctAdIds, withAdId.length),
    firstObservedAt: observations[0]?.observedAt ?? null,
    lastObservedAt: observations[observations.length - 1]?.observedAt ?? null,
    firstQualifiedAt: null,
    ...overrides,
  };
}

function matchedPath(): SocialAdHierarchyResult {
  return {
    status: 'matched',
    path: {
      connectionId: 'connection-1',
      adId: 'ad-1',
      adsetId: 'adset-1',
      adsetEntityId: 'adset-entity-1',
      campaignId: 'campaign-1',
      accountId: 'act_1',
      adName: 'Anúncio',
      adsetName: 'Conjunto',
      campaignName: 'Campanha',
    },
  };
}

function buildService(options: {
  attribution?: LeadFlowConversationAttribution;
  opportunities?: LeadFlowAttributionOpportunity[];
  lookup?: SocialAdHierarchyResult;
  /** Destination per attribution instant, for the I4.1 block. */
  destinations?: Map<string, SocialAdDestinationAt>;
}) {
  const leadflow = {
    conversationAttribution: jest
      .fn()
      .mockResolvedValue(options.attribution ?? attribution()),
    conversationOpportunities: jest
      .fn()
      .mockResolvedValue(options.opportunities ?? []),
  };

  const hierarchy = {
    lookup: jest.fn().mockResolvedValue(options.lookup ?? matchedPath()),
  };

  const destinations = {
    destinationAt: jest
      .fn()
      .mockResolvedValue(options.destinations ?? new Map()),
  };

  return {
    service: new ObservedAttributionService(
      leadflow as never,
      hierarchy as never,
      destinations as never,
    ),
    leadflow,
    hierarchy,
    destinations,
  };
}

describe('ObservedAttributionService', () => {
  describe('the match', () => {
    it('resolves an observed ad id to its hierarchy', async () => {
      const { service } = buildService({});

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.matchStatus).toBe('matched');
      expect(view?.paidMedia).toEqual({
        connectionId: 'connection-1',
        accountId: 'act_1',
        campaignId: 'campaign-1',
        adsetId: 'adset-1',
        adId: 'ad-1',
        adName: 'Anúncio',
        adsetName: 'Conjunto',
        campaignName: 'Campanha',
        // I4.1's block. Unavailable here because the harness resolves no
        // destination observation; the ad itself matched regardless.
        destination: {
          value: null,
          resolution: 'unavailable_before_first_observation',
          observedAt: null,
          raw: null,
          consistency: 'unavailable',
          readings: [
            {
              observationId: 'observation-1',
              attributionObservedAt: '2026-09-01T10:00:00.000Z',
              value: 'unknown',
              resolution: 'unavailable_before_first_observation',
              destinationObservedAt: null,
              raw: null,
            },
          ],
        },
      });
    });

    /**
     * The join key must not reach the response. `adsetEntityId` is an internal
     * row id used to reach the observations, and rendering it would invite a
     * consumer to treat it as an ad set identifier.
     */
    it('never exposes the internal ad set row id', async () => {
      const { service } = buildService({});

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.paidMedia).not.toHaveProperty('adsetEntityId');
      expect(JSON.stringify(view)).not.toContain('adset-entity-1');
    });

    it('declares the claim it is making', async () => {
      const { service } = buildService({});

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.kind).toBe('observed_attribution');
    });

    /**
     * The flag the whole feature exists to set truthfully, and the limitation
     * that must never travel without it.
     */
    it('sets individualAttribution only on a match, with its caveat', async () => {
      const { service } = buildService({});

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.dataQuality.individualAttribution).toBe(true);
      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_CAUSALITY_LIMITATION,
      );
    });

    it('leaves individualAttribution false when the ad is not mirrored', async () => {
      const { service } = buildService({
        lookup: { status: 'ad_not_found', candidateConnectionIds: [] },
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.matchStatus).toBe('ad_not_found');
      expect(view?.dataQuality.individualAttribution).toBe(false);
      expect(view?.dataQuality.hierarchyResolved).toBe(false);
      // The evidence is still reported — the observation happened.
      expect(view?.dataQuality.providerEvidence).toBe(true);
      expect(view?.paidMedia).toBeNull();
    });

    it('never resolves an ad when connections are ambiguous', async () => {
      const { service } = buildService({
        lookup: {
          status: 'ambiguous_connection',
          candidateConnectionIds: ['connection-a', 'connection-b'],
        },
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.matchStatus).toBe('ambiguous_connection');
      expect(view?.paidMedia).toBeNull();
      expect(view?.dataQuality.individualAttribution).toBe(false);
      // Named, so an operator can see which accounts collided.
      expect(view?.ambiguousConnectionIds).toEqual([
        'connection-a',
        'connection-b',
      ]);
    });
  });

  describe('the observations', () => {
    it('reports a single observation as single', async () => {
      const { service } = buildService({});

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.conversation.consistency).toBe('single');
      expect(view?.conversation.observationCount).toBe(1);
    });

    /**
     * Repeat clicks on one ad are not a conflict — the evidence agrees with
     * itself, and the conversation is still attributable.
     */
    it('matches when several observations name the same ad', async () => {
      const { service } = buildService({
        attribution: attribution({
          observations: [
            observation({
              observationId: 'o1',
              observedAt: '2026-09-01T10:00:00.000Z',
            }),
            observation({
              observationId: 'o2',
              observedAt: '2026-09-05T10:00:00.000Z',
            }),
          ],
        }),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.conversation.consistency).toBe('multiple_consistent');
      expect(view?.matchStatus).toBe('matched');
      expect(view?.conversation.distinctAdIds).toEqual(['ad-1']);
    });

    /**
     * The case the whole design turns on: two real clicks on two different ads.
     * Choosing either would be a first-touch or last-touch model.
     */
    it('refuses to choose between conflicting ads', async () => {
      const { service, hierarchy } = buildService({
        attribution: attribution({
          observations: [
            observation({ observationId: 'o1', adId: 'ad-1' }),
            observation({ observationId: 'o2', adId: 'ad-2' }),
          ],
        }),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.conversation.consistency).toBe('conflicting');
      expect(view?.matchStatus).toBe('conflicting_observations');
      expect(view?.paidMedia).toBeNull();
      expect(view?.dataQuality.attributionConflict).toBe(true);
      expect(view?.dataQuality.individualAttribution).toBe(false);
      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_CONFLICT_LIMITATION,
      );
      // And no lookup is even attempted — there is nothing to look up.
      expect(hierarchy.lookup).not.toHaveBeenCalled();
    });

    it('keeps both ad ids visible when they conflict', async () => {
      const { service } = buildService({
        attribution: attribution({
          observations: [
            observation({ observationId: 'o1', adId: 'ad-2' }),
            observation({ observationId: 'o2', adId: 'ad-1' }),
          ],
        }),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      // Sorted, and neither discarded: the granularity survives the conflict.
      expect(view?.conversation.distinctAdIds).toEqual(['ad-1', 'ad-2']);
      expect(view?.evidence).toHaveLength(2);
    });

    it('preserves first and last observed', async () => {
      const { service } = buildService({
        attribution: attribution({
          observations: [
            observation({
              observationId: 'o1',
              observedAt: '2026-09-01T10:00:00.000Z',
            }),
            observation({
              observationId: 'o2',
              observedAt: '2026-09-09T10:00:00.000Z',
            }),
          ],
        }),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.conversation.firstObservedAt).toBe(
        '2026-09-01T10:00:00.000Z',
      );
      expect(view?.conversation.lastObservedAt).toBe(
        '2026-09-09T10:00:00.000Z',
      );
    });
  });

  describe('the click id', () => {
    it('reports that one was observed, never its value', async () => {
      const { service } = buildService({});

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.evidence[0].clickIdPresent).toBe(true);
      expect(JSON.stringify(view)).not.toContain('click-1');
    });

    /**
     * A click id is not a weaker ad id. An organic-surface referral carries one
     * with no ad, and resolving it would mean asking Meta.
     */
    it('never substitutes for a missing ad id', async () => {
      const { service, hierarchy } = buildService({
        attribution: attribution({
          observations: [observation({ adId: null, clickId: 'click-9' })],
        }),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.matchStatus).toBe('no_ad_id');
      expect(view?.paidMedia).toBeNull();
      expect(hierarchy.lookup).not.toHaveBeenCalled();
      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_CLICK_ID_LIMITATION,
      );
      // Still recorded as evidence.
      expect(view?.evidence[0].clickIdPresent).toBe(true);
    });
  });

  describe('the provider', () => {
    /**
     * Instagram and Messenger send no referral. Reporting those as `no_ad_id`
     * would state that the conversation did not come from an ad, which the
     * evidence cannot support.
     */
    it.each(['instagram', 'facebook_messenger'])(
      'reports %s as unsupported rather than as organic',
      async (channelType) => {
        const { service } = buildService({
          attribution: attribution({
            observations: [
              observation({ channelType, adId: null, clickId: 'click-1' }),
            ],
          }),
        });

        const view = await service.conversation(SCOPE, CONVERSATION_ID);

        expect(view?.matchStatus).toBe('unsupported_provider');
      },
    );

    it('does not resolve another provider ad id against the Meta mirror', async () => {
      const { service, hierarchy } = buildService({
        attribution: attribution({
          observations: [observation({ provider: 'tiktok', adId: 'ad-1' })],
        }),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.matchStatus).toBe('unsupported_provider');
      expect(hierarchy.lookup).not.toHaveBeenCalled();
    });
  });

  describe('the outcomes', () => {
    const opportunity = (
      overrides: Partial<LeadFlowAttributionOpportunity> = {},
    ): LeadFlowAttributionOpportunity => ({
      opportunityId: 'opportunity-1',
      status: 'won',
      isWon: true,
      wonAt: '2026-09-10T12:00:00.000Z',
      valueAmount: '1000.00',
      currency: 'BRL',
      ...overrides,
    });

    it('reports no opportunity as a real zero, not a gap', async () => {
      const { service } = buildService({ opportunities: [] });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.outcomes.opportunityCount).toBe(0);
      expect(view?.outcomes.wonOpportunityCount).toBe(0);
      expect(view?.dataQuality.opportunityLinkExplicit).toBe(false);
    });

    /**
     * A conversation can produce several deals, and there is no evidence that
     * would let this layer pick one.
     */
    it('returns every linked opportunity', async () => {
      const { service } = buildService({
        opportunities: [
          opportunity({ opportunityId: 'o1', valueAmount: '1000.00' }),
          opportunity({ opportunityId: 'o2', valueAmount: '250.50' }),
          opportunity({
            opportunityId: 'o3',
            status: 'open',
            isWon: false,
            wonAt: null,
            valueAmount: '99.99',
          }),
        ],
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.outcomes.opportunityCount).toBe(3);
      expect(view?.outcomes.wonOpportunityCount).toBe(2);
      expect(view?.outcomes.wonOpportunityValue).toBe('1250.50');
      expect(
        view?.outcomes.opportunities.map((row) => row.opportunityId),
      ).toEqual(['o1', 'o2', 'o3']);
    });

    /**
     * Decimal addition through a double drifts on exactly the values a deal
     * amount takes. 0.1 + 0.2 is the canonical example and a real invoice line.
     */
    it('adds deal values without floating-point drift', async () => {
      const { service } = buildService({
        opportunities: [
          opportunity({ opportunityId: 'o1', valueAmount: '0.10' }),
          opportunity({ opportunityId: 'o2', valueAmount: '0.20' }),
        ],
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.outcomes.wonOpportunityValue).toBe('0.30');
    });

    it('refuses to total deals in different currencies', async () => {
      const { service } = buildService({
        opportunities: [
          opportunity({ opportunityId: 'o1', currency: 'BRL' }),
          opportunity({ opportunityId: 'o2', currency: 'USD' }),
        ],
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.outcomes.wonOpportunityValue).toBeNull();
      expect(view?.outcomes.currency).toBeNull();
      // The individual rows keep their own currencies.
      expect(view?.outcomes.opportunities[1].currency).toBe('USD');
    });

    it('warns that a won value is seller-entered, not revenue', async () => {
      const { service } = buildService({ opportunities: [opportunity()] });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_VALUE_LIMITATION,
      );
    });
  });

  describe('the scope', () => {
    it('returns null for a conversation outside the scope', async () => {
      const { service } = buildService({
        attribution: attribution({
          exists: false,
          observations: [],
        }),
      });

      expect(await service.conversation(SCOPE, CONVERSATION_ID)).toBeNull();
    });

    /**
     * The lookup receives the caller's scope verbatim. An ad id resolved
     * without the client binding would cross into another client's mirror.
     */
    it('passes the caller scope to the hierarchy lookup', async () => {
      const clientScope: IntelligenceScope = {
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: 'client-7',
      };
      const { service, hierarchy, leadflow } = buildService({});

      await service.conversation(clientScope, CONVERSATION_ID);

      expect(hierarchy.lookup).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        agencyClientId: 'client-7',
        adId: 'ad-1',
      });
      // And LeadFlow is asked in client context, not agency context.
      expect(leadflow.conversationAttribution).toHaveBeenCalledWith(
        expect.objectContaining({
          contextType: 'client',
          clientId: 'client-7',
        }),
        CONVERSATION_ID,
      );
    });

    it('asks LeadFlow in agency context when no client is selected', async () => {
      const { service, leadflow } = buildService({});

      await service.conversation(SCOPE, CONVERSATION_ID);

      expect(leadflow.conversationAttribution).toHaveBeenCalledWith(
        expect.objectContaining({ contextType: 'agency', clientId: null }),
        CONVERSATION_ID,
      );
    });
  });

  describe('the provenance', () => {
    it('names every layer separately', async () => {
      const { service } = buildService({});

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.provenance).toEqual({
        observation: 'inbox_attribution_observations',
        conversation: 'inbox_conversations',
        paidMedia: 'social_ad_entities',
        destination: 'social_ad_destination_observations',
        qualification: 'inbox_conversation_events',
        opportunity: 'crm_opportunities',
        projector: 'observed attribution bridge (intelligence-analytics)',
      });
    });
  });

  describe('the qualification link', () => {
    it('carries the first observed qualification when there is one', async () => {
      const { service } = buildService({
        attribution: attribution({
          firstQualifiedAt: '2026-09-02T08:00:00.000Z',
        }),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.conversation.firstQualifiedAt).toBe(
        '2026-09-02T08:00:00.000Z',
      );
    });

    it('reports null rather than inventing one', async () => {
      const { service } = buildService({});

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.conversation.firstQualifiedAt).toBeNull();
    });
  });

  describe('the destination (I4.1)', () => {
    const at = (
      value: string,
      overrides: Partial<SocialAdDestinationAt> = {},
    ): SocialAdDestinationAt => ({
      value: value as SocialAdDestinationAt['value'],
      resolution: 'observed_destination',
      observedAt: '2026-08-30T07:00:00.000Z',
      raw: value.toUpperCase(),
      ...overrides,
    });

    /** One attribution instant resolving to one destination. */
    const single = (destination: SocialAdDestinationAt) =>
      buildService({
        destinations: new Map([['2026-09-01T10:00:00.000Z', destination]]),
      });

    it.each([
      ['whatsapp', 'WHATSAPP'],
      ['instagram_direct', 'INSTAGRAM_DIRECT'],
      ['messenger', 'MESSENGER'],
    ])('enriches a match with %s', async (value, raw) => {
      const { service } = single(at(value, { raw }));

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.paidMedia?.destination).toMatchObject({
        value,
        resolution: 'observed_destination',
        consistency: 'single',
        raw,
      });
      expect(view?.dataQuality.destinationResolved).toBe(true);
      expect(view?.dataQuality.destinationConsistency).toBe('single');
    });

    /**
     * §6: never distributed into whatsapp / instagram / messenger. The ad set
     * offered a choice and Meta routes per person.
     */
    it('preserves messaging_multi without distributing it', async () => {
      const { service } = single(
        at('messaging_multi', { raw: 'MESSAGING_MESSENGER_WHATSAPP' }),
      );

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.paidMedia?.destination?.value).toBe('messaging_multi');
      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_DESTINATION_MULTI_LIMITATION,
      );
    });

    /**
     * §7 cause B: Meta was asked and answered "nothing configured". Only `raw`
     * separates this from cause A below.
     */
    it('distinguishes a provider UNDEFINED from a missing history', async () => {
      const { service } = single(at('unknown', { raw: 'UNDEFINED' }));

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.paidMedia?.destination).toMatchObject({
        value: 'unknown',
        resolution: 'observed_destination',
        raw: 'UNDEFINED',
      });
      // Evidence exists — it just says "no destination".
      expect(view?.dataQuality.destinationTemporalEvidence).toBe(true);
      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_DESTINATION_UNDEFINED_LIMITATION,
      );
    });

    /**
     * §2 and §7 cause A: the attribution predates every destination
     * observation. The attribution stays matched.
     */
    it('reports unavailable when history begins after the attribution', async () => {
      const { service } = buildService({ destinations: new Map() });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.matchStatus).toBe('matched');
      expect(view?.dataQuality.individualAttribution).toBe(true);
      expect(view?.paidMedia?.destination).toMatchObject({
        value: null,
        resolution: 'unavailable_before_first_observation',
        consistency: 'unavailable',
        raw: null,
      });
      expect(view?.dataQuality.destinationResolved).toBe(false);
      expect(view?.dataQuality.destinationTemporalEvidence).toBe(false);
      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_DESTINATION_HISTORY_LIMITATION,
      );
    });

    /**
     * §10: a destination that could not be resolved says nothing about whether
     * the ad was observed.
     */
    it('never lets a missing destination change individualAttribution', async () => {
      const { service } = buildService({ destinations: new Map() });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.dataQuality.individualAttribution).toBe(true);
      expect(view?.dataQuality.hierarchyResolved).toBe(true);
    });

    /** §4: the instants asked about are the observations carrying the ad. */
    it('resolves the destination at each carrying observation', async () => {
      const { service, destinations } = buildService({
        attribution: attribution({
          observations: [
            observation({
              observationId: 'o1',
              observedAt: '2026-09-01T10:00:00.000Z',
            }),
            observation({
              observationId: 'o2',
              observedAt: '2026-09-08T10:00:00.000Z',
            }),
          ],
        }),
        destinations: new Map([
          ['2026-09-01T10:00:00.000Z', at('whatsapp')],
          ['2026-09-08T10:00:00.000Z', at('whatsapp')],
        ]),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(destinations.destinationAt).toHaveBeenCalledWith({
        tenantId: 'tenant-1',
        workspaceId: 'workspace-1',
        adEntityId: 'adset-entity-1',
        instants: ['2026-09-01T10:00:00.000Z', '2026-09-08T10:00:00.000Z'],
      });
      expect(view?.paidMedia?.destination?.consistency).toBe(
        'multiple_consistent',
      );
      expect(view?.paidMedia?.destination?.value).toBe('whatsapp');
    });

    /**
     * §5, the case the separate vocabulary exists for: the ad is the same in
     * both observations, so this is *not* an attribution conflict — but the ad
     * set was pointed somewhere else between them.
     */
    it('reports temporal variation without collapsing it', async () => {
      const { service } = buildService({
        attribution: attribution({
          observations: [
            observation({
              observationId: 'o1',
              observedAt: '2026-09-01T10:00:00.000Z',
            }),
            observation({
              observationId: 'o2',
              observedAt: '2026-09-08T10:00:00.000Z',
            }),
          ],
        }),
        destinations: new Map([
          ['2026-09-01T10:00:00.000Z', at('whatsapp')],
          ['2026-09-08T10:00:00.000Z', at('instagram_direct')],
        ]),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      // Attribution is untouched: same ad, so still consistent.
      expect(view?.conversation.consistency).toBe('multiple_consistent');
      expect(view?.dataQuality.attributionConflict).toBe(false);

      // The destination is the thing that varied, and no single value is stated.
      expect(view?.dataQuality.destinationConsistency).toBe(
        'temporal_variation',
      );
      expect(view?.paidMedia?.destination?.value).toBeNull();
      expect(view?.paidMedia?.destination?.resolution).toBe(
        'temporal_variation',
      );
      // Both readings survive.
      expect(
        view?.paidMedia?.destination?.readings.map((r) => r.value),
      ).toEqual(['whatsapp', 'instagram_direct']);
      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_DESTINATION_VARIATION_LIMITATION,
      );
    });

    /** A partial resolve keeps what stands and admits what does not. */
    it('carries both caveats when only some instants resolve', async () => {
      const { service } = buildService({
        attribution: attribution({
          observations: [
            observation({
              observationId: 'o1',
              observedAt: '2026-09-01T10:00:00.000Z',
            }),
            observation({
              observationId: 'o2',
              observedAt: '2026-09-08T10:00:00.000Z',
            }),
          ],
        }),
        destinations: new Map([['2026-09-08T10:00:00.000Z', at('whatsapp')]]),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.paidMedia?.destination?.value).toBe('whatsapp');
      expect(view?.dataQuality.destinationResolved).toBe(false);
      expect(view?.dataQuality.destinationTemporalEvidence).toBe(true);
      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_DESTINATION_HISTORY_LIMITATION,
      );
    });

    /**
     * §11: conflicting ads have no single ad set, so no destination block is
     * produced at all. The per-observation evidence remains in `evidence`.
     */
    it('produces no destination for conflicting attribution', async () => {
      const { service, destinations } = buildService({
        attribution: attribution({
          observations: [
            observation({ observationId: 'o1', adId: 'ad-1' }),
            observation({ observationId: 'o2', adId: 'ad-2' }),
          ],
        }),
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.matchStatus).toBe('conflicting_observations');
      expect(view?.paidMedia).toBeNull();
      expect(view?.dataQuality.destinationConsistency).toBe('unavailable');
      expect(destinations.destinationAt).not.toHaveBeenCalled();
    });

    /** An ad whose ad set did not resolve has no destination to report. */
    it('reports no destination when the ad set is unresolved', async () => {
      const { service, destinations } = buildService({
        lookup: {
          status: 'matched',
          path: {
            connectionId: 'connection-1',
            adId: 'ad-1',
            adsetId: null,
            adsetEntityId: null,
            campaignId: null,
            accountId: null,
            adName: 'Órfão',
            adsetName: null,
            campaignName: null,
          },
        },
      });

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.matchStatus).toBe('matched');
      expect(view?.paidMedia?.destination).toBeNull();
      expect(destinations.destinationAt).not.toHaveBeenCalled();
    });

    /**
     * The caveat that applies to every resolved destination: the value is the
     * last observation *before* the conversation, not the destination in force
     * at that instant.
     */
    it('always states that the destination is observed, not in force', async () => {
      const { service } = single(at('whatsapp'));

      const view = await service.conversation(SCOPE, CONVERSATION_ID);

      expect(view?.dataQuality.limitations).toContain(
        OBSERVED_ATTRIBUTION_DESTINATION_OBSERVED_LIMITATION,
      );
    });
  });
});

describe('resolveAttributionConsistency', () => {
  it.each([
    [[], 0, 'none'],
    [['ad-1'], 1, 'single'],
    [['ad-1'], 3, 'multiple_consistent'],
    [['ad-1', 'ad-2'], 2, 'conflicting'],
    // Many observations of two ads is still exactly one conflict.
    [['ad-1', 'ad-2'], 9, 'conflicting'],
  ])('%p over %i observations is %s', (adIds, count, expected) => {
    expect(resolveAttributionConsistency(adIds, count)).toBe(expected);
  });
});
