import { randomUUID } from 'crypto';
import { requireIntelligenceScope } from '../../common/intelligence';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { LeadFlowIntelligenceAdapter } from '../leadflow-analytics/intelligence/leadflow-intelligence.adapter';
import { SocialAdAccountConnectionEntity } from '../social-integrations/entities/social-ad-account-connection.entity';
import { SocialAdEntity } from '../social-integrations/entities/social-ad-entity.entity';
import { SocialAdMetricDailyEntity } from '../social-integrations/entities/social-ad-metric-daily.entity';
import { SocialAdSyncRunEntity } from '../social-integrations/entities/social-ad-sync-run.entity';
import { SocialPaidMediaIntelligenceAdapter } from '../social-integrations/intelligence/social-paid-media-intelligence.adapter';
import { SocialAdSyncConfigService } from '../social-integrations/services/social-ad-sync-config.service';
import { SocialAnalyticsReadService } from '../social-integrations/services/social-analytics-read.service';
import { AcquisitionCohortService } from './acquisition-cohort.service';

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
        `ext_${options.entityLevel ?? 'account'}`,
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
  }) => {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_channels
         (id, tenant_id, workspace_id, name, type, provider, status,
          connection_status, lifecycle_version, credential_version,
          ai_enabled, settings, metadata)
       VALUES ($1, $2, $3, 'WhatsApp', 'whatsapp', 'meta', 'active',
               'connected', 1, 1, false, '{}'::jsonb, $4::jsonb)`,
      [
        id,
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        JSON.stringify(options.client ? { clientId: options.client } : {}),
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

    it('derives the funnel rate it can and nulls the ones it cannot', async () => {
      const view = await cohort();

      // 1 won / 3 created
      expect(view.derived.opportunityToWonRate).toBe('0.333333');
      // Both depend on qualified leads, which are not countable.
      expect(view.derived.conversationToQualifiedRate).toBeNull();
      expect(view.derived.qualifiedToOpportunityRate).toBeNull();
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
        await createConversation({
          channelId: channel,
          createdAt: stamp,
          tenant: perfTenant,
        });
        await createOpportunity({
          pipelineId,
          stageId,
          tenant: perfTenant,
          createdAt: stamp,
        });
      }
    }, 120_000);

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
  });
});
