import { randomUUID } from 'crypto';
import { requireIntelligenceScope } from '../../common/intelligence';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { LeadFlowAttributionAdapter } from '../leadflow-analytics/intelligence/leadflow-attribution.adapter';
import { SocialAdDestinationObservationEntity } from '../social-integrations/entities/social-ad-destination-observation.entity';
import { SocialAdEntity } from '../social-integrations/entities/social-ad-entity.entity';
import { SocialAdDestinationHistoryReadService } from '../social-integrations/services/social-ad-destination-history.read.service';
import { SocialAdHierarchyLookupReadService } from '../social-integrations/services/social-ad-hierarchy-lookup.read.service';
import { ObservedAttributionService } from './observed-attribution.service';

const run = describePostgresIntegration();

/**
 * The bridge over real rows, in the one database where both products live.
 *
 * The unit spec proves the decision logic against mocks. This proves the two
 * things mocks structurally cannot: that the scope predicates actually isolate
 * when another tenant's identical ad id is sitting in the same table, and that
 * the hierarchy walk climbs the tree it is supposed to climb.
 */
run('Observed attribution against PostgreSQL', () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();

  const connectionId = randomUUID();

  let service: ObservedAttributionService;
  let leadflow: LeadFlowAttributionAdapter;
  let hierarchy: SocialAdHierarchyLookupReadService;
  let destinations: SocialAdDestinationHistoryReadService;

  const tables = [
    'social_ad_destination_observations',
    'inbox_attribution_observations',
    'inbox_conversation_events',
    'inbox_messages',
    'inbox_conversations',
    'inbox_channels',
    'crm_opportunity_events',
    'crm_opportunities',
    'crm_stages',
    'crm_pipelines',
    'social_ad_entities',
    'social_ad_account_connections',
  ];

  const reset = async () => {
    for (const tenant of [tenantId, otherTenantId]) {
      await deleteFixtureTenant(AgencyDataSource, tenant, tables);
    }
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    await reset();

    leadflow = new LeadFlowAttributionAdapter(AgencyDataSource);
    hierarchy = new SocialAdHierarchyLookupReadService(
      AgencyDataSource.getRepository(SocialAdEntity),
    );
    destinations = new SocialAdDestinationHistoryReadService(
      AgencyDataSource.getRepository(SocialAdDestinationObservationEntity),
    );
    service = new ObservedAttributionService(leadflow, hierarchy, destinations);
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
  }) => {
    await AgencyDataSource.query(
      `INSERT INTO social_ad_account_connections
         (id, tenant_id, workspace_id, agency_client_id, provider,
          external_account_id, timezone, currency, connection_status)
       VALUES ($1, $2, $3, $4, 'meta_ads', $5, 'America/Sao_Paulo', 'BRL',
               'connected')`,
      [
        options.id,
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        options.client ?? null,
        `act_${options.id.slice(0, 8)}`,
      ],
    );
  };

  /**
   * One full account → campaign → ad set → ad chain.
   *
   * Built as four real rows rather than a single ad, because the hierarchy walk
   * is the thing under test: an ad whose parents do not exist would pass a test
   * that only checked the ad id.
   */
  const createAdTree = async (options: {
    connection: string;
    adId: string;
    tenant?: string;
    workspace?: string;
    client?: string | null;
    suffix?: string;
  }) => {
    const tenant = options.tenant ?? tenantId;
    const workspace = options.workspace ?? workspaceId;
    const client = options.client ?? null;
    const suffix = options.suffix ?? options.adId;

    const accountId = `act_${suffix}`;
    const campaignId = `camp_${suffix}`;
    const adsetId = `adset_${suffix}`;

    const insert = async (
      level: string,
      externalId: string,
      parent: string | null,
      campaign: string | null,
      name: string,
    ) => {
      await AgencyDataSource.query(
        `INSERT INTO social_ad_entities
           (id, tenant_id, workspace_id, agency_client_id, connection_id,
            provider, entity_level, external_id, parent_external_id,
            campaign_external_id, name, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, $5, 'meta_ads', $6, $7, $8, $9, $10,
                 now(), now())`,
        [
          randomUUID(),
          tenant,
          workspace,
          client,
          options.connection,
          level,
          externalId,
          parent,
          campaign,
          name,
        ],
      );
    };

    await insert('account', accountId, null, null, 'Conta');
    await insert('campaign', campaignId, accountId, campaignId, 'Campanha');
    await insert('adset', adsetId, campaignId, campaignId, 'Conjunto');
    await insert('ad', options.adId, adsetId, campaignId, 'Anúncio');

    return { accountId, campaignId, adsetId };
  };

  const createChannel = async (options: {
    tenant?: string;
    workspace?: string;
    client?: string | null;
    type?: string;
  }) => {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_channels
         (id, tenant_id, workspace_id, name, type, provider, status,
          connection_status, lifecycle_version, credential_version,
          ai_enabled, settings, metadata)
       VALUES ($1, $2, $3, 'Canal', $5, 'meta', 'active', 'connected', 1, 1,
               false, '{}'::jsonb, $4::jsonb)`,
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
    tenant?: string;
    workspace?: string;
    createdAt?: string;
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
        options.createdAt ?? '2026-09-01T10:00:00Z',
      ],
    );
    return id;
  };

  /** One inbound message plus the observation it carried. */
  const observe = async (options: {
    conversationId: string;
    adId?: string | null;
    clickId?: string | null;
    sourceType?: string | null;
    observedAt?: string;
    provider?: string;
    channelType?: string;
    channelId?: string | null;
    tenant?: string;
    workspace?: string;
    client?: string | null;
  }) => {
    const tenant = options.tenant ?? tenantId;
    const workspace = options.workspace ?? workspaceId;
    const messageId = randomUUID();
    const observedAt = options.observedAt ?? '2026-09-01T10:00:00Z';

    await AgencyDataSource.query(
      `INSERT INTO inbox_messages
         (id, tenant_id, workspace_id, conversation_id, direction, sender_type,
          message_type, content, status, attachments, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, 'inbound', 'contact', 'text', 'oi', 'delivered',
               '[]'::jsonb, '{}'::jsonb, $5::timestamptz)`,
      [messageId, tenant, workspace, options.conversationId, observedAt],
    );

    await AgencyDataSource.query(
      `INSERT INTO inbox_attribution_observations
         (id, tenant_id, workspace_id, agency_client_id, conversation_id,
          message_id, channel_id, provider, channel_type, ad_id, click_id,
          source_type, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12,
               $13::timestamptz)`,
      [
        randomUUID(),
        tenant,
        workspace,
        options.client ?? null,
        options.conversationId,
        messageId,
        options.channelId ?? null,
        options.provider ?? 'meta',
        options.channelType ?? 'whatsapp',
        options.adId === undefined ? 'ad-1' : options.adId,
        options.clickId === undefined ? 'clid-1' : options.clickId,
        options.sourceType === undefined ? 'ad' : options.sourceType,
        observedAt,
      ],
    );

    return messageId;
  };

  const qualify = async (options: {
    conversationId: string;
    occurredAt: string;
    tenant?: string;
    workspace?: string;
  }) => {
    await AgencyDataSource.query(
      `INSERT INTO inbox_conversation_events
         (id, tenant_id, workspace_id, conversation_id, event_type, payload,
          created_at)
       VALUES ($1, $2, $3, $4, 'qualification_status_changed', $5::jsonb,
               now())`,
      [
        randomUUID(),
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        options.conversationId,
        JSON.stringify({
          newStatus: 'qualified',
          occurredAt: options.occurredAt,
        }),
      ],
    );
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
    conversationId: string | null;
    status?: string;
    wonAt?: string | null;
    value?: string | null;
    currency?: string;
    client?: string | null;
    tenant?: string;
    workspace?: string;
  }) => {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO crm_opportunities
         (id, tenant_id, workspace_id, pipeline_id, stage_id, title, status,
          priority, source, business_mode, business_context, currency,
          value_amount, won_at, visibility, metadata, inbox_conversation_id,
          created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Deal', $6, 'normal', 'manual', 'general',
               '{}'::jsonb, $7, $8, $9::timestamptz, 'workspace', $10::jsonb,
               $11, now(), now())`,
      [
        id,
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        options.pipelineId,
        options.stageId,
        options.status ?? 'open',
        options.currency ?? 'BRL',
        options.value ?? null,
        options.wonAt ?? null,
        JSON.stringify(options.client ? { clientId: options.client } : {}),
        options.conversationId,
      ],
    );
    return id;
  };

  const attribution = (
    conversationId: string,
    options: { client?: string | null } = {},
  ) =>
    service.conversation(
      requireIntelligenceScope({
        tenantId,
        workspaceId,
        agencyClientId: options.client ?? null,
      }),
      conversationId,
    );

  // ------------------------------------------------------------------- tests

  describe('the hierarchy walk', () => {
    let conversationId: string;
    let tree: { accountId: string; campaignId: string; adsetId: string };

    beforeAll(async () => {
      await createConnection({ id: connectionId });
      tree = await createAdTree({ connection: connectionId, adId: 'ad-walk' });

      const channelId = await createChannel({});
      conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-walk', channelId });
    });

    it('resolves the observed ad id to the ad', async () => {
      const view = await attribution(conversationId);

      expect(view?.matchStatus).toBe('matched');
      expect(view?.paidMedia?.adId).toBe('ad-walk');
    });

    it('climbs from ad to ad set', async () => {
      const view = await attribution(conversationId);
      expect(view?.paidMedia?.adsetId).toBe(tree.adsetId);
    });

    it('climbs from ad set to campaign', async () => {
      const view = await attribution(conversationId);
      expect(view?.paidMedia?.campaignId).toBe(tree.campaignId);
    });

    it('climbs from campaign to account', async () => {
      const view = await attribution(conversationId);
      expect(view?.paidMedia?.accountId).toBe(tree.accountId);
    });

    it('names the connection that owns the ad', async () => {
      const view = await attribution(conversationId);
      expect(view?.paidMedia?.connectionId).toBe(connectionId);
    });

    /**
     * Names travel for display; the join never uses them. Asserted because a
     * later "match by campaign name" would be a plausible-looking change.
     */
    it('carries provider names for display', async () => {
      const view = await attribution(conversationId);

      expect(view?.paidMedia?.adName).toBe('Anúncio');
      expect(view?.paidMedia?.adsetName).toBe('Conjunto');
      expect(view?.paidMedia?.campaignName).toBe('Campanha');
    });

    /**
     * The bridge must work with no metric row anywhere — which is exactly
     * production's state today, where the ad-set backfill has not run.
     */
    it('attributes with no social metrics at all', async () => {
      const facts = await AgencyDataSource.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count FROM social_ad_metrics_daily
          WHERE tenant_id = $1`,
        [tenantId],
      );

      expect(facts[0].count).toBe('0');
      await expect(attribution(conversationId)).resolves.toMatchObject({
        matchStatus: 'matched',
      });
    });

    it('degrades to a partial path when a parent is missing', async () => {
      const orphanConversation = await createConversation({
        channelId: await createChannel({}),
      });
      await AgencyDataSource.query(
        `INSERT INTO social_ad_entities
           (id, tenant_id, workspace_id, connection_id, provider, entity_level,
            external_id, parent_external_id, name, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, $4, 'meta_ads', 'ad', 'ad-orphan', 'adset-gone',
                 'Órfão', now(), now())`,
        [randomUUID(), tenantId, workspaceId, connectionId],
      );
      await observe({ conversationId: orphanConversation, adId: 'ad-orphan' });

      const view = await attribution(orphanConversation);

      // Still matched — the ad is real. The unresolved levels are null rather
      // than the whole result being discarded.
      expect(view?.matchStatus).toBe('matched');
      expect(view?.paidMedia?.adId).toBe('ad-orphan');
      expect(view?.paidMedia?.adsetId).toBeNull();
      expect(view?.paidMedia?.campaignId).toBeNull();
      expect(view?.paidMedia?.accountId).toBeNull();
    });
  });

  describe('scope isolation', () => {
    /**
     * The collision test the brief asked for: the *same* external ad id under a
     * different tenant, a different workspace, and a different client. A join
     * missing any one of the three scope columns passes every other test in
     * this file and fails these.
     */
    it('never resolves an ad id belonging to another tenant', async () => {
      const otherConnection = randomUUID();
      await createConnection({
        id: otherConnection,
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
      });
      await createAdTree({
        connection: otherConnection,
        adId: 'ad-collision',
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
        suffix: 'other-tenant',
      });

      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-collision' });

      const view = await attribution(conversationId);

      expect(view?.matchStatus).toBe('ad_not_found');
      expect(view?.paidMedia).toBeNull();
      expect(view?.dataQuality.individualAttribution).toBe(false);
    });

    it('never resolves an ad id belonging to another client', async () => {
      const clientConnection = randomUUID();
      await createConnection({ id: clientConnection, client: otherClientId });
      await createAdTree({
        connection: clientConnection,
        adId: 'ad-client-only',
        client: otherClientId,
        suffix: 'other-client',
      });

      const channelId = await createChannel({ client: clientId });
      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-client-only' });

      // Asked in the *first* client's context: the ad belongs to the second.
      const view = await attribution(conversationId, { client: clientId });

      expect(view?.matchStatus).toBe('ad_not_found');
    });

    /**
     * The same id, resolvable in its own context. Proves the previous test
     * failed for the scope and not because the fixture was broken.
     */
    it('resolves that same ad id inside its own client context', async () => {
      const channelId = await createChannel({ client: otherClientId });
      const conversationId = await createConversation({ channelId });
      await observe({
        conversationId,
        adId: 'ad-client-only',
        client: otherClientId,
      });

      const view = await attribution(conversationId, { client: otherClientId });

      expect(view?.matchStatus).toBe('matched');
      expect(view?.paidMedia?.adId).toBe('ad-client-only');
    });

    it('does not return another tenant’s conversation at all', async () => {
      const otherChannel = await createChannel({
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
      });
      const otherConversation = await createConversation({
        channelId: otherChannel,
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
      });
      await observe({
        conversationId: otherConversation,
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
      });

      // Null, which the controller turns into a 404 — not a distinguishable
      // "exists but forbidden".
      await expect(attribution(otherConversation)).resolves.toBeNull();
    });

    /**
     * Ambiguity is a real production shape: this workspace holds two Meta Ads
     * connections today.
     */
    it('fails closed when two connections claim the same ad id', async () => {
      const first = randomUUID();
      const second = randomUUID();
      await createConnection({ id: first });
      await createConnection({ id: second });
      await createAdTree({
        connection: first,
        adId: 'ad-ambiguous',
        suffix: 'amb-a',
      });
      await createAdTree({
        connection: second,
        adId: 'ad-ambiguous',
        suffix: 'amb-b',
      });

      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-ambiguous' });

      const view = await attribution(conversationId);

      expect(view?.matchStatus).toBe('ambiguous_connection');
      expect(view?.paidMedia).toBeNull();
      expect(view?.ambiguousConnectionIds.sort()).toEqual(
        [first, second].sort(),
      );
    });
  });

  describe('the observations', () => {
    it('orders first and last by provider time, not insert order', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });

      // Written newest-first on purpose: a query relying on insert order would
      // report these backwards.
      await observe({
        conversationId,
        adId: 'ad-walk',
        observedAt: '2026-09-20T10:00:00Z',
      });
      await observe({
        conversationId,
        adId: 'ad-walk',
        observedAt: '2026-09-02T10:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.conversation.firstObservedAt).toBe(
        '2026-09-02T10:00:00.000Z',
      );
      expect(view?.conversation.lastObservedAt).toBe(
        '2026-09-20T10:00:00.000Z',
      );
      expect(view?.conversation.consistency).toBe('multiple_consistent');
      expect(view?.matchStatus).toBe('matched');
    });

    it('keeps conflicting ads apart instead of collapsing them', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });

      await createAdTree({
        connection: connectionId,
        adId: 'ad-conflict-b',
        suffix: 'conflict-b',
      });

      await observe({
        conversationId,
        adId: 'ad-walk',
        observedAt: '2026-09-03T10:00:00Z',
      });
      await observe({
        conversationId,
        adId: 'ad-conflict-b',
        observedAt: '2026-09-04T10:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.matchStatus).toBe('conflicting_observations');
      expect(view?.conversation.distinctAdIds).toEqual([
        'ad-conflict-b',
        'ad-walk',
      ]);
      expect(view?.paidMedia).toBeNull();
      expect(view?.dataQuality.attributionConflict).toBe(true);
      // Both messages survive as evidence.
      expect(view?.evidence).toHaveLength(2);
    });

    it('preserves the click id as evidence without exposing it', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });
      await observe({
        conversationId,
        adId: null,
        clickId: 'clid-secret',
        sourceType: 'post',
      });

      const view = await attribution(conversationId);

      expect(view?.matchStatus).toBe('no_ad_id');
      expect(view?.evidence[0].clickIdPresent).toBe(true);
      expect(view?.evidence[0].sourceType).toBe('post');
      expect(JSON.stringify(view)).not.toContain('clid-secret');
    });

    it('reports a conversation with no observation at all', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });

      const view = await attribution(conversationId);

      expect(view?.matchStatus).toBe('no_ad_id');
      expect(view?.dataQuality.providerEvidence).toBe(false);
      expect(view?.evidence).toEqual([]);
      expect(view?.conversation.observationCount).toBe(0);
    });
  });

  describe('the opportunity link', () => {
    let conversationId: string;
    let pipeline: { pipelineId: string; stageId: string };

    beforeAll(async () => {
      pipeline = await createPipeline();
      const channelId = await createChannel({});
      conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-walk' });
    });

    it('links only by explicit inbox_conversation_id', async () => {
      await createOpportunity({
        ...pipeline,
        conversationId,
        status: 'won',
        wonAt: '2026-09-15T12:00:00Z',
        value: '1500.00',
      });

      // A second opportunity in the same workspace, same day, no link.
      await createOpportunity({
        ...pipeline,
        conversationId: null,
        status: 'won',
        wonAt: '2026-09-15T12:00:00Z',
        value: '9999.00',
      });

      const view = await attribution(conversationId);

      expect(view?.outcomes.opportunityCount).toBe(1);
      expect(view?.outcomes.wonOpportunityCount).toBe(1);
      expect(view?.outcomes.wonOpportunityValue).toBe('1500.00');
      expect(view?.dataQuality.opportunityLinkExplicit).toBe(true);
    });

    it('returns every linked opportunity rather than choosing one', async () => {
      const channelId = await createChannel({});
      const multi = await createConversation({ channelId });
      await observe({ conversationId: multi, adId: 'ad-walk' });

      await createOpportunity({
        ...pipeline,
        conversationId: multi,
        status: 'won',
        wonAt: '2026-09-16T12:00:00Z',
        value: '100.00',
      });
      await createOpportunity({
        ...pipeline,
        conversationId: multi,
        status: 'won',
        wonAt: '2026-09-17T12:00:00Z',
        value: '250.50',
      });
      await createOpportunity({
        ...pipeline,
        conversationId: multi,
        status: 'open',
        value: '77.00',
      });

      const view = await attribution(multi);

      expect(view?.outcomes.opportunityCount).toBe(3);
      expect(view?.outcomes.wonOpportunityCount).toBe(2);
      expect(view?.outcomes.wonOpportunityValue).toBe('350.50');
    });

    /**
     * The canonical definition, reused. A row marked won with no `won_at` is
     * excluded here exactly as the period report excludes it.
     */
    it('requires both status and won_at to call a deal won', async () => {
      const channelId = await createChannel({});
      const halfWon = await createConversation({ channelId });
      await observe({ conversationId: halfWon, adId: 'ad-walk' });

      await createOpportunity({
        ...pipeline,
        conversationId: halfWon,
        status: 'won',
        wonAt: null,
        value: '500.00',
      });

      const view = await attribution(halfWon);

      expect(view?.outcomes.opportunityCount).toBe(1);
      expect(view?.outcomes.wonOpportunityCount).toBe(0);
      expect(view?.outcomes.wonOpportunityValue).toBe('0.00');
    });

    it('does not reach an opportunity in another tenant', async () => {
      const otherPipeline = await createPipeline(
        otherTenantId,
        otherWorkspaceId,
      );
      const channelId = await createChannel({});
      const isolated = await createConversation({ channelId });
      await observe({ conversationId: isolated, adId: 'ad-walk' });

      await createOpportunity({
        ...otherPipeline,
        conversationId: isolated,
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
        status: 'won',
        wonAt: '2026-09-18T12:00:00Z',
        value: '4242.00',
      });

      const view = await attribution(isolated);

      expect(view?.outcomes.opportunityCount).toBe(0);
    });
  });

  describe('the qualification link', () => {
    it('reads the earliest recorded transition', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-walk' });

      // Written out of order; the earliest must win.
      await qualify({ conversationId, occurredAt: '2026-09-11T09:00:00Z' });
      await qualify({ conversationId, occurredAt: '2026-09-05T09:00:00Z' });

      const view = await attribution(conversationId);

      expect(view?.conversation.firstQualifiedAt).toBe('2026-09-05T09:00:00Z');
    });

    /**
     * The current column is not history. A conversation whose
     * `qualification_status` says qualified, with no recorded transition,
     * reports null rather than inventing a time.
     */
    it('never infers a time from the current status column', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-walk' });
      await AgencyDataSource.query(
        `UPDATE inbox_conversations SET qualification_status = 'qualified'
          WHERE id = $1`,
        [conversationId],
      );

      const view = await attribution(conversationId);

      expect(view?.conversation.firstQualifiedAt).toBeNull();
    });
  });

  describe('the temporal destination (I4.1)', () => {
    /** One destination observation for an ad set, at an absolute instant. */
    const observeDestination = async (options: {
      adEntityId: string;
      destination: string;
      raw?: string | null;
      observedAt: string;
      connection?: string;
      tenant?: string;
      workspace?: string;
      client?: string | null;
    }) => {
      await AgencyDataSource.query(
        `INSERT INTO social_ad_destination_observations
           (id, tenant_id, workspace_id, agency_client_id, connection_id,
            ad_entity_id, provider, destination_type, destination_raw,
            observed_at, created_at)
         VALUES ($1, $2, $3, $4, $5, $6, 'meta_ads', $7, $8, $9::timestamptz,
                 now())`,
        [
          randomUUID(),
          options.tenant ?? tenantId,
          options.workspace ?? workspaceId,
          options.client ?? null,
          options.connection ?? connectionId,
          options.adEntityId,
          options.destination,
          options.raw === undefined
            ? options.destination.toUpperCase()
            : options.raw,
          options.observedAt,
        ],
      );
    };

    /** The internal row id of an ad set, which observations key on. */
    const adsetEntityId = async (externalId: string, connection?: string) => {
      const rows = await AgencyDataSource.query<Array<{ id: string }>>(
        `SELECT id::text AS id FROM social_ad_entities
          WHERE tenant_id = $1 AND workspace_id = $2 AND connection_id = $3
            AND entity_level = 'adset' AND external_id = $4`,
        [tenantId, workspaceId, connection ?? connectionId, externalId],
      );
      return rows[0].id;
    };

    /** A fresh ad tree plus an attributed conversation over it. */
    const scenario = async (options: {
      adId: string;
      attributionAt: string;
      extraAttributionAt?: string;
    }) => {
      const tree = await createAdTree({
        connection: connectionId,
        adId: options.adId,
        suffix: options.adId,
      });
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });
      await observe({
        conversationId,
        adId: options.adId,
        observedAt: options.attributionAt,
      });
      if (options.extraAttributionAt) {
        await observe({
          conversationId,
          adId: options.adId,
          observedAt: options.extraAttributionAt,
        });
      }
      return {
        conversationId,
        adsetEntityId: await adsetEntityId(tree.adsetId),
      };
    };

    it.each([
      ['whatsapp', 'WHATSAPP'],
      ['instagram_direct', 'INSTAGRAM_DIRECT'],
      ['messenger', 'MESSENGER'],
      ['messaging_multi', 'MESSAGING_MESSENGER_WHATSAPP'],
    ])('resolves %s from the observation log', async (destination, raw) => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: `ad-dest-${destination}`,
        attributionAt: '2026-09-10T12:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination,
        raw,
        observedAt: '2026-09-01T08:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.paidMedia?.destination).toMatchObject({
        value: destination,
        resolution: 'observed_destination',
        raw,
        consistency: 'single',
      });
      expect(view?.dataQuality.destinationResolved).toBe(true);
    });

    /** §7 cause B — Meta answered, and the answer was "nothing configured". */
    it('keeps a provider UNDEFINED distinguishable from no history', async () => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: 'ad-dest-undefined',
        attributionAt: '2026-09-10T12:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination: 'unknown',
        raw: 'UNDEFINED',
        observedAt: '2026-09-01T08:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.paidMedia?.destination?.value).toBe('unknown');
      expect(view?.paidMedia?.destination?.raw).toBe('UNDEFINED');
      expect(view?.dataQuality.destinationTemporalEvidence).toBe(true);
    });

    /** §2 — the attribution predates the history entirely. Still matched. */
    it('reports unavailable when every observation is later', async () => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: 'ad-dest-early',
        attributionAt: '2026-09-01T12:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination: 'whatsapp',
        observedAt: '2026-09-20T08:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.matchStatus).toBe('matched');
      expect(view?.dataQuality.individualAttribution).toBe(true);
      expect(view?.paidMedia?.destination).toMatchObject({
        value: null,
        resolution: 'unavailable_before_first_observation',
        consistency: 'unavailable',
      });
    });

    /**
     * §3 in the database, not just in the source.
     *
     * The ad set row carries a current destination; the observation log has
     * nothing before the attribution. The answer must be unavailable, not the
     * column's value.
     */
    it('ignores the current destination column entirely', async () => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: 'ad-dest-current',
        attributionAt: '2026-09-01T12:00:00Z',
      });
      await AgencyDataSource.query(
        `UPDATE social_ad_entities
            SET destination_type = 'whatsapp', destination_raw = 'WHATSAPP',
                destination_observed_at = now()
          WHERE id = $1`,
        [adset],
      );

      const view = await attribution(conversationId);

      expect(view?.paidMedia?.destination?.value).toBeNull();
      expect(view?.paidMedia?.destination?.resolution).toBe(
        'unavailable_before_first_observation',
      );
    });

    /** The boundary is inclusive: an observation at the exact instant counts. */
    it('includes an observation made at the exact attribution instant', async () => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: 'ad-dest-exact',
        attributionAt: '2026-09-10T12:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination: 'whatsapp',
        observedAt: '2026-09-10T12:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.paidMedia?.destination?.value).toBe('whatsapp');
    });

    /** A transition after the attribution must not reach back to it. */
    it('ignores a transition later than the attribution', async () => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: 'ad-dest-later',
        attributionAt: '2026-09-10T12:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination: 'whatsapp',
        observedAt: '2026-09-01T08:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination: 'instagram_direct',
        observedAt: '2026-09-15T08:00:00Z',
      });

      const view = await attribution(conversationId);

      // The 15th is after the conversation; the 1st is the last one before it.
      expect(view?.paidMedia?.destination?.value).toBe('whatsapp');
      // And the instant reported is the winning observation's, not the later
      // one's — the assertion that would fail if the ordering were reversed.
      expect(view?.paidMedia?.destination?.observedAt).toBe(
        '2026-09-01T08:00:00.000Z',
      );
    });

    /** §5 — same ad, two instants, destination changed between them. */
    it('reports temporal variation across two attribution instants', async () => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: 'ad-dest-varied',
        attributionAt: '2026-09-05T12:00:00Z',
        extraAttributionAt: '2026-09-25T12:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination: 'whatsapp',
        observedAt: '2026-09-01T08:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination: 'instagram_direct',
        observedAt: '2026-09-20T08:00:00Z',
      });

      const view = await attribution(conversationId);

      // Attribution is untouched — one ad, two clicks.
      expect(view?.conversation.consistency).toBe('multiple_consistent');
      expect(view?.dataQuality.attributionConflict).toBe(false);

      expect(view?.dataQuality.destinationConsistency).toBe(
        'temporal_variation',
      );
      expect(view?.paidMedia?.destination?.value).toBeNull();
      expect(
        view?.paidMedia?.destination?.readings.map((r) => r.value),
      ).toEqual(['whatsapp', 'instagram_direct']);
    });

    it('reports multiple_consistent when both instants agree', async () => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: 'ad-dest-agree',
        attributionAt: '2026-09-05T12:00:00Z',
        extraAttributionAt: '2026-09-25T12:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination: 'whatsapp',
        observedAt: '2026-09-01T08:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.dataQuality.destinationConsistency).toBe(
        'multiple_consistent',
      );
      expect(view?.paidMedia?.destination?.value).toBe('whatsapp');
    });

    /**
     * §15 — an observation belonging to another connection's ad set must be
     * unreachable, even when both ad sets share an external id.
     */
    it('never reads an observation from another connection', async () => {
      const otherConnection = randomUUID();
      await createConnection({ id: otherConnection });
      await createAdTree({
        connection: otherConnection,
        adId: 'ad-dest-other-conn',
        suffix: 'other-conn',
      });
      const foreignAdset = await adsetEntityId(
        'adset_other-conn',
        otherConnection,
      );

      const { conversationId } = await scenario({
        adId: 'ad-dest-isolated',
        attributionAt: '2026-09-10T12:00:00Z',
      });

      // The destination exists — under the wrong connection's ad set.
      await observeDestination({
        adEntityId: foreignAdset,
        connection: otherConnection,
        destination: 'whatsapp',
        observedAt: '2026-09-01T08:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.paidMedia?.destination?.resolution).toBe(
        'unavailable_before_first_observation',
      );
    });

    /** §16 — tenant isolation on the observation read itself. */
    it('never reads an observation from another tenant', async () => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: 'ad-dest-tenant',
        attributionAt: '2026-09-10T12:00:00Z',
      });

      // Same ad set row, but the observation is filed under another tenant.
      await observeDestination({
        adEntityId: adset,
        tenant: otherTenantId,
        workspace: otherWorkspaceId,
        destination: 'whatsapp',
        observedAt: '2026-09-01T08:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.paidMedia?.destination?.resolution).toBe(
        'unavailable_before_first_observation',
      );
    });

    /** §12 — still no metric row anywhere. */
    it('enriches with no social metrics present', async () => {
      const { conversationId, adsetEntityId: adset } = await scenario({
        adId: 'ad-dest-nometrics',
        attributionAt: '2026-09-10T12:00:00Z',
      });
      await observeDestination({
        adEntityId: adset,
        destination: 'whatsapp',
        observedAt: '2026-09-01T08:00:00Z',
      });

      const facts = await AgencyDataSource.query<Array<{ count: string }>>(
        `SELECT COUNT(*)::text AS count FROM social_ad_metrics_daily
          WHERE tenant_id = $1`,
        [tenantId],
      );

      expect(facts[0].count).toBe('0');
      expect(
        (await attribution(conversationId))?.paidMedia?.destination?.value,
      ).toBe('whatsapp');
    });

    it('names the destination as its own provenance layer', async () => {
      const { conversationId } = await scenario({
        adId: 'ad-dest-provenance',
        attributionAt: '2026-09-10T12:00:00Z',
      });

      const view = await attribution(conversationId);

      expect(view?.provenance.destination).toBe(
        'social_ad_destination_observations',
      );
      expect(view?.provenance.paidMedia).toBe('social_ad_entities');
    });
  });

  describe('performance', () => {
    it('answers a single conversation quickly', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-walk' });

      const started = Date.now();
      await attribution(conversationId);
      const elapsed = Date.now() - started;

      // Generous: this asserts the shape is a handful of indexed lookups, not a
      // scan that happens to be fast on a small fixture.
      expect(elapsed).toBeLessThan(1000);
    });

    /**
     * The hierarchy lookup at a realistic mirror size.
     *
     * The correctness fixtures above hold ~25 entity rows, where a sequential
     * scan is genuinely the fastest plan and asserting otherwise would be
     * testing the planner rather than the code. Production's mirror is 452 rows
     * and a busy agency's is a few thousand, so this builds 4,000 and measures
     * what the query actually costs there.
     *
     * No index is created either way: `UQ_social_ad_entities_identity` covers
     * (tenant, workspace, connection, level, external_id), which is exactly
     * what every join predicate here supplies, and the planner switches to it
     * on its own once the table is worth an index scan.
     */
    it('stays fast on a realistic mirror', async () => {
      const bulkConnection = randomUUID();
      await createConnection({ id: bulkConnection });

      // 4,000 ads under one connection, each with its own ad set and campaign.
      await AgencyDataSource.query(
        `INSERT INTO social_ad_entities
           (id, tenant_id, workspace_id, agency_client_id, connection_id,
            provider, entity_level, external_id, parent_external_id,
            campaign_external_id, name, first_seen_at, last_seen_at)
         SELECT gen_random_uuid(), $1, $2, NULL, $3, 'meta_ads', level.name,
                level.name || '_' || i,
                CASE level.name
                  WHEN 'ad' THEN 'adset_' || i
                  WHEN 'adset' THEN 'campaign_' || i
                  ELSE NULL
                END,
                'campaign_' || i, 'Bulk ' || i, now(), now()
         FROM generate_series(1, 4000) AS i,
              (VALUES ('ad'), ('adset'), ('campaign')) AS level(name)`,
        [tenantId, workspaceId, bulkConnection],
      );

      await AgencyDataSource.query('ANALYZE social_ad_entities');

      const plan = await AgencyDataSource.query<
        Array<{ 'QUERY PLAN': unknown }>
      >(
        `EXPLAIN (ANALYZE, FORMAT JSON)
         SELECT ad.external_id, adset.external_id
         FROM social_ad_entities ad
         LEFT JOIN social_ad_entities adset
           ON adset.tenant_id = ad.tenant_id
          AND adset.workspace_id = ad.workspace_id
          AND adset.connection_id = ad.connection_id
          AND adset.entity_level = 'adset'
          AND adset.external_id = ad.parent_external_id
         WHERE ad.tenant_id = $1
           AND ad.workspace_id = $2
           AND ad.agency_client_id IS NOT DISTINCT FROM NULL
           AND ad.external_id = 'ad_2000'
           AND ad.entity_level = 'ad'
           AND ad.provider = 'meta_ads'`,
        [tenantId, workspaceId],
      );

      const root = (
        plan[0]['QUERY PLAN'] as Array<{ 'Execution Time': number }>
      )[0];

      // With 12,000 rows in the mirror the planner uses an index for both
      // sides. Asserting the *time* rather than the node type keeps this a
      // test of the query's cost rather than of the planner's current choice.
      expect(root['Execution Time']).toBeLessThan(50);

      // And the whole bridge, end to end, over the same populated table.
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad_2000' });

      const started = Date.now();
      const view = await attribution(conversationId);
      const elapsed = Date.now() - started;

      expect(view?.matchStatus).toBe('matched');
      expect(elapsed).toBeLessThan(500);
    });

    /**
     * The destination lookup against a long transition history (I4.1 §16).
     *
     * The shape that could degrade is the LATERAL probe: one per attribution
     * instant, each scanning an ad set's observations backwards. This builds
     * 500 transitions on one ad set and asks about several instants at once.
     *
     * No index is created: `IDX_social_ad_destination_obs_entity` is
     * (ad_entity_id, observed_at), which is exactly the probe's predicate and
     * ordering.
     */
    it('resolves destinations over a long transition history', async () => {
      const tree = await createAdTree({
        connection: connectionId,
        adId: 'ad-perf-dest',
        suffix: 'perf-dest',
      });
      const rows = await AgencyDataSource.query<Array<{ id: string }>>(
        `SELECT id::text AS id FROM social_ad_entities
          WHERE tenant_id = $1 AND connection_id = $2
            AND entity_level = 'adset' AND external_id = $3`,
        [tenantId, connectionId, tree.adsetId],
      );
      const adset = rows[0].id;

      // 500 alternating transitions across a year.
      await AgencyDataSource.query(
        `INSERT INTO social_ad_destination_observations
           (id, tenant_id, workspace_id, agency_client_id, connection_id,
            ad_entity_id, provider, destination_type, destination_raw,
            observed_at, created_at)
         SELECT gen_random_uuid(), $1, $2, NULL, $3, $4, 'meta_ads',
                CASE WHEN i % 2 = 0 THEN 'whatsapp' ELSE 'instagram_direct' END,
                CASE WHEN i % 2 = 0 THEN 'WHATSAPP' ELSE 'INSTAGRAM_DIRECT' END,
                TIMESTAMPTZ '2026-01-01T00:00:00Z' + (i || ' hours')::interval,
                now()
         FROM generate_series(1, 500) AS i`,
        [tenantId, workspaceId, connectionId, adset],
      );

      await AgencyDataSource.query(
        'ANALYZE social_ad_destination_observations',
      );

      const plan = await AgencyDataSource.query<
        Array<{ 'QUERY PLAN': unknown }>
      >(
        `EXPLAIN (ANALYZE, FORMAT JSON)
         SELECT asked.ordinal, resolved.destination_type, resolved.observed_at
         FROM unnest($3::timestamptz[]) WITH ORDINALITY AS asked(instant, ordinal)
         JOIN LATERAL (
           SELECT observation.destination_type, observation.observed_at
           FROM social_ad_destination_observations observation
           WHERE observation.tenant_id = $1
             AND observation.ad_entity_id = $2
             AND observation.observed_at <= asked.instant
           ORDER BY observation.observed_at DESC, observation.created_at DESC
           LIMIT 1
         ) resolved ON TRUE`,
        [
          tenantId,
          adset,
          [
            '2026-01-05T00:00:00Z',
            '2026-01-10T00:00:00Z',
            '2026-01-15T00:00:00Z',
          ],
        ],
      );

      const root = (
        plan[0]['QUERY PLAN'] as Array<{
          'Execution Time': number;
          Plan: unknown;
        }>
      )[0];

      expect(root['Execution Time']).toBeLessThan(50);
      // The probe reaches the observations by index, not by scanning 500 rows
      // three times.
      expect(JSON.stringify(root.Plan)).toContain(
        'IDX_social_ad_destination_obs_entity',
      );

      // And end to end, with three attribution instants over that history.
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });
      for (const at of [
        '2026-01-05T00:00:00Z',
        '2026-01-10T00:00:00Z',
        '2026-01-15T00:00:00Z',
      ]) {
        await observe({
          conversationId,
          adId: 'ad-perf-dest',
          observedAt: at,
        });
      }

      const started = Date.now();
      const view = await attribution(conversationId);
      const elapsed = Date.now() - started;

      expect(view?.matchStatus).toBe('matched');
      expect(view?.paidMedia?.destination?.readings).toHaveLength(3);
      expect(elapsed).toBeLessThan(500);
    });
  });
});
