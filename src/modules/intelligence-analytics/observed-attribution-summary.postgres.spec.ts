import { randomUUID } from 'crypto';
import { requireIntelligenceScope } from '../../common/intelligence';
import { AgencyDataSource } from '../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { LeadFlowAttributionCohortAdapter } from '../leadflow-analytics/intelligence/leadflow-attribution-cohort.adapter';
import { SocialAdEntity } from '../social-integrations/entities/social-ad-entity.entity';
import { SocialAdHierarchyLookupReadService } from '../social-integrations/services/social-ad-hierarchy-lookup.read.service';
import type { ObservedAttributionGroupBy } from './observed-attribution-summary.contract';
import { ObservedAttributionSummaryService } from './observed-attribution-summary.service';

const run = describePostgresIntegration();

/**
 * The aggregate over real rows.
 *
 * The unit spec proves the folding logic against mocks. This proves what mocks
 * structurally cannot: that the cohort selection actually isolates when another
 * tenant's identical ad id sits in the same table, that the entry rule places a
 * conversation by its first ad-carrying observation, and that outcomes really
 * are followed past the window rather than clipped by a predicate nobody
 * noticed.
 */
run('Observed attribution summary against PostgreSQL', () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();

  const connectionId = randomUUID();
  const otherConnectionId = randomUUID();

  let service: ObservedAttributionSummaryService;
  let cohort: LeadFlowAttributionCohortAdapter;
  let hierarchy: SocialAdHierarchyLookupReadService;

  const tables = [
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

    cohort = new LeadFlowAttributionCohortAdapter(AgencyDataSource);
    hierarchy = new SocialAdHierarchyLookupReadService(
      AgencyDataSource.getRepository(SocialAdEntity),
    );

    /**
     * The connection reader is stubbed to a fixed timezone.
     *
     * It is the one dependency that reads a table this spec does not exercise,
     * and pinning it keeps every window assertion below deterministic instead of
     * depending on what a fixture happened to store.
     */
    const socialReads = {
      listConnections: jest.fn().mockResolvedValue([
        { id: connectionId, timezone: 'America/Sao_Paulo' },
        { id: otherConnectionId, timezone: 'America/Sao_Paulo' },
      ]),
    };

    service = new ObservedAttributionSummaryService(
      cohort,
      hierarchy,
      socialReads as never,
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
        workspaceId,
        options.client ?? null,
        `act_${options.id.slice(0, 8)}`,
      ],
    );
  };

  const createAdTree = async (options: {
    connection: string;
    adId: string;
    tenant?: string;
    client?: string | null;
    suffix?: string;
  }) => {
    const tenant = options.tenant ?? tenantId;
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
          workspaceId,
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
    await insert(
      'campaign',
      campaignId,
      accountId,
      campaignId,
      `Camp ${suffix}`,
    );
    await insert('adset', adsetId, campaignId, campaignId, `Conj ${suffix}`);
    await insert('ad', options.adId, adsetId, campaignId, `Anúncio ${suffix}`);

    return { accountId, campaignId, adsetId };
  };

  const createChannel = async (options: {
    tenant?: string;
    client?: string | null;
    type?: string;
    provider?: string;
  }) => {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_channels
         (id, tenant_id, workspace_id, name, type, provider, status,
          connection_status, lifecycle_version, credential_version,
          ai_enabled, settings, metadata)
       VALUES ($1, $2, $3, 'Canal', $5, $6, 'active', 'connected', 1, 1,
               false, '{}'::jsonb, $4::jsonb)`,
      [
        id,
        options.tenant ?? tenantId,
        workspaceId,
        JSON.stringify(options.client ? { clientId: options.client } : {}),
        options.type ?? 'whatsapp',
        options.provider ?? 'meta',
      ],
    );
    return id;
  };

  const createConversation = async (options: {
    channelId: string | null;
    tenant?: string;
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
        workspaceId,
        options.channelId,
        options.createdAt ?? '2026-09-05T10:00:00Z',
      ],
    );
    return id;
  };

  const observe = async (options: {
    conversationId: string;
    adId?: string | null;
    clickId?: string | null;
    observedAt?: string;
    provider?: string;
    channelType?: string;
    channelId?: string | null;
    tenant?: string;
    client?: string | null;
  }) => {
    const tenant = options.tenant ?? tenantId;
    const messageId = randomUUID();
    const observedAt = options.observedAt ?? '2026-09-05T10:00:00Z';

    await AgencyDataSource.query(
      `INSERT INTO inbox_messages
         (id, tenant_id, workspace_id, conversation_id, direction, sender_type,
          message_type, content, status, attachments, metadata, occurred_at)
       VALUES ($1, $2, $3, $4, 'inbound', 'contact', 'text', 'oi', 'delivered',
               '[]'::jsonb, '{}'::jsonb, $5::timestamptz)`,
      [messageId, tenant, workspaceId, options.conversationId, observedAt],
    );

    await AgencyDataSource.query(
      `INSERT INTO inbox_attribution_observations
         (id, tenant_id, workspace_id, agency_client_id, conversation_id,
          message_id, channel_id, provider, channel_type, ad_id, click_id,
          source_type, observed_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, 'ad',
               $12::timestamptz)`,
      [
        randomUUID(),
        tenant,
        workspaceId,
        options.client ?? null,
        options.conversationId,
        messageId,
        options.channelId ?? null,
        options.provider ?? 'meta',
        options.channelType ?? 'whatsapp',
        options.adId === undefined ? 'ad-1' : options.adId,
        options.clickId === undefined ? 'clid-1' : options.clickId,
        observedAt,
      ],
    );
  };

  const qualify = async (options: {
    conversationId: string;
    occurredAt: string;
    tenant?: string;
  }) => {
    await AgencyDataSource.query(
      `INSERT INTO inbox_conversation_events
         (id, tenant_id, workspace_id, conversation_id, event_type, payload,
          created_at)
       VALUES ($1, $2, $3, $4, 'qualification_status_changed', $5::jsonb, now())`,
      [
        randomUUID(),
        options.tenant ?? tenantId,
        workspaceId,
        options.conversationId,
        JSON.stringify({
          newStatus: 'qualified',
          occurredAt: options.occurredAt,
        }),
      ],
    );
  };

  const createPipeline = async (tenant = tenantId) => {
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO crm_pipelines (id, tenant_id, workspace_id, name, metadata)
       VALUES ($1, $2, $3, 'Pipeline', '{}'::jsonb)`,
      [pipelineId, tenant, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO crm_stages
         (id, tenant_id, workspace_id, pipeline_id, name, sort_order, metadata)
       VALUES ($1, $2, $3, $4, 'Novo', 1, '{}'::jsonb)`,
      [stageId, tenant, workspaceId, pipelineId],
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
    createdAt?: string;
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
               $11, $12::timestamptz, now())`,
      [
        id,
        options.tenant ?? tenantId,
        workspaceId,
        options.pipelineId,
        options.stageId,
        options.status ?? 'open',
        options.currency ?? 'BRL',
        options.value ?? null,
        options.wonAt ?? null,
        JSON.stringify(options.client ? { clientId: options.client } : {}),
        options.conversationId,
        options.createdAt ?? '2026-09-05T12:00:00Z',
      ],
    );
    return id;
  };

  const summary = (
    options: {
      groupBy?: ObservedAttributionGroupBy;
      from?: string;
      until?: string;
      client?: string | null;
      connection?: string;
    } = {},
  ) =>
    service.summary(
      requireIntelligenceScope({
        tenantId,
        workspaceId,
        agencyClientId: options.client ?? null,
      }),
      {
        since: options.from ?? '2026-09-01',
        until: options.until ?? '2026-09-30',
      },
      options.connection ?? connectionId,
      options.groupBy ?? 'ad',
    );

  // ------------------------------------------------------------------- tests

  describe('the cohort', () => {
    let channelId: string;

    beforeAll(async () => {
      await createConnection({ id: connectionId });
      await createAdTree({ connection: connectionId, adId: 'ad-cohort' });
      channelId = await createChannel({});
    });

    afterAll(async () => {
      await AgencyDataSource.query(
        `DELETE FROM inbox_attribution_observations WHERE tenant_id = $1`,
        [tenantId],
      );
      await AgencyDataSource.query(
        `DELETE FROM inbox_messages WHERE tenant_id = $1`,
        [tenantId],
      );
      await AgencyDataSource.query(
        `DELETE FROM inbox_conversations WHERE tenant_id = $1`,
        [tenantId],
      );
    });

    it('aggregates a conversation whose ad resolves', async () => {
      const conversationId = await createConversation({ channelId });
      await observe({
        conversationId,
        adId: 'ad-cohort',
        channelId,
        observedAt: '2026-09-05T10:00:00Z',
      });

      const view = await summary();

      expect(view.groups).toHaveLength(1);
      expect(view.groups[0].key).toBe('ad-cohort');
      expect(view.groups[0].attributedConversations).toBe(1);
      expect(view.coverage.matchedConversations).toBe(1);
    });

    /**
     * §3 over real rows: three observations of one ad, still one conversation.
     */
    it('counts repeated observations of one ad once', async () => {
      const before = await summary();
      const group0 = before.groups.find((g) => g.key === 'ad-cohort');

      const conversationId = await createConversation({ channelId });

      for (const at of [
        '2026-09-06T10:00:00Z',
        '2026-09-07T10:00:00Z',
        '2026-09-08T10:00:00Z',
      ]) {
        await observe({
          conversationId,
          adId: 'ad-cohort',
          channelId,
          observedAt: at,
        });
      }

      const view = await summary();
      const group = view.groups.find((g) => g.key === 'ad-cohort');

      // One conversation added, three observations added. The gap between the
      // two deltas is the whole point of §3.
      expect(group?.attributedConversations).toBe(
        (group0?.attributedConversations ?? 0) + 1,
      );
      expect(group?.observationsCount).toBe(
        (group0?.observationsCount ?? 0) + 3,
      );
    });

    /**
     * The entry rule: a conversation is placed by its *first* ad-carrying
     * observation, even when a later one falls inside the window and the first
     * does not.
     */
    it('places a conversation by its first ad observation', async () => {
      // Measured as a delta so the conversations left behind by the tests above
      // cannot be mistaken for this one.
      const before = await summary();
      const septemberBefore = before.coverage.matchedConversations;

      const conversationId = await createConversation({
        channelId,
        createdAt: '2026-08-01T10:00:00Z',
      });

      await observe({
        conversationId,
        adId: 'ad-cohort',
        channelId,
        observedAt: '2026-08-15T10:00:00Z',
      });
      await observe({
        conversationId,
        adId: 'ad-cohort',
        channelId,
        observedAt: '2026-09-15T10:00:00Z',
      });

      const september = await summary();
      const august = await summary({
        from: '2026-08-01',
        until: '2026-08-31',
      });

      // Belongs to August, where it first clicked — and to August only. A
      // selection that filtered observations before grouping would place this
      // same conversation in both windows and double it in any comparison.
      expect(august.coverage.matchedConversations).toBe(1);
      expect(september.coverage.matchedConversations).toBe(septemberBefore);
    });

    /**
     * An observation carrying only a click id does not enter the cohort, and —
     * the part that matters — does not date a conversation that later carries
     * a real ad.
     */
    it('ignores click-id-only observations when dating entry', async () => {
      const before = await summary();
      const augustBefore = (
        await summary({ from: '2026-08-01', until: '2026-08-31' })
      ).coverage.matchedConversations;

      const conversationId = await createConversation({ channelId });

      await observe({
        conversationId,
        adId: null,
        clickId: 'clid-only',
        channelId,
        observedAt: '2026-08-20T10:00:00Z',
      });
      await observe({
        conversationId,
        adId: 'ad-cohort',
        channelId,
        observedAt: '2026-09-20T10:00:00Z',
      });

      const august = await summary({ from: '2026-08-01', until: '2026-08-31' });
      const september = await summary();

      // The click-id observation does not date the conversation: entry is
      // September, when the ad was actually observed.
      expect(august.coverage.matchedConversations).toBe(augustBefore);
      expect(september.coverage.matchedConversations).toBe(
        before.coverage.matchedConversations + 1,
      );
    });
  });

  describe('exclusions', () => {
    let channelId: string;

    beforeAll(async () => {
      await createAdTree({ connection: connectionId, adId: 'ad-a' });
      await createAdTree({ connection: connectionId, adId: 'ad-b' });
      channelId = await createChannel({});
    });

    afterAll(async () => {
      await AgencyDataSource.query(
        `DELETE FROM inbox_attribution_observations WHERE tenant_id = $1`,
        [tenantId],
      );
      await AgencyDataSource.query(
        `DELETE FROM inbox_messages WHERE tenant_id = $1`,
        [tenantId],
      );
      await AgencyDataSource.query(
        `DELETE FROM inbox_conversations WHERE tenant_id = $1`,
        [tenantId],
      );
    });

    it('keeps a conflicting conversation out of both ads', async () => {
      const conversationId = await createConversation({ channelId });

      await observe({ conversationId, adId: 'ad-a', channelId });
      await observe({
        conversationId,
        adId: 'ad-b',
        channelId,
        observedAt: '2026-09-06T10:00:00Z',
      });

      const view = await summary();

      expect(view.groups).toHaveLength(0);
      expect(view.coverage.conflictingConversations).toBe(1);
      expect(view.coverage.matchedConversations).toBe(0);
    });

    it('reports an ad missing from the mirror as unresolved', async () => {
      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-ghost', channelId });

      const view = await summary();

      expect(view.groups).toHaveLength(0);
      expect(view.coverage.unresolvedConversations).toBe(1);
    });

    /**
     * An ad belonging to another connection is unresolved rather than matched,
     * even though the id exists in the same table — which is what makes the
     * connection filter load-bearing rather than decorative.
     */
    it('does not resolve an ad from another connection', async () => {
      await createConnection({ id: otherConnectionId });
      await createAdTree({
        connection: otherConnectionId,
        adId: 'ad-other-conn',
        suffix: 'otherconn',
      });

      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-other-conn', channelId });

      const view = await summary({ connection: connectionId });

      expect(view.coverage.unresolvedConversations).toBeGreaterThanOrEqual(1);
      expect(view.groups.some((g) => g.key === 'ad-other-conn')).toBe(false);
    });
  });

  describe('isolation', () => {
    beforeAll(async () => {
      // A clean slate, so the counts below are this block's alone.
      await reset();
      await createConnection({ id: connectionId });
    });

    /**
     * The same external ad id in two tenants.
     *
     * The failure this guards is the one that matters most in a multi-tenant
     * report: another agency's conversations counted under this agency's ad.
     */
    it('never counts another tenant with the same ad id', async () => {
      await createAdTree({ connection: connectionId, adId: 'ad-shared' });

      const mine = await createChannel({});
      const myConversation = await createConversation({ channelId: mine });
      await observe({
        conversationId: myConversation,
        adId: 'ad-shared',
        channelId: mine,
      });

      // The same ad id, another tenant, its own connection and channel.
      const theirConnection = randomUUID();
      await createConnection({ id: theirConnection, tenant: otherTenantId });
      await createAdTree({
        connection: theirConnection,
        adId: 'ad-shared',
        tenant: otherTenantId,
        suffix: 'shared-other',
      });
      const theirs = await createChannel({ tenant: otherTenantId });
      const theirConversation = await createConversation({
        channelId: theirs,
        tenant: otherTenantId,
      });
      await observe({
        conversationId: theirConversation,
        adId: 'ad-shared',
        channelId: theirs,
        tenant: otherTenantId,
      });

      const view = await summary();

      expect(view.coverage.matchedConversations).toBe(1);
      expect(
        view.groups.find((g) => g.key === 'ad-shared')?.attributedConversations,
      ).toBe(1);
    });

    /**
     * Two managed clients in one tenant, same ad id.
     *
     * The client predicate is JSONB on the channel, so this is the case a
     * column-based scope check would miss entirely.
     */
    it('separates two managed clients sharing an ad id', async () => {
      const connA = randomUUID();
      const connB = randomUUID();
      await createConnection({ id: connA, client: clientId });
      await createConnection({ id: connB, client: otherClientId });

      await createAdTree({
        connection: connA,
        adId: 'ad-client',
        client: clientId,
        suffix: 'client-a',
      });
      await createAdTree({
        connection: connB,
        adId: 'ad-client',
        client: otherClientId,
        suffix: 'client-b',
      });

      const channelA = await createChannel({ client: clientId });
      const channelB = await createChannel({ client: otherClientId });

      const convA = await createConversation({ channelId: channelA });
      await observe({
        conversationId: convA,
        adId: 'ad-client',
        channelId: channelA,
        client: clientId,
      });

      const convB1 = await createConversation({ channelId: channelB });
      const convB2 = await createConversation({ channelId: channelB });
      for (const conversationId of [convB1, convB2]) {
        await observe({
          conversationId,
          adId: 'ad-client',
          channelId: channelB,
          client: otherClientId,
        });
      }

      const viewA = await service.summary(
        requireIntelligenceScope({
          tenantId,
          workspaceId,
          agencyClientId: clientId,
        }),
        { since: '2026-09-01', until: '2026-09-30' },
        connA,
        'ad',
      );

      const viewB = await service.summary(
        requireIntelligenceScope({
          tenantId,
          workspaceId,
          agencyClientId: otherClientId,
        }),
        { since: '2026-09-01', until: '2026-09-30' },
        connB,
        'ad',
      );

      expect(viewA.coverage.matchedConversations).toBe(1);
      expect(viewB.coverage.matchedConversations).toBe(2);
    });
  });

  describe('the funnel', () => {
    let channelId: string;
    let pipeline: { pipelineId: string; stageId: string };

    beforeAll(async () => {
      await createAdTree({ connection: connectionId, adId: 'ad-funnel' });
      channelId = await createChannel({});
      pipeline = await createPipeline();
    });

    afterAll(async () => {
      await AgencyDataSource.query(
        `DELETE FROM crm_opportunities WHERE tenant_id = $1`,
        [tenantId],
      );
      await AgencyDataSource.query(
        `DELETE FROM inbox_attribution_observations WHERE tenant_id = $1`,
        [tenantId],
      );
      await AgencyDataSource.query(
        `DELETE FROM inbox_conversation_events WHERE tenant_id = $1`,
        [tenantId],
      );
      await AgencyDataSource.query(
        `DELETE FROM inbox_messages WHERE tenant_id = $1`,
        [tenantId],
      );
      await AgencyDataSource.query(
        `DELETE FROM inbox_conversations WHERE tenant_id = $1`,
        [tenantId],
      );
    });

    it('counts a qualification recorded in the event log', async () => {
      const conversationId = await createConversation({ channelId });
      await observe({ conversationId, adId: 'ad-funnel', channelId });
      await qualify({ conversationId, occurredAt: '2026-09-06T10:00:00Z' });

      const view = await summary();

      expect(
        view.groups.find((g) => g.key === 'ad-funnel')?.qualifiedConversations,
      ).toBe(1);
    });

    /**
     * §20: a conversation qualified twice counts once.
     *
     * The append-only log holds both transitions; only the first is the
     * conversation's qualification instant.
     */
    it('does not double count a requalification', async () => {
      const conversationId = await createConversation({ channelId });
      await observe({
        conversationId,
        adId: 'ad-funnel',
        channelId,
        observedAt: '2026-09-09T10:00:00Z',
      });
      await qualify({ conversationId, occurredAt: '2026-09-10T10:00:00Z' });
      await qualify({ conversationId, occurredAt: '2026-09-11T10:00:00Z' });

      const view = await summary();

      // Two conversations qualified across this block, never three.
      expect(
        view.groups.find((g) => g.key === 'ad-funnel')?.qualifiedConversations,
      ).toBe(2);
    });

    /**
     * §10, the defining property of an entry cohort: an outcome after `until`
     * still belongs to the conversation that entered before it.
     */
    it('follows an opportunity created after the window', async () => {
      const conversationId = await createConversation({ channelId });
      await observe({
        conversationId,
        adId: 'ad-funnel',
        channelId,
        observedAt: '2026-09-28T10:00:00Z',
      });

      await createOpportunity({
        ...pipeline,
        conversationId,
        status: 'won',
        wonAt: '2026-11-20T10:00:00Z',
        value: '2500.00',
        // Created two months after the cohort window closed.
        createdAt: '2026-11-15T10:00:00Z',
      });

      const view = await summary();
      const group = view.groups.find((g) => g.key === 'ad-funnel');

      expect(group?.opportunities).toBe(1);
      expect(group?.wonOpportunities).toBe(1);
      expect(group?.wonOpportunityValue).toBe('2500.00');
    });

    /**
     * §12: only the explicit link counts.
     *
     * An opportunity with no `inbox_conversation_id` is invisible here however
     * plausibly it lines up in time.
     */
    it('ignores an opportunity with no conversation link', async () => {
      const before = await summary();
      const beforeCount =
        before.groups.find((g) => g.key === 'ad-funnel')?.opportunities ?? 0;

      await createOpportunity({
        ...pipeline,
        conversationId: null,
        status: 'won',
        wonAt: '2026-09-10T10:00:00Z',
        value: '9999.00',
      });

      const after = await summary();

      expect(
        after.groups.find((g) => g.key === 'ad-funnel')?.opportunities,
      ).toBe(beforeCount);
    });

    /** A `won` status with no `won_at` is an inconsistent write, not a win. */
    it('does not count a won status without a timestamp', async () => {
      const conversationId = await createConversation({ channelId });
      await observe({
        conversationId,
        adId: 'ad-funnel',
        channelId,
        observedAt: '2026-09-29T10:00:00Z',
      });

      await createOpportunity({
        ...pipeline,
        conversationId,
        status: 'won',
        wonAt: null,
        value: '500.00',
      });

      const view = await summary();
      const group = view.groups.find((g) => g.key === 'ad-funnel');

      // Counted as an opportunity, never as a win.
      expect(group?.opportunities).toBe(2);
      expect(group?.wonOpportunities).toBe(1);
    });
  });

  describe('grouping levels', () => {
    let channelId: string;
    let tree: { accountId: string; campaignId: string; adsetId: string };

    beforeAll(async () => {
      await reset();
      await createConnection({ id: connectionId });
      tree = await createAdTree({ connection: connectionId, adId: 'ad-lvl-1' });

      // A second ad under the SAME ad set, so the levels genuinely differ.
      await AgencyDataSource.query(
        `INSERT INTO social_ad_entities
           (id, tenant_id, workspace_id, agency_client_id, connection_id,
            provider, entity_level, external_id, parent_external_id,
            campaign_external_id, name, first_seen_at, last_seen_at)
         VALUES ($1, $2, $3, NULL, $4, 'meta_ads', 'ad', 'ad-lvl-2', $5, $6,
                 'Anúncio 2', now(), now())`,
        [
          randomUUID(),
          tenantId,
          workspaceId,
          connectionId,
          tree.adsetId,
          tree.campaignId,
        ],
      );

      channelId = await createChannel({});

      for (const adId of ['ad-lvl-1', 'ad-lvl-2']) {
        const conversationId = await createConversation({ channelId });
        await observe({ conversationId, adId, channelId });
      }
    });

    it('splits two ads at ad level', async () => {
      const view = await summary({ groupBy: 'ad' });

      expect(view.groups).toHaveLength(2);
      expect(view.groups.map((g) => g.key).sort()).toEqual([
        'ad-lvl-1',
        'ad-lvl-2',
      ]);
    });

    it.each(['adset', 'campaign', 'account'] as const)(
      'collapses them at %s level',
      async (groupBy) => {
        const view = await summary({ groupBy });

        expect(view.groups).toHaveLength(1);
        expect(view.groups[0].level).toBe(groupBy);
        expect(view.groups[0].attributedConversations).toBe(2);
      },
    );

    it('names the group from the mirror', async () => {
      const view = await summary({ groupBy: 'campaign' });

      expect(view.groups[0].key).toBe(tree.campaignId);
      expect(view.groups[0].name).toBe('Camp ad-lvl-1');
    });
  });

  describe('coverage', () => {
    beforeAll(async () => {
      await reset();
      await createConnection({ id: connectionId });
      await createAdTree({ connection: connectionId, adId: 'ad-cov' });
    });

    /**
     * §16 over real rows: an Instagram conversation is unsupported, never a
     * failed attribution.
     *
     * Were it counted in the denominator this would report 50% coverage for an
     * account that attributed every conversation capable of being attributed.
     */
    it('excludes unsupported channels from the denominator', async () => {
      const whatsapp = await createChannel({ type: 'whatsapp' });
      const instagram = await createChannel({ type: 'instagram' });

      const attributed = await createConversation({ channelId: whatsapp });
      await observe({
        conversationId: attributed,
        adId: 'ad-cov',
        channelId: whatsapp,
      });

      // An Instagram conversation with no observation — it cannot have one.
      await createConversation({ channelId: instagram });

      const view = await summary();

      expect(view.coverage.eligibleConversations).toBe(1);
      expect(view.coverage.unsupportedConversations).toBe(1);
      expect(view.coverage.observedCoverage).toBe(1);
    });

    /**
     * §17: an eligible conversation with no observation lowers coverage but is
     * never labelled organic — it simply appears in no group.
     */
    it('counts an unobserved WhatsApp conversation in the denominator only', async () => {
      const whatsapp = await createChannel({ type: 'whatsapp' });
      await createConversation({ channelId: whatsapp });

      const view = await summary();

      expect(view.coverage.eligibleConversations).toBe(2);
      expect(view.coverage.matchedConversations).toBe(1);
      expect(view.coverage.observedCoverage).toBe(0.5);
    });

    it('returns a null coverage when nothing was eligible', async () => {
      const view = await summary({ from: '2026-01-01', until: '2026-01-31' });

      expect(view.coverage.eligibleConversations).toBe(0);
      expect(view.coverage.observedCoverage).toBeNull();
      expect(view.groups).toEqual([]);
    });
  });

  describe('performance', () => {
    /**
     * The plan for the cohort selection, on a table with enough rows for the
     * planner to have a real choice.
     *
     * The assertion is on execution time rather than on the node type: at this
     * size a sequential scan can legitimately win, and asserting the index is
     * used would be testing the planner rather than the query.
     */
    it('selects the cohort in reasonable time at scale', async () => {
      await reset();
      await createConnection({ id: connectionId });
      await createAdTree({ connection: connectionId, adId: 'ad-perf' });

      const channelId = await createChannel({});

      // 4,000 conversations, each with one observation.
      await AgencyDataSource.query(
        `INSERT INTO inbox_conversations
           (id, tenant_id, workspace_id, channel_id, status, priority, source,
            business_mode, unread_count, ai_enabled, metadata, created_at,
            updated_at, ownership_state, ownership_version,
            ownership_changed_at, qualification_status)
         SELECT gen_random_uuid(), $1, $2, $3, 'new', 'normal', 'inbound',
                'general', 0, false, '{}'::jsonb,
                '2026-09-01T00:00:00Z'::timestamptz + (n || ' minutes')::interval,
                now(), 'paused', 1, now(), 'pending'
         FROM generate_series(1, 4000) n`,
        [tenantId, workspaceId, channelId],
      );

      await AgencyDataSource.query(
        `INSERT INTO inbox_messages
           (id, tenant_id, workspace_id, conversation_id, direction, sender_type,
            message_type, content, status, attachments, metadata, occurred_at)
         SELECT gen_random_uuid(), $1, $2, c.id, 'inbound', 'contact', 'text',
                'oi', 'delivered', '[]'::jsonb, '{}'::jsonb, c.created_at
         FROM inbox_conversations c
         WHERE c.tenant_id = $1`,
        [tenantId, workspaceId],
      );

      await AgencyDataSource.query(
        `INSERT INTO inbox_attribution_observations
           (id, tenant_id, workspace_id, agency_client_id, conversation_id,
            message_id, channel_id, provider, channel_type, ad_id, click_id,
            source_type, observed_at)
         SELECT gen_random_uuid(), $1, $2, NULL, m.conversation_id, m.id, $3,
                'meta', 'whatsapp', 'ad-perf', NULL, 'ad', m.occurred_at
         FROM inbox_messages m
         WHERE m.tenant_id = $1`,
        [tenantId, workspaceId, channelId],
      );

      await AgencyDataSource.query('ANALYZE inbox_attribution_observations');
      await AgencyDataSource.query('ANALYZE inbox_conversations');

      // Asserted against what was actually inserted rather than the literal
      // 4,000: the generated instants run past the end of the window, and the
      // cohort correctly excludes the overflow. The point of the test is the
      // plan, not the fixture's arithmetic.
      const [{ count }] = await AgencyDataSource.query<
        Array<{ count: string }>
      >(
        `SELECT count(DISTINCT conversation_id)::text AS count
         FROM inbox_attribution_observations
         WHERE tenant_id = $1
           AND observed_at >= '2026-09-01T03:00:00Z'::timestamptz
           AND observed_at <  '2026-10-01T03:00:00Z'::timestamptz`,
        [tenantId],
      );

      const expected = Number(count);

      const started = Date.now();
      const view = await summary();
      const elapsed = Date.now() - started;

      expect(expected).toBeGreaterThan(3000);
      expect(view.coverage.matchedConversations).toBe(expected);
      expect(view.groups[0].attributedConversations).toBe(expected);
      // Generous, because CI machines vary. It fails loudly on an accidental
      // per-conversation query, which is the regression worth catching.
      expect(elapsed).toBeLessThan(5000);
    }, 120_000);
  });
});
