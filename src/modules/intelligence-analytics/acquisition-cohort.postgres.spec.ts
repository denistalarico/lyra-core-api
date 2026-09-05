import { randomUUID } from 'crypto';
import {
  BUSINESS_MODE_CURRENT_ONLY_LIMITATION,
  requireIntelligenceScope,
} from '../../common/intelligence';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { BusinessModeDimensionAdapter } from '../leadflow-analytics/intelligence/business-mode-dimension.adapter';
import { LeadFlowIntelligenceAdapter } from '../leadflow-analytics/intelligence/leadflow-intelligence.adapter';
import { SocialAdAccountConnectionEntity } from '../social-integrations/entities/social-ad-account-connection.entity';
import { SocialAdDestinationObservationEntity } from '../social-integrations/entities/social-ad-destination-observation.entity';
import { SocialAdEntity } from '../social-integrations/entities/social-ad-entity.entity';
import { SocialAdMetricDailyEntity } from '../social-integrations/entities/social-ad-metric-daily.entity';
import { SocialAdSyncRunEntity } from '../social-integrations/entities/social-ad-sync-run.entity';
import { SocialPaidMediaIntelligenceAdapter } from '../social-integrations/intelligence/social-paid-media-intelligence.adapter';
import { SocialAdDestinationBreakdownReadService } from '../social-integrations/services/social-ad-destination-breakdown.read.service';
import { SocialAdDestinationHistoryReadService } from '../social-integrations/services/social-ad-destination-history.read.service';
import { SocialAdSyncConfigService } from '../social-integrations/services/social-ad-sync-config.service';
import { SocialAnalyticsReadService } from '../social-integrations/services/social-analytics-read.service';
import { AcquisitionCohortService } from './acquisition-cohort.service';
import { COHORT_DESTINATION_NOT_A_PARTITION_LIMITATION } from './acquisition-cohort.contract';

const run = describePostgresIntegration();

/**
 * The cohort view over real rows from both domains.
 *
 * The unit spec proves the arithmetic; this proves the composition. The
 * failures it exists to catch are the ones that only appear once two products'
 * tables are in the same database: a scope filter that isolates in one domain
 * and not the other, a day boundary that lands ad spend and conversations on
 * different dates, and campaign-level rows doubling the spend that every cost
 * metric divides by.
 */
run('Acquisition cohort against PostgreSQL', () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();

  const connectionId = randomUUID();
  const clientConnectionId = randomUUID();
  const otherTenantConnectionId = randomUUID();

  let service: AcquisitionCohortService;
  let reads: SocialAnalyticsReadService;

  const WINDOW = { since: '2026-08-01', until: '2026-08-31' };

  const tables = [
    // I5: the dimension's storage, reset with the rest so a mode left by one
    // test cannot decide another test's response.
    'leadflow_client_settings',
    'social_ad_destination_observations',
    'social_ad_metrics_daily',
    'social_ad_entities',
    'social_ad_sync_runs',
    'social_ad_account_connections',
    'inbox_conversation_events',
    'inbox_messages',
    'inbox_conversations',
    'inbox_channels',
    'crm_opportunity_events',
    'crm_opportunities',
    'crm_stages',
    'crm_pipelines',
  ];

  const reset = async () => {
    for (const tenant of [tenantId, otherTenantId]) {
      await deleteFixtureTenant(AgencyDataSource, tenant, tables);
    }
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    await reset();

    reads = new SocialAnalyticsReadService(
      AgencyDataSource.getRepository(SocialAdAccountConnectionEntity),
      AgencyDataSource.getRepository(SocialAdMetricDailyEntity),
      AgencyDataSource.getRepository(SocialAdEntity),
      AgencyDataSource.getRepository(SocialAdSyncRunEntity),
      new SocialAdSyncConfigService(),
    );

    service = new AcquisitionCohortService(
      new SocialPaidMediaIntelligenceAdapter(reads),
      new LeadFlowIntelligenceAdapter(AgencyDataSource),
      reads,
      new SocialAdDestinationHistoryReadService(
        AgencyDataSource.getRepository(SocialAdDestinationObservationEntity),
      ),
      new SocialAdDestinationBreakdownReadService(
        AgencyDataSource.getRepository(SocialAdMetricDailyEntity),
      ),
      // The real dimension adapter (I5), so this suite exercises the same SQL
      // the endpoint runs rather than a fiction of it.
      new BusinessModeDimensionAdapter(AgencyDataSource),
    );
  });

  afterAll(async () => {
    await reset();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  // ---------------------------------------------------------------- fixtures

  const createConnection = async (options: {
    id: string;
    tenant?: string;
    workspace?: string;
    client?: string | null;
    timezone?: string | null;
  }) => {
    await AgencyDataSource.query(
      `INSERT INTO social_ad_account_connections
         (id, tenant_id, workspace_id, agency_client_id, provider,
          external_account_id, timezone, currency, connection_status)
       VALUES ($1, $2, $3, $4, 'meta_ads', $5, $6, 'BRL', 'connected')`,
      [
        options.id,
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        options.client ?? null,
        `act_${options.id.slice(0, 8)}`,
        options.timezone === undefined ? 'America/Sao_Paulo' : options.timezone,
      ],
    );
  };

  const insertSpend = async (options: {
    connection?: string;
    tenant?: string;
    workspace?: string;
    client?: string | null;
    metricDate: string;
    entityLevel?: string;
    /**
     * The object this row is about.
     *
     * Defaulted from the level for every pre-I3.5 caller, which only ever needed
     * one row per level. Ad-set rows must name their own ad set, because the
     * destination join matches on it.
     */
    externalId?: string;
    spend?: string;
    leads?: string;
    clicks?: string;
    impressions?: string;
  }) => {
    await AgencyDataSource.query(
      `INSERT INTO social_ad_metrics_daily
         (tenant_id, workspace_id, agency_client_id, connection_id, provider,
          source, entity_level, entity_external_id, metric_date,
          account_timezone, currency, attribution_setting, spend, impressions,
          reach, clicks, link_clicks, leads, conversions, conversion_value,
          video_views, is_partial, synced_at)
       VALUES ($1, $2, $3, $4, 'meta_ads', 'paid', $5, $6, $7::date,
               'America/Sao_Paulo', 'BRL', 'account_default', $8, $9,
               300, $10, 5, $11, 1.000000, 50.000000, 10, false,
               '2026-08-31T06:00:00Z')`,
      [
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        options.client ?? null,
        options.connection ?? connectionId,
        options.entityLevel ?? 'account',
        options.externalId ?? `ext_${options.entityLevel ?? 'account'}`,
        options.metricDate,
        options.spend ?? '100.000000',
        options.impressions ?? '1000',
        options.clicks ?? '20',
        options.leads ?? '10',
      ],
    );
  };

  const createChannel = async (options: {
    tenant?: string;
    workspace?: string;
    client?: string | null;
    /** `inbox_channels.type`; the destination breakdown needs all three. */
    type?: string;
  }) => {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_channels
         (id, tenant_id, workspace_id, name, type, provider, status,
          connection_status, lifecycle_version, credential_version,
          ai_enabled, settings, metadata)
       VALUES ($1, $2, $3, 'Canal', $5, 'meta', 'active',
               'connected', 1, 1, false, '{}'::jsonb, $4::jsonb)`,
      [
        id,
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        JSON.stringify(options.client ? { clientId: options.client } : {}),
        options.type ?? 'whatsapp',
      ],
    );
    return id;
  };

  const createConversation = async (options: {
    channelId: string | null;
    createdAt: string;
    tenant?: string;
    workspace?: string;
  }) => {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_conversations
         (id, tenant_id, workspace_id, channel_id, status, priority, source,
          business_mode, unread_count, ai_enabled, metadata, created_at,
          updated_at, ownership_state, ownership_version, ownership_changed_at,
          qualification_status)
       VALUES ($1, $2, $3, $4, 'new', 'normal', 'inbound', 'general', 0, false,
               '{}'::jsonb, $5::timestamptz, $5::timestamptz, 'paused', 1,
               $5::timestamptz, 'pending')`,
      [
        id,
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        options.channelId,
        options.createdAt,
      ],
    );
    return id;
  };

  const createPipeline = async (tenant = tenantId, workspace = workspaceId) => {
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO crm_pipelines (id, tenant_id, workspace_id, name, metadata)
       VALUES ($1, $2, $3, 'Pipeline', '{}'::jsonb)`,
      [pipelineId, tenant, workspace],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_stages
         (id, tenant_id, workspace_id, pipeline_id, name, sort_order, metadata)
       VALUES ($1, $2, $3, $4, 'Novo', 1, '{}'::jsonb)`,
      [stageId, tenant, workspace, pipelineId],
    );
    return { pipelineId, stageId };
  };

  const createOpportunity = async (options: {
    pipelineId: string;
    stageId: string;
    createdAt: string;
    client?: string | null;
    status?: string;
    wonAt?: string | null;
    value?: string | null;
    currency?: string;
    tenant?: string;
    workspace?: string;
  }) => {
    await AgencyDataSource.query(
      `INSERT INTO crm_opportunities
         (id, tenant_id, workspace_id, pipeline_id, stage_id, title, status,
          priority, source, business_mode, business_context, currency,
          value_amount, won_at, visibility, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Deal', $6, 'normal', 'manual', 'general',
               '{}'::jsonb, $7, $8, $9::timestamptz, 'workspace', $10::jsonb,
               $11::timestamptz, $11::timestamptz)`,
      [
        randomUUID(),
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        options.pipelineId,
        options.stageId,
        options.status ?? 'open',
        options.currency ?? 'BRL',
        options.value ?? null,
        options.wonAt ?? null,
        JSON.stringify(options.client ? { clientId: options.client } : {}),
        options.createdAt,
      ],
    );
  };

  const cohort = (
    options: { client?: string | null; connection?: string } = {},
  ) =>
    service.cohort(
      requireIntelligenceScope({
        tenantId,
        workspaceId,
        agencyClientId: options.client ?? null,
      }),
      WINDOW,
      options.connection ?? connectionId,
    );

  // ------------------------------------------------------------------- tests

  describe('both domains in one scope', () => {
    beforeAll(async () => {
      await createConnection({ id: connectionId });

      await insertSpend({
        metricDate: '2026-08-10',
        spend: '400.000000',
        leads: '10',
      });
      await insertSpend({
        metricDate: '2026-08-11',
        spend: '600.000000',
        leads: '10',
      });

      // Campaign-level rows for the same days. If the account filter were
      // missing, spend would double and every cost metric would halve.
      await insertSpend({
        metricDate: '2026-08-10',
        entityLevel: 'campaign',
        spend: '400.000000',
        leads: '10',
      });

      const channel = await createChannel({});
      await createConversation({
        channelId: channel,
        createdAt: '2026-08-10T12:00:00Z',
      });
      await createConversation({
        channelId: channel,
        createdAt: '2026-08-11T12:00:00Z',
      });
      await createConversation({
        channelId: channel,
        createdAt: '2026-08-12T12:00:00Z',
      });
      await createConversation({
        channelId: channel,
        createdAt: '2026-08-13T12:00:00Z',
      });

      const { pipelineId, stageId } = await createPipeline();
      await createOpportunity({
        pipelineId,
        stageId,
        createdAt: '2026-08-12T12:00:00Z',
      });
      await createOpportunity({
        pipelineId,
        stageId,
        createdAt: '2026-08-13T12:00:00Z',
      });
      await createOpportunity({
        pipelineId,
        stageId,
        createdAt: '2026-08-14T12:00:00Z',
        status: 'won',
        wonAt: '2026-08-20T12:00:00Z',
        value: '5000.000000',
      });
    });

    it('reports spend from account-level rows only', async () => {
      const view = await cohort();

      // 400 + 600, not 1400: the campaign row is excluded.
      expect(view.social.spend).toBe('1000.000000');
    });

    it('reports the funnel counts from LeadFlow and CRM', async () => {
      const view = await cohort();

      expect(view.leadflow.conversationsReceived).toBe('4');
      expect(view.leadflow.opportunitiesCreated).toBe('3');
      expect(view.leadflow.wonOpportunities).toBe('1');
      /**
       * Two decimals, not six — and passed through rather than reshaped.
       *
       * `crm_opportunities.value_amount` is `numeric(14,2)` while
       * `social_ad_metrics_daily.spend` is `numeric(18,6)`. The two domains
       * genuinely store money at different scales, and each value arrives as
       * the exact text its own column holds. Normalising them to a common
       * scale here would mean this layer deciding how another domain's money
       * is represented, and any such conversion is a place precision can be
       * lost; a consumer formats by the descriptor's unit instead.
       */
      expect(view.leadflow.wonOpportunityValue).toBe('5000.00');
    });

    it('keeps provider leads independent of conversations', async () => {
      const view = await cohort();

      expect(view.social.providerLeads).toBe('20');
      expect(view.leadflow.conversationsReceived).toBe('4');
      // The two are not reconciled, and the payload says why.
      expect(
        view.dataQuality.limitations.some((line) =>
          line.includes('contagens independentes'),
        ),
      ).toBe(true);
    });

    it('derives every cost metric from the period totals', async () => {
      const view = await cohort();

      // 1000 / 20 provider leads
      expect(view.derived.providerCpl).toBe('50.000000');
      // 1000 / 4 conversations
      expect(view.derived.costPerConversation).toBe('250.000000');
      // 1000 / 3 opportunities, rounded half-up at six decimals
      expect(view.derived.costPerOpportunity).toBe('333.333333');
      // 1000 / 1 won
      expect(view.derived.costPerWonOpportunity).toBe('1000.000000');
    });

    /**
     * The costs are derived; none of the stage-to-stage rates are.
     *
     * Each metric is cohorted on its own event date — conversations on
     * `created_at`, deals on `won_at` — so a quotient of two of them compares
     * populations that only partly overlap. The deals won in this window were
     * largely opened before it, which is why `opportunityToWonRate` is null
     * here even though both operands are present and the quotient would look
     * entirely reasonable.
     */
    it('nulls every stage-to-stage rate under event-window semantics', async () => {
      const view = await cohort();

      expect(view.derived.opportunityToWonRate).toBeNull();
      expect(view.derived.conversationToQualifiedRate).toBeNull();
      expect(view.derived.qualifiedToOpportunityRate).toBeNull();

      // The costs, which are valid period statistics, still resolve.
      expect(view.derived.costPerOpportunity).toBe('333.333333');
    });

    it('states the claim and the limitation', async () => {
      const view = await cohort();

      expect(view.kind).toBe('cohort_correlation');
      expect(view.joinBasis).toBe('date_channel_bucket');
      expect(view.dataQuality.individualAttribution).toBe(false);
      expect(view.dataQuality.limitations.length).toBeGreaterThan(0);
    });

    it('keeps both provenances', async () => {
      const view = await cohort();

      expect(view.provenance.social.canonicalSource).toContain(
        'social_ad_metrics_daily',
      );
      expect(view.provenance.social.attributionBasis).toBe('account_default');
      expect(view.provenance.leadflow.ingestionMode).toBe('live');
      expect(view.provenance.projector.dayBucketTimezone).toBe(
        'America/Sao_Paulo',
      );
    });

    it('reads no attribution observation', async () => {
      // The table exists and is empty for this fixture; the assertion is that
      // the view neither requires it nor reports anything derived from it.
      const view = await cohort();

      expect(view.dataQuality.individualAttribution).toBe(false);
      expect(Object.keys(view.leadflow)).not.toContain('attributedLeads');
    });
  });

  describe('timezone bucketing', () => {
    /**
     * The concrete misalignment the contract extension exists to fix.
     *
     * A conversation at 02:00 UTC on 2026-08-16 is 23:00 on the 15th in São
     * Paulo. Meta reports that evening's spend under the 15th. Bucketing
     * LeadFlow in UTC would put the conversation on the 16th, one day away from
     * the spend that preceded it.
     *
     * The window here ends on the 15th, so the conversation is only counted at
     * all if the day boundary is São Paulo's.
     */
    it('cuts LeadFlow days in the ad account timezone', async () => {
      const localTenant = randomUUID();
      const localConnection = randomUUID();

      await createConnection({ id: localConnection, tenant: localTenant });

      const channel = await createChannel({ tenant: localTenant });

      // 02:00 UTC on the 16th is 23:00 on the 15th in São Paulo.
      await createConversation({
        channelId: channel,
        createdAt: '2026-08-16T02:00:00Z',
        tenant: localTenant,
      });

      const view = await service.cohort(
        requireIntelligenceScope({
          tenantId: localTenant,
          workspaceId,
          agencyClientId: null,
        }),
        { since: '2026-08-01', until: '2026-08-15' },
        localConnection,
      );

      // Counted: in São Paulo the conversation happened on the 15th.
      expect(view.leadflow.conversationsReceived).toBe('1');
      expect(view.provenance.projector.dayBucketTimezoneSource).toBe(
        'ad_account',
      );

      await deleteFixtureTenant(AgencyDataSource, localTenant, tables);
    });

    it('reports a UTC fallback when the account carries no timezone', async () => {
      const zonelessTenant = randomUUID();
      const zonelessConnection = randomUUID();

      await createConnection({
        id: zonelessConnection,
        tenant: zonelessTenant,
        timezone: null,
      });

      const view = await service.cohort(
        requireIntelligenceScope({
          tenantId: zonelessTenant,
          workspaceId,
          agencyClientId: null,
        }),
        WINDOW,
        zonelessConnection,
      );

      expect(view.provenance.projector.dayBucketTimezoneSource).toBe(
        'utc_fallback',
      );
      expect(view.provenance.projector.dayBucketTimezone).toBe('UTC');

      await deleteFixtureTenant(AgencyDataSource, zonelessTenant, tables);
    });
  });

  describe('scope isolation', () => {
    beforeAll(async () => {
      await createConnection({
        id: otherTenantConnectionId,
        tenant: otherTenantId,
      });
      await createConnection({ id: clientConnectionId, client: clientId });

      // Another tenant's spend and funnel, on the same days.
      await insertSpend({
        connection: otherTenantConnectionId,
        tenant: otherTenantId,
        metricDate: '2026-08-10',
        spend: '9999.000000',
      });

      const otherChannel = await createChannel({ tenant: otherTenantId });
      await createConversation({
        channelId: otherChannel,
        createdAt: '2026-08-10T12:00:00Z',
        tenant: otherTenantId,
      });
    });

    it('never reads another tenant through a known connection id', async () => {
      // The connection belongs to `otherTenantId`; asking for it from this
      // tenant's scope must not find it.
      await expect(
        cohort({ connection: otherTenantConnectionId }),
      ).rejects.toThrow(/not found/i);
    });

    it('excludes another tenant funnel rows from this tenant totals', async () => {
      const view = await cohort();

      // The other tenant's conversation is not in the count.
      expect(view.leadflow.conversationsReceived).toBe('4');
      expect(view.social.spend).toBe('1000.000000');
    });

    it('isolates a workspace', async () => {
      await expect(
        service.cohort(
          requireIntelligenceScope({
            tenantId,
            workspaceId: otherWorkspaceId,
            agencyClientId: null,
          }),
          WINDOW,
          connectionId,
        ),
      ).rejects.toThrow(/not found/i);
    });

    /**
     * Agency-own context must not see a managed client's connection, and the
     * two use different mechanisms — a column on the Social side, a JSONB key
     * on the LeadFlow side — which is exactly why this is asserted here rather
     * than trusted from either domain's own suite.
     */
    it('separates a managed client from the agency context', async () => {
      await expect(cohort({ connection: clientConnectionId })).rejects.toThrow(
        /not found/i,
      );
    });

    it('reads a managed client connection in that client context', async () => {
      await insertSpend({
        connection: clientConnectionId,
        client: clientId,
        metricDate: '2026-08-10',
        spend: '250.000000',
      });

      const clientChannel = await createChannel({ client: clientId });
      await createConversation({
        channelId: clientChannel,
        createdAt: '2026-08-10T12:00:00Z',
      });

      const view = await cohort({
        client: clientId,
        connection: clientConnectionId,
      });

      expect(view.social.spend).toBe('250.000000');
      expect(view.leadflow.conversationsReceived).toBe('1');
    });

    it('does not leak one managed client into another', async () => {
      const view = await cohort({
        client: otherClientId,
        connection: clientConnectionId,
      }).catch((error: Error) => error);

      // Either not found, or found with no rows — never another client's spend.
      if (view instanceof Error) {
        expect(view.message).toMatch(/not found/i);
      } else {
        expect(view.social.spend).not.toBe('250.000000');
      }
    });
  });

  describe('mixed currency', () => {
    it('warns when spend and won value are in different currencies', async () => {
      const mixedTenant = randomUUID();
      const mixedConnection = randomUUID();

      await createConnection({ id: mixedConnection, tenant: mixedTenant });
      await insertSpend({
        connection: mixedConnection,
        tenant: mixedTenant,
        metricDate: '2026-08-10',
      });

      const { pipelineId, stageId } = await createPipeline(
        mixedTenant,
        workspaceId,
      );
      await createOpportunity({
        pipelineId,
        stageId,
        tenant: mixedTenant,
        createdAt: '2026-08-10T12:00:00Z',
        status: 'won',
        wonAt: '2026-08-11T12:00:00Z',
        value: '900.000000',
        currency: 'USD',
      });

      const view = await service.cohort(
        requireIntelligenceScope({
          tenantId: mixedTenant,
          workspaceId,
          agencyClientId: null,
        }),
        WINDOW,
        mixedConnection,
      );

      expect(
        view.dataQuality.limitations.some(
          (line) => line.includes('BRL') && line.includes('USD'),
        ),
      ).toBe(true);

      await deleteFixtureTenant(AgencyDataSource, mixedTenant, tables);
    });
  });

  describe('empty window', () => {
    it('reports zeros and null costs rather than failing', async () => {
      const emptyTenant = randomUUID();
      const emptyConnection = randomUUID();

      await createConnection({ id: emptyConnection, tenant: emptyTenant });

      const view = await service.cohort(
        requireIntelligenceScope({
          tenantId: emptyTenant,
          workspaceId,
          agencyClientId: null,
        }),
        WINDOW,
        emptyConnection,
      );

      expect(view.leadflow.conversationsReceived).toBe('0');
      expect(view.derived.costPerConversation).toBeNull();
      expect(view.derived.providerCpl).toBeNull();

      await deleteFixtureTenant(AgencyDataSource, emptyTenant, tables);
    });
  });

  /**
   * The two temporal facts I3.3 consumes, end to end through the real
   * projector: a qualification counted from its transition, and a destination
   * resolved from its observations.
   */
  describe('temporal facts', () => {
    const qualify = async (conversationId: string, occurredAt: string) =>
      AgencyDataSource.query(
        `INSERT INTO inbox_conversation_events
           (id, tenant_id, workspace_id, conversation_id, event_type,
            actor_type, payload)
         VALUES ($1, $2, $3, $4, 'qualification_status_changed', 'system',
                 $5::jsonb)`,
        [
          randomUUID(),
          tenantId,
          workspaceId,
          conversationId,
          JSON.stringify({
            previousStatus: 'pending',
            newStatus: 'qualified',
            reason: null,
            occurredAt,
          }),
        ],
      );

    const observeDestination = async (options: {
      externalId: string;
      destination: string;
      observedAt: string;
      connection?: string;
    }) => {
      const [entity] = await AgencyDataSource.query(
        `INSERT INTO social_ad_entities
           (tenant_id, workspace_id, connection_id, provider, entity_level,
            external_id)
         VALUES ($1, $2, $3, 'meta_ads', 'adset', $4)
         RETURNING id`,
        [
          tenantId,
          workspaceId,
          options.connection ?? connectionId,
          options.externalId,
        ],
      );

      await AgencyDataSource.query(
        `INSERT INTO social_ad_destination_observations
           (tenant_id, workspace_id, connection_id, ad_entity_id, provider,
            destination_type, destination_raw, observed_at)
         VALUES ($1, $2, $3, $4, 'meta_ads', $5, $6, $7::timestamptz)`,
        [
          tenantId,
          workspaceId,
          options.connection ?? connectionId,
          entity.id,
          options.destination,
          options.destination.toUpperCase(),
          options.observedAt,
        ],
      );

      return entity.id;
    };

    beforeAll(async () => {
      await reset();
      await createConnection({ id: connectionId });

      const channelId = await createChannel({ client: null });
      const conversationId = await createConversation({
        channelId,
        createdAt: '2026-08-02T12:00:00Z',
      });
      await qualify(conversationId, '2026-08-05T12:00:00Z');

      // A second conversation, qualified twice — counted once.
      const repeat = await createConversation({
        channelId,
        createdAt: '2026-08-03T12:00:00Z',
      });
      await qualify(repeat, '2026-08-06T12:00:00Z');
      await qualify(repeat, '2026-08-20T12:00:00Z');

      await observeDestination({
        externalId: `adset-${randomUUID()}`,
        destination: 'whatsapp',
        observedAt: '2026-08-15T09:00:00Z',
      });
    });

    afterAll(reset);

    it('counts each conversation’s first qualification once', async () => {
      const view = await cohort();

      expect(view.leadflow.qualifiedLeads).toBe('2');
      expect(view.dataQuality.qualificationHistory.observedQualified).toBe('2');
    });

    it('reports where qualification history begins', async () => {
      const view = await cohort();

      expect(view.dataQuality.qualificationHistory.coverageStart).toContain(
        '2026-08-05',
      );
      // The window opens on 2026-08-01, before the first transition.
      expect(view.dataQuality.qualificationHistory.legacyUnknown).toBe(true);
    });

    it('derives cost per qualified lead from the observed count', async () => {
      const view = await cohort();

      // A cost is a valid period statistic; the stage rates are not.
      expect(view.derived.costPerQualifiedLead).not.toBeNull();
      expect(view.derived.conversationToQualifiedRate).toBeNull();
      expect(view.derived.qualifiedToOpportunityRate).toBeNull();
    });

    it('reports destination coverage without claiming a resolved bucket', async () => {
      const view = await cohort();

      const history = view.dataQuality.destinationHistory;
      expect(history.firstObservedAt).toContain('2026-08-15');
      expect(history.coveredDays).toBeGreaterThan(0);
      expect(history.unknownDays).toBeGreaterThan(0);
      // Evidence exists; nothing in this response was resolved by it.
      expect(history.destinationResolution).toBe('unavailable');
      expect(view.dataQuality.channelResolution).toBe('provider_bucket');
    });

    /**
     * The legacy-period case §29 asks for explicitly: a window entirely before
     * both histories still answers, with the gaps stated rather than filled.
     */
    it('answers a window that predates both histories', async () => {
      const legacy = await service.cohort(
        requireIntelligenceScope({
          tenantId,
          workspaceId,
          agencyClientId: null,
        }),
        { since: '2026-06-01', until: '2026-06-30' },
        connectionId,
      );

      expect(legacy.kind).toBe('cohort_correlation');
      expect(legacy.leadflow.qualifiedLeads).toBe('0');
      expect(legacy.dataQuality.qualificationHistory.legacyUnknown).toBe(true);
      expect(legacy.dataQuality.destinationHistory.coveredDays).toBe(0);
      expect(legacy.dataQuality.destinationHistory.unknownDays).toBe(30);
      expect(legacy.dataQuality.partialData).toBe(true);
    });

    /**
     * Destination evidence belongs to a connection. Another connection's
     * observations must not appear in this one's coverage.
     */
    it('does not read another connection’s destination evidence', async () => {
      const isolated = randomUUID();
      await createConnection({ id: isolated });

      const view = await cohort({ connection: isolated });

      expect(view.dataQuality.destinationHistory.firstObservedAt).toBeNull();
      expect(view.dataQuality.destinationHistory.coveredDays).toBe(0);
    });
  });

  describe('performance', () => {
    const perfTenant = randomUUID();
    const perfConnection = randomUUID();

    beforeAll(async () => {
      await createConnection({ id: perfConnection, tenant: perfTenant });

      // 120 days of account facts, plus a campaign row per day so the
      // account-level filter has something to exclude.
      for (let day = 0; day < 120; day += 1) {
        const date = new Date(Date.UTC(2026, 4, 1) + day * 86_400_000)
          .toISOString()
          .slice(0, 10);
        await insertSpend({
          connection: perfConnection,
          tenant: perfTenant,
          metricDate: date,
        });
        await insertSpend({
          connection: perfConnection,
          tenant: perfTenant,
          metricDate: date,
          entityLevel: 'campaign',
        });
      }

      const channel = await createChannel({ tenant: perfTenant });
      const { pipelineId, stageId } = await createPipeline(
        perfTenant,
        workspaceId,
      );

      for (let day = 0; day < 120; day += 1) {
        const stamp = new Date(
          Date.UTC(2026, 4, 1, 12) + day * 86_400_000,
        ).toISOString();
        const conversationId = await createConversation({
          channelId: channel,
          createdAt: stamp,
          tenant: perfTenant,
        });
        /**
         * A qualification per conversation, so the first-qualification query is
         * actually exercised.
         *
         * Without these the measurement would time a `DISTINCT ON` over an
         * empty table and prove nothing about the query this step added.
         */
        await AgencyDataSource.query(
          `INSERT INTO inbox_conversation_events
             (id, tenant_id, workspace_id, conversation_id, event_type,
              actor_type, payload)
           VALUES ($1, $2, $3, $4, 'qualification_status_changed', 'system',
                   $5::jsonb)`,
          [
            randomUUID(),
            perfTenant,
            workspaceId,
            conversationId,
            JSON.stringify({
              previousStatus: 'pending',
              newStatus: 'qualified',
              reason: null,
              occurredAt: stamp,
            }),
          ],
        );
        await createOpportunity({
          pipelineId,
          stageId,
          tenant: perfTenant,
          createdAt: stamp,
        });
      }

      /**
       * Ad sets with destination history, at a shape close to production: the
       * live account holds 126 ad sets, and the observer appends only first
       * sightings and changes, so a handful of rows each.
       */
      for (let index = 0; index < 126; index += 1) {
        const [entity] = await AgencyDataSource.query<Array<{ id: string }>>(
          `INSERT INTO social_ad_entities
             (tenant_id, workspace_id, connection_id, provider, entity_level,
              external_id)
           VALUES ($1, $2, $3, 'meta_ads', 'adset', $4)
           RETURNING id`,
          [perfTenant, workspaceId, perfConnection, `perf-adset-${index}`],
        );

        // Three observations each: a first sighting and two observed changes.
        for (const [offset, destination] of [
          [0, 'whatsapp'],
          [40, 'instagram_direct'],
          [80, 'whatsapp'],
        ] as const) {
          await AgencyDataSource.query(
            `INSERT INTO social_ad_destination_observations
               (tenant_id, workspace_id, connection_id, ad_entity_id, provider,
                destination_type, destination_raw, observed_at)
             VALUES ($1, $2, $3, $4, 'meta_ads', $5, $6, $7::timestamptz)`,
            [
              perfTenant,
              workspaceId,
              perfConnection,
              entity.id,
              destination,
              destination.toUpperCase(),
              new Date(
                Date.UTC(2026, 4, 1, 9) + offset * 86_400_000,
              ).toISOString(),
            ],
          );
        }
      }

      /**
       * Ad-set facts at production shape, which is what makes this a
       * measurement of I3.5 rather than of I3.3.
       *
       * 126 ad sets × 120 days = 15,120 rows against 120 account rows: the
       * breakdown reads roughly two orders of magnitude more rows than the
       * overview beside it, joins each to the entity mirror, and runs a
       * `LATERAL` per row against 378 observations. Seeding fewer would time a
       * query that never touches an index.
       *
       * Inserted in one statement per day rather than one per row: 15,120
       * round trips is minutes of fixture setup, and the timing that matters is
       * the read.
       */
      for (let day = 0; day < 120; day += 1) {
        const date = new Date(Date.UTC(2026, 4, 1) + day * 86_400_000)
          .toISOString()
          .slice(0, 10);

        await AgencyDataSource.query(
          `INSERT INTO social_ad_metrics_daily
             (tenant_id, workspace_id, connection_id, provider, source,
              entity_level, entity_external_id, campaign_external_id,
              metric_date, account_timezone, currency, attribution_setting,
              spend, impressions, clicks, link_clicks, leads, conversions,
              conversion_value, video_views)
           SELECT $1, $2, $3, 'meta_ads', 'paid', 'adset',
                  'perf-adset-' || generated, 'perf-campaign', $4::date,
                  'America/Sao_Paulo', 'BRL', 'account_default',
                  1.500000, 80, 4, 2, 1, 0, 0, 0
             FROM generate_series(0, 125) AS generated`,
          [perfTenant, workspaceId, perfConnection, date],
        );
      }
    }, 180_000);

    afterAll(async () => {
      await deleteFixtureTenant(AgencyDataSource, perfTenant, tables);
    });

    const measure = async (since: string, until: string, label: string) => {
      const started = Date.now();
      const view = await service.cohort(
        requireIntelligenceScope({
          tenantId: perfTenant,
          workspaceId,
          agencyClientId: null,
        }),
        { since, until },
        perfConnection,
      );
      const elapsed = Date.now() - started;

      console.log(`[perf] cohort ${label}: ${elapsed}ms`);

      // Proves the measurement ran against seeded rows rather than an empty
      // table — the failure mode that makes a performance test meaningless.
      expect(view.social.spend).not.toBe('0.000000');
      expect(view.leadflow.conversationsReceived).not.toBe('0');
      // And that the two temporal reads had evidence to work over, so the
      // timing covers them rather than two empty-table scans.
      expect(view.leadflow.qualifiedLeads).not.toBe('0');
      expect(
        view.dataQuality.destinationHistory.firstObservedAt,
      ).not.toBeNull();
      /**
       * And that the breakdown was actually produced.
       *
       * Without this the timing would silently become a measurement of I3.3
       * again the day a filter regression emptied the buckets — the fastest
       * possible answer, and the wrong one.
       */
      expect(view.destinations.available).toBe(true);
      expect(view.destinations.buckets.length).toBeGreaterThan(0);

      return elapsed;
    };

    it('answers a 30-day window', async () => {
      const elapsed = await measure('2026-05-01', '2026-05-30', '30d');
      expect(elapsed).toBeLessThan(5_000);
    });

    it('answers a 90-day window', async () => {
      const elapsed = await measure('2026-05-01', '2026-07-29', '90d');
      expect(elapsed).toBeLessThan(5_000);
    });

    /**
     * The breakdown's own cost, separated from the four reads around it.
     *
     * The endpoint issues five reads in parallel, so a wall-clock total hides
     * which one grew. This times the new query alone and prints its plan, which
     * is the evidence any future index decision has to be made from — and the
     * evidence for *not* adding one now.
     */
    it('plans the destination breakdown without a sequential scan', async () => {
      const plan = await AgencyDataSource.query<
        Array<{ 'QUERY PLAN': Array<{ 'Execution Time': number }> }>
      >(
        `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)
         SELECT resolved.destination_type,
                SUM(fact.spend) AS spend,
                COUNT(DISTINCT fact.metric_date) AS fact_days
           FROM social_ad_metrics_daily fact
           JOIN social_ad_entities entity
             ON entity.tenant_id = fact.tenant_id
            AND entity.workspace_id = fact.workspace_id
            AND entity.connection_id = fact.connection_id
            AND entity.entity_level = 'adset'
            AND entity.external_id = fact.entity_external_id
           LEFT JOIN LATERAL (
             SELECT observation.destination_type
               FROM social_ad_destination_observations observation
              WHERE observation.ad_entity_id = entity.id
                AND (observation.observed_at
                     AT TIME ZONE 'America/Sao_Paulo')::date <= fact.metric_date
              ORDER BY observation.observed_at DESC,
                       observation.created_at DESC
              LIMIT 1
           ) resolved ON TRUE
          WHERE fact.tenant_id = $1
            AND fact.workspace_id = $2
            AND fact.connection_id = $3
            AND fact.entity_level = 'adset'
            AND fact.source = 'paid'
            AND fact.attribution_setting = 'account_default'
            AND fact.metric_date BETWEEN $4::date AND $5::date
          GROUP BY 1`,
        [perfTenant, workspaceId, perfConnection, '2026-05-01', '2026-07-29'],
      );

      const executionTime = plan[0]['QUERY PLAN'][0]['Execution Time'];
      const rendered = JSON.stringify(plan[0]['QUERY PLAN']);

      console.log(
        `[perf] destination breakdown 90d: ${executionTime.toFixed(1)}ms`,
      );

      /**
       * The property that decides whether this query scales, asserted without
       * naming an index.
       *
       * The two tables that grow with usage are the fact table — 15,120 ad-set
       * rows here against 120 account rows — and the observations, which the
       * `LATERAL` visits once per fact row. Neither may be read sequentially.
       * *Which* index the planner picks is its business and genuinely varies
       * with the statistics: this measurement has been observed choosing both
       * `IDX_social_ad_metrics_daily_read` and `..._campaign`, at the same ~6ms.
       * Pinning a name would make this a test of the planner that fails on a
       * healthy plan.
       *
       * `social_ad_entities` is deliberately exempt. The planner sometimes reads
       * it sequentially because the whole mirror is 64 rows in one page, which
       * is genuinely cheaper than a lookup — production's is 451 rows, still one
       * or two pages. `UQ_social_ad_entities_identity` already covers exactly
       * this join's columns, so the planner switches on its own once the table
       * is large enough to be worth it. Creating an index to satisfy an
       * assertion, with no measurement showing that scan is the bottleneck, is
       * the thing this step must not do.
       */
      expect(rendered).toContain('"Relation Name":"social_ad_metrics_daily"');

      const scannedSequentially = [
        ...rendered.matchAll(
          /"Node Type":"Seq Scan"[^}]*?"Relation Name":"([^"]+)"/g,
        ),
      ].map((match) => match[1]);

      expect(scannedSequentially).not.toContain('social_ad_metrics_daily');
      expect(scannedSequentially).not.toContain(
        'social_ad_destination_observations',
      );

      expect(executionTime).toBeLessThan(2_000);
    });
  });

  /**
   * The destination breakdown, end to end through both domains.
   *
   * The unit spec proves the composition rules; this proves the whole path — ad
   * set rows joined to observation history on one side, channel-scoped
   * conversation counts on the other, lined up by a projector that never queries
   * either table itself.
   */
  describe('destination breakdown', () => {
    const breakdownConnection = randomUUID();

    /** An ad set in the mirror, returning its internal id. */
    const createAdSet = async (externalId: string): Promise<string> => {
      const rows = await AgencyDataSource.query<Array<{ id: string }>>(
        `INSERT INTO social_ad_entities
           (tenant_id, workspace_id, connection_id, provider, entity_level,
            external_id)
         VALUES ($1, $2, $3, 'meta_ads', 'adset', $4)
         RETURNING id`,
        [tenantId, workspaceId, breakdownConnection, externalId],
      );

      return rows[0].id;
    };

    const observe = (
      adEntityId: string,
      destinationType: string,
      observedAt: string,
    ) =>
      AgencyDataSource.query(
        `INSERT INTO social_ad_destination_observations
           (tenant_id, workspace_id, connection_id, provider, ad_entity_id,
            destination_type, destination_raw, observed_at)
         VALUES ($1, $2, $3, 'meta_ads', $4, $5, $6, $7::timestamptz)`,
        [
          tenantId,
          workspaceId,
          breakdownConnection,
          adEntityId,
          destinationType,
          destinationType.toUpperCase(),
          observedAt,
        ],
      );

    const insertAdsetSpend = (options: {
      externalId: string;
      metricDate: string;
      spend: string;
      leads?: string;
    }) =>
      insertSpend({
        connection: breakdownConnection,
        metricDate: options.metricDate,
        entityLevel: 'adset',
        externalId: options.externalId,
        spend: options.spend,
        leads: options.leads ?? '0',
      });

    beforeAll(async () => {
      await createConnection({ id: breakdownConnection });

      // Account-level facts, which the response totals must keep using.
      await insertSpend({
        connection: breakdownConnection,
        metricDate: '2026-08-10',
        spend: '1000.000000',
        leads: '50',
      });

      const whatsappAdSet = await createAdSet('adset-wa');
      const directAdSet = await createAdSet('adset-ig');
      const multiAdSet = await createAdSet('adset-multi');
      const siteAdSet = await createAdSet('adset-site');
      const lateAdSet = await createAdSet('adset-late');

      await observe(whatsappAdSet, 'whatsapp', '2026-08-01T09:00:00-03:00');
      await observe(
        directAdSet,
        'instagram_direct',
        '2026-08-01T09:00:00-03:00',
      );
      await observe(multiAdSet, 'messaging_multi', '2026-08-01T09:00:00-03:00');
      await observe(siteAdSet, 'website', '2026-08-01T09:00:00-03:00');
      // Observed only near the end: its earlier spend has no destination.
      await observe(lateAdSet, 'whatsapp', '2026-08-25T09:00:00-03:00');

      await insertAdsetSpend({
        externalId: 'adset-wa',
        metricDate: '2026-08-10',
        spend: '600.000000',
        leads: '30',
      });
      await insertAdsetSpend({
        externalId: 'adset-ig',
        metricDate: '2026-08-10',
        spend: '200.000000',
        leads: '10',
      });
      await insertAdsetSpend({
        externalId: 'adset-multi',
        metricDate: '2026-08-10',
        spend: '100.000000',
        leads: '5',
      });
      await insertAdsetSpend({
        externalId: 'adset-site',
        metricDate: '2026-08-10',
        spend: '50.000000',
        leads: '4',
      });
      await insertAdsetSpend({
        externalId: 'adset-late',
        metricDate: '2026-08-10',
        spend: '40.000000',
        leads: '2',
      });

      // The funnel side: three channels, each with its own conversations.
      const whatsappChannel = await createChannel({});
      const instagramChannel = await createChannel({ type: 'instagram' });

      for (const day of ['2026-08-05', '2026-08-06', '2026-08-07']) {
        await createConversation({
          channelId: whatsappChannel,
          createdAt: `${day}T12:00:00Z`,
        });
      }
      await createConversation({
        channelId: instagramChannel,
        createdAt: '2026-08-08T12:00:00Z',
      });
    });

    const breakdownOf = async () => {
      const view = await cohort({ connection: breakdownConnection });

      return {
        view,
        byDestination: new Map(
          view.destinations.buckets.map((item) => [item.destination, item]),
        ),
      };
    };

    it('splits spend by observed destination without apportioning', async () => {
      const { byDestination } = await breakdownOf();

      expect(byDestination.get('whatsapp')?.social.spend).toBe('600.000000');
      expect(byDestination.get('instagram_direct')?.social.spend).toBe(
        '200.000000',
      );
      expect(byDestination.get('messaging_multi')?.social.spend).toBe(
        '100.000000',
      );
      expect(byDestination.get('website')?.social.spend).toBe('50.000000');
      // Spend before its ad set was first observed.
      expect(byDestination.get('unknown')?.social.spend).toBe('40.000000');
    });

    /**
     * The account total is not the sum of the buckets, and stays the account
     * total.
     *
     * 600 + 200 + 100 + 50 + 40 = 990, against an account row of 1000. The
     * response reports 1000, because that is the figure that reconciles with Ads
     * Manager and with every number this endpoint returned before I3.5.
     */
    it('leaves the period totals measured at account level', async () => {
      const { view } = await breakdownOf();

      expect(view.social.spend).toBe('1000.000000');
      expect(view.social.providerLeads).toBe('50');
      expect(view.dataQuality.limitations).toContain(
        COHORT_DESTINATION_NOT_A_PARTITION_LIMITATION,
      );
    });

    it('lines each inbox destination up with its own channel', async () => {
      const { byDestination } = await breakdownOf();
      const whatsapp = byDestination.get('whatsapp');
      const direct = byDestination.get('instagram_direct');

      expect(whatsapp?.leadflow.support).toBe('mapped');
      expect(whatsapp?.leadflow.channel).toBe('whatsapp');
      expect(whatsapp?.leadflow.conversationsReceived).toBe('3');

      expect(direct?.leadflow.channel).toBe('instagram');
      expect(direct?.leadflow.conversationsReceived).toBe('1');
    });

    /** The four conversations are never redistributed to cover the ad spend. */
    it('gives messaging_multi and website no funnel side at all', async () => {
      const { byDestination } = await breakdownOf();
      const multi = byDestination.get('messaging_multi');
      const website = byDestination.get('website');

      expect(multi?.leadflow.support).toBe('multi_destination');
      expect(multi?.leadflow.conversationsReceived).toBeNull();
      expect(multi?.derived.costPerConversation).toBeNull();
      // The paid side is still real, and so is its own CPL.
      expect(multi?.derived.providerCpl).toBe('20.000000');

      expect(website?.leadflow.support).toBe('no_inbox_equivalent');
      expect(website?.leadflow.conversationsReceived).toBeNull();
      expect(website?.derived.providerCpl).toBe('12.500000');
    });

    it('derives the mapped costs from the bucket and its channel', async () => {
      const { byDestination } = await breakdownOf();
      const whatsapp = byDestination.get('whatsapp');

      // 600 ÷ 30 provider leads, 600 ÷ 3 conversations.
      expect(whatsapp?.derived.providerCpl).toBe('20.000000');
      expect(whatsapp?.derived.costPerConversation).toBe('200.000000');
    });

    it('keeps unknown as a bucket and says why it is unknown', async () => {
      const { byDestination } = await breakdownOf();
      const unknown = byDestination.get('unknown');

      expect(unknown?.dataQuality.resolution).toBe('unavailable');
      expect(unknown?.dataQuality.temporalUnknownSpend).toBe('40.000000');
      expect(unknown?.leadflow.support).toBe('destination_unknown');
    });

    it('still reports the CRM only at period level', async () => {
      const { view, byDestination } = await breakdownOf();

      expect(view.leadflow).toHaveProperty('opportunitiesCreated');
      for (const bucket of byDestination.values()) {
        expect(bucket.leadflow).not.toHaveProperty('opportunitiesCreated');
      }
      expect(
        view.dataQuality.missingFacts.map((item) => item.metricKey),
      ).toContain('opportunities_by_destination');
    });

    it('keeps the stage rates null and the claim unchanged', async () => {
      const { view } = await breakdownOf();

      expect(view.kind).toBe('cohort_correlation');
      expect(view.joinBasis).toBe('date_channel_bucket');
      expect(view.derived.conversationToQualifiedRate).toBeNull();
      expect(view.derived.qualifiedToOpportunityRate).toBeNull();
      expect(view.derived.opportunityToWonRate).toBeNull();
    });

    it('claims observed destination resolution once ad-set facts exist', async () => {
      const { view } = await breakdownOf();

      expect(view.destinations.available).toBe(true);
      expect(view.dataQuality.destinationHistory.destinationResolution).toBe(
        'observed_destination',
      );
    });

    /**
     * §27: a connection certified before ad set existed still answers fully.
     *
     * Its own connection, with account-level facts only — which is the state
     * production is genuinely in today for every window the I3.4 backfill has
     * not reached. The totals must be complete and only the breakdown absent.
     */
    it('answers fully for a connection with no ad-set facts', async () => {
      const accountOnly = randomUUID();
      await createConnection({ id: accountOnly });
      await insertSpend({
        connection: accountOnly,
        metricDate: '2026-08-12',
        spend: '250.000000',
        leads: '5',
      });

      const view = await cohort({ connection: accountOnly });

      expect(view.social.spend).toBe('250.000000');
      expect(view.derived.providerCpl).toBe('50.000000');
      expect(view.destinations.available).toBe(false);
      expect(view.destinations.buckets).toEqual([]);
      expect(view.dataQuality.destinationHistory.destinationResolution).toBe(
        'unavailable',
      );
    });
  });
  /**
   * I5 against real rows, at the endpoint level (§30.14, §30.15).
   *
   * §24's requirement in its strongest form: a *historical* window must still
   * answer, must carry the current mode, and must say in the payload that the
   * label is current rather than a snapshot of that period.
   */
  describe('business mode dimension (I5)', () => {
    beforeAll(async () => {
      await createConnection({ id: connectionId });
    });

    afterEach(async () => {
      await AgencyDataSource.query(
        `DELETE FROM leadflow_client_settings WHERE tenant_id = $1`,
        [tenantId],
      );
    });

    it('reports a configured mode with current-context semantics', async () => {
      await AgencyDataSource.query(
        `INSERT INTO leadflow_client_settings
           (id, tenant_id, workspace_id, context_type, agency_client_id,
            business_mode_key, status)
         VALUES ($1, $2, $3, 'agency', NULL, 'clinics_esthetics', 'draft')`,
        [randomUUID(), tenantId, workspaceId],
      );

      const view = await cohort();

      expect(view.businessMode).toBe('clinics_esthetics');
      expect(view.businessModeDimension.resolution).toBe('configured');
      expect(view.businessModeDimension.temporalSemantics).toBe(
        'current_context_dimension',
      );
      expect(view.businessModeDimension.source).toBe(
        'leadflow_client_settings',
      );
    });

    /**
     * §24: a historical query is answered, never blocked — and it says so.
     *
     * The window here is months before the row was written, which is exactly
     * the case the limitation describes. Nothing about the query fails; the
     * caveat is data in the response rather than a reason to refuse.
     */
    it('answers a historical window and states the caveat', async () => {
      await AgencyDataSource.query(
        `INSERT INTO leadflow_client_settings
           (id, tenant_id, workspace_id, context_type, agency_client_id,
            business_mode_key, status)
         VALUES ($1, $2, $3, 'agency', NULL, 'real_estate', 'draft')`,
        [randomUUID(), tenantId, workspaceId],
      );

      const view = await service.cohort(
        requireIntelligenceScope({
          tenantId,
          workspaceId,
          agencyClientId: null,
        }),
        { since: '2026-01-01', until: '2026-01-31' },
        connectionId,
      );

      expect(view.businessMode).toBe('real_estate');
      expect(view.dataQuality.limitations).toContain(
        BUSINESS_MODE_CURRENT_ONLY_LIMITATION,
      );
    });

    it('reports null for a context with no LeadFlow settings row', async () => {
      const view = await cohort();

      expect(view.businessMode).toBeNull();
      expect(view.businessModeDimension.resolution).toBe('unconfigured');
      expect(view.dataQuality.limitations).not.toContain(
        BUSINESS_MODE_CURRENT_ONLY_LIMITATION,
      );
    });
  });
});
