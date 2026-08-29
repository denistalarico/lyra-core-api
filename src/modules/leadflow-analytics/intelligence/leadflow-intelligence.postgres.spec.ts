import { randomUUID } from 'crypto';
import {
  requireIntelligenceScope,
  type IntelligenceFactSet,
  type IntelligenceGrain,
} from '../../../common/intelligence';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import {
  LEADFLOW_SCOPE_SQL,
  leadFlowScopeParameters,
} from '../scope/leadflow-analytics-scope.sql';
import { LeadFlowIntelligenceAdapter } from './leadflow-intelligence.adapter';

const run = describePostgresIntegration();

/**
 * The LeadFlow adapter against a real database.
 *
 * A mocked repository could not answer either question this suite exists for.
 * The first is whether the counts are *right* — they are produced by SQL, so
 * asserting them against a mock would assert the mock. The second is whether
 * scope holds: the client binding is a JSONB predicate copied from the
 * operational analytics service, and the only way to know it isolates is to put
 * two clients' rows in one table and ask for one of them.
 */
run('LeadFlow intelligence adapter', () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();

  const adapter = new LeadFlowIntelligenceAdapter(AgencyDataSource);

  const tables = [
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

  // Connect before cleaning: `beforeAll` hooks run in declaration order, and a
  // reset against an uninitialised data source fails on every test in the file
  // with an error that points at the fixture helper rather than at the ordering.
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    await reset();
  });

  afterEach(reset);

  afterAll(async () => {
    await reset();
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  // ---------------------------------------------------------------- fixtures

  const createChannel = async (options: {
    tenant?: string;
    workspace?: string;
    client?: string | null;
    operatingMode?: string;
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
        JSON.stringify({
          ...(options.client ? { clientId: options.client } : {}),
          ...(options.operatingMode
            ? { operatingMode: options.operatingMode }
            : {}),
        }),
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

  const createInboundMessage = async (options: {
    conversationId: string;
    occurredAt: string;
    tenant?: string;
    workspace?: string;
    direction?: string;
  }) => {
    await AgencyDataSource.query(
      `INSERT INTO inbox_messages
         (id, tenant_id, workspace_id, conversation_id, direction, message_type,
          content, status, sender_type, occurred_at, metadata)
       VALUES ($1, $2, $3, $4, $5, 'text', 'oi', 'delivered', 'contact',
               $6::timestamptz, '{}'::jsonb)`,
      [
        randomUUID(),
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        options.conversationId,
        options.direction ?? 'inbound',
        options.occurredAt,
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
    createdAt: string;
    client?: string | null;
    operatingMode?: string;
    status?: string;
    wonAt?: string | null;
    value?: string | null;
    currency?: string;
    tenant?: string;
    workspace?: string;
  }) => {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO crm_opportunities
         (id, tenant_id, workspace_id, pipeline_id, stage_id, title, status,
          priority, source, business_mode, business_context, currency,
          value_amount, won_at, visibility, metadata, created_at, updated_at)
       VALUES ($1, $2, $3, $4, $5, 'Deal', $6, 'normal', 'manual', 'general',
               '{}'::jsonb, $7, $8, $9::timestamptz, 'workspace', $10::jsonb,
               $11::timestamptz, $11::timestamptz)`,
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
        JSON.stringify({
          ...(options.client ? { clientId: options.client } : {}),
          ...(options.operatingMode
            ? { operatingMode: options.operatingMode }
            : {}),
        }),
        options.createdAt,
      ],
    );
    return id;
  };

  // ----------------------------------------------------------------- helpers

  const fetch = (
    overrides: {
      client?: string | null;
      grain?: IntelligenceGrain;
      since?: string;
      until?: string;
      tenant?: string;
      workspace?: string;
    } = {},
  ): Promise<IntelligenceFactSet> =>
    adapter.fetch({
      scope: requireIntelligenceScope({
        tenantId: overrides.tenant ?? tenantId,
        workspaceId: overrides.workspace ?? workspaceId,
        agencyClientId:
          overrides.client === undefined ? clientId : overrides.client,
      }),
      window: {
        since: overrides.since ?? '2026-08-01',
        until: overrides.until ?? '2026-08-31',
      },
      grain: overrides.grain ?? 'period',
    });

  const valueOf = (set: IntelligenceFactSet, key: string, date?: string) =>
    set.facts.find(
      (fact) =>
        fact.metricKey === key &&
        (date === undefined || fact.dimensions.date === date),
    )?.value;

  // ------------------------------------------------------------------- specs

  it('implements the same port as the paid media adapter', () => {
    expect(adapter.domain).toBe('conversation');
    expect(adapter.supportedGrains).toEqual(['day', 'period']);
    expect(typeof adapter.fetch).toBe('function');
    // No ratios: every tempting one is cross-cohort or cross-domain.
    expect(adapter.ratios).toEqual([]);
  });

  it('counts conversations started inside the window', async () => {
    const channelId = await createChannel({ client: clientId });
    await createConversation({ channelId, createdAt: '2026-08-10T12:00:00Z' });
    await createConversation({ channelId, createdAt: '2026-08-11T12:00:00Z' });
    // Outside the window.
    await createConversation({ channelId, createdAt: '2026-07-31T12:00:00Z' });

    expect(valueOf(await fetch(), 'conversations_started')).toBe('2');
  });

  it('counts only inbound messages', async () => {
    const channelId = await createChannel({ client: clientId });
    const conversationId = await createConversation({
      channelId,
      createdAt: '2026-08-10T12:00:00Z',
    });
    await createInboundMessage({
      conversationId,
      occurredAt: '2026-08-10T12:01:00Z',
    });
    await createInboundMessage({
      conversationId,
      occurredAt: '2026-08-10T12:02:00Z',
    });
    await createInboundMessage({
      conversationId,
      occurredAt: '2026-08-10T12:03:00Z',
      direction: 'outbound',
    });

    expect(valueOf(await fetch(), 'inbound_messages')).toBe('2');
  });

  it('counts opportunities created and won on their own cohorts', async () => {
    const { pipelineId, stageId } = await createPipeline();

    // Created in the window, still open.
    await createOpportunity({
      pipelineId,
      stageId,
      client: clientId,
      createdAt: '2026-08-05T12:00:00Z',
    });
    // Created before the window, won inside it — counts as won, not created.
    await createOpportunity({
      pipelineId,
      stageId,
      client: clientId,
      createdAt: '2026-07-01T12:00:00Z',
      status: 'won',
      wonAt: '2026-08-20T12:00:00Z',
      value: '1500.00',
    });

    const set = await fetch();

    expect(valueOf(set, 'opportunities_created')).toBe('1');
    expect(valueOf(set, 'opportunities_won')).toBe('1');
    expect(valueOf(set, 'won_value')).toBe('1500.00');
  });

  /**
   * The descriptor says these are different cohorts; this proves the SQL agrees.
   * A consumer dividing won by created would be comparing two populations.
   */
  it('does not count a deal won outside the window', async () => {
    const { pipelineId, stageId } = await createPipeline();
    await createOpportunity({
      pipelineId,
      stageId,
      client: clientId,
      createdAt: '2026-08-05T12:00:00Z',
      status: 'won',
      wonAt: '2026-09-15T12:00:00Z',
      value: '900.00',
    });

    const set = await fetch();

    expect(valueOf(set, 'opportunities_created')).toBe('1');
    expect(valueOf(set, 'opportunities_won')).toBe('0');
    expect(valueOf(set, 'won_value')).toBe('0.00');
  });

  /**
   * The distinction the mixed-currency rule must not swallow.
   *
   * No won deals means a currency set of size zero, which is one short of the
   * "several currencies" case — and reporting it the same way would say "we
   * cannot state this" about the most ordinary result there is.
   */
  it('reports zero won value as zero, not as unknown', async () => {
    const { pipelineId, stageId } = await createPipeline();
    await createOpportunity({
      pipelineId,
      stageId,
      client: clientId,
      createdAt: '2026-08-05T12:00:00Z',
    });

    const set = await fetch();

    expect(valueOf(set, 'opportunities_won')).toBe('0');
    expect(valueOf(set, 'won_value')).toBe('0.00');
    expect(valueOf(set, 'won_value')).not.toBeNull();
  });

  it('refuses to total won value across currencies', async () => {
    const { pipelineId, stageId } = await createPipeline();
    await createOpportunity({
      pipelineId,
      stageId,
      client: clientId,
      createdAt: '2026-08-01T12:00:00Z',
      status: 'won',
      wonAt: '2026-08-10T12:00:00Z',
      value: '1000.00',
      currency: 'BRL',
    });
    await createOpportunity({
      pipelineId,
      stageId,
      client: clientId,
      createdAt: '2026-08-01T12:00:00Z',
      status: 'won',
      wonAt: '2026-08-11T12:00:00Z',
      value: '500.00',
      currency: 'USD',
    });

    const set = await fetch();

    // The count is still right — a won deal is won in any currency.
    expect(valueOf(set, 'opportunities_won')).toBe('2');
    // The total is refused rather than adding unlike units.
    expect(set.currency).toBeNull();
    expect(valueOf(set, 'won_value')).toBeNull();
  });

  it('emits one fact per metric per day at day grain', async () => {
    const channelId = await createChannel({ client: clientId });
    await createConversation({ channelId, createdAt: '2026-08-01T12:00:00Z' });
    await createConversation({ channelId, createdAt: '2026-08-01T18:00:00Z' });
    await createConversation({ channelId, createdAt: '2026-08-03T12:00:00Z' });

    const set = await fetch({
      grain: 'day',
      since: '2026-08-01',
      until: '2026-08-03',
    });

    expect(set.facts).toHaveLength(15); // 5 metrics × 3 days
    expect(valueOf(set, 'conversations_started', '2026-08-01')).toBe('2');
    // A day with nothing is a genuine zero, not an absence — the source is
    // written live, so there is no "not yet synced" state to confuse it with.
    expect(valueOf(set, 'conversations_started', '2026-08-02')).toBe('0');
    expect(valueOf(set, 'conversations_started', '2026-08-03')).toBe('1');
  });

  it('day facts sum to the period fact', async () => {
    const channelId = await createChannel({ client: clientId });
    for (const day of ['2026-08-01', '2026-08-02', '2026-08-05']) {
      await createConversation({ channelId, createdAt: `${day}T12:00:00Z` });
    }

    const [day, period] = await Promise.all([
      fetch({ grain: 'day', since: '2026-08-01', until: '2026-08-05' }),
      fetch({ grain: 'period', since: '2026-08-01', until: '2026-08-05' }),
    ]);

    const summed = day.facts
      .filter((fact) => fact.metricKey === 'conversations_started')
      .reduce((total, fact) => total + Number(fact.value ?? 0), 0);

    expect(summed).toBe(3);
    expect(valueOf(period, 'conversations_started')).toBe('3');
  });

  // ------------------------------------------------------------ isolation

  it('does not return another tenant’s rows', async () => {
    const channelId = await createChannel({ client: clientId });
    await createConversation({ channelId, createdAt: '2026-08-10T12:00:00Z' });

    const foreignChannel = await createChannel({
      tenant: otherTenantId,
      client: clientId,
    });
    await createConversation({
      channelId: foreignChannel,
      createdAt: '2026-08-10T12:00:00Z',
      tenant: otherTenantId,
    });

    expect(valueOf(await fetch(), 'conversations_started')).toBe('1');
  });

  it('does not return another workspace’s rows', async () => {
    const channelId = await createChannel({ client: clientId });
    await createConversation({ channelId, createdAt: '2026-08-10T12:00:00Z' });

    const foreignChannel = await createChannel({
      workspace: otherWorkspaceId,
      client: clientId,
    });
    await createConversation({
      channelId: foreignChannel,
      createdAt: '2026-08-10T12:00:00Z',
      workspace: otherWorkspaceId,
    });

    expect(valueOf(await fetch(), 'conversations_started')).toBe('1');
  });

  /**
   * The predicate that matters most: two managed clients in one tenant and one
   * workspace, separated only by a JSONB key.
   */
  it('does not return another managed client’s rows', async () => {
    const mine = await createChannel({ client: clientId });
    const theirs = await createChannel({ client: otherClientId });
    await createConversation({
      channelId: mine,
      createdAt: '2026-08-10T12:00:00Z',
    });
    await createConversation({
      channelId: theirs,
      createdAt: '2026-08-10T12:00:00Z',
    });
    await createConversation({
      channelId: theirs,
      createdAt: '2026-08-11T12:00:00Z',
    });

    expect(
      valueOf(await fetch({ client: clientId }), 'conversations_started'),
    ).toBe('1');
    expect(
      valueOf(await fetch({ client: otherClientId }), 'conversations_started'),
    ).toBe('2');
  });

  it('serves the agency’s own context without reaching a client’s rows', async () => {
    const agencyChannel = await createChannel({ client: null });
    const clientChannel = await createChannel({ client: clientId });
    await createConversation({
      channelId: agencyChannel,
      createdAt: '2026-08-10T12:00:00Z',
    });
    await createConversation({
      channelId: clientChannel,
      createdAt: '2026-08-10T12:00:00Z',
    });

    expect(
      valueOf(await fetch({ client: null }), 'conversations_started'),
    ).toBe('1');
  });

  /**
   * The escape hatch the operational analytics service defines: a channel bound
   * to a client but explicitly operated by the agency counts as agency.
   */
  it('honours the operatingMode=agency escape', async () => {
    const channelId = await createChannel({
      client: clientId,
      operatingMode: 'agency',
    });
    await createConversation({ channelId, createdAt: '2026-08-10T12:00:00Z' });

    expect(
      valueOf(await fetch({ client: null }), 'conversations_started'),
    ).toBe('1');
  });

  it('counts a conversation with no channel as agency context', async () => {
    await createConversation({
      channelId: null,
      createdAt: '2026-08-10T12:00:00Z',
    });

    expect(
      valueOf(await fetch({ client: null }), 'conversations_started'),
    ).toBe('1');
    expect(
      valueOf(await fetch({ client: clientId }), 'conversations_started'),
    ).toBe('0');
  });

  it('isolates opportunities by their own client binding', async () => {
    const { pipelineId, stageId } = await createPipeline();
    await createOpportunity({
      pipelineId,
      stageId,
      client: clientId,
      createdAt: '2026-08-05T12:00:00Z',
    });
    await createOpportunity({
      pipelineId,
      stageId,
      client: otherClientId,
      createdAt: '2026-08-05T12:00:00Z',
    });

    expect(
      valueOf(await fetch({ client: clientId }), 'opportunities_created'),
    ).toBe('1');
    expect(
      valueOf(await fetch({ client: otherClientId }), 'opportunities_created'),
    ).toBe('1');
  });

  // ------------------------------------------------------------- contract

  it('reports canonical freshness rather than inventing staleness', async () => {
    const set = await fetch();

    expect(set.freshness.mode).toBe('canonical');
    expect(set.freshness.isPartial).toBe(false);
    expect(set.freshness.coverage).toEqual({
      expectedDays: 31,
      coveredDays: 31,
      basis: 'canonical',
    });
    expect(Date.parse(set.freshness.asOf!)).toBeGreaterThan(0);
  });

  it('declares no attribution basis, because LeadFlow has none', async () => {
    const set = await fetch();

    expect(set.provenance.attributionBasis).toBeNull();
    expect(set.provenance.ingestionMode).toBe('live');
    expect(set.provenance.canonicalSource).toContain('crm_opportunities');
  });

  it('reports businessMode null without blocking the read', async () => {
    const set = await fetch();

    expect(set.businessMode).toBeNull();
    expect(set.facts.length).toBeGreaterThan(0);
  });

  it('declares every metric it emits, and emits every metric it declares', async () => {
    const set = await fetch();

    expect(new Set(set.facts.map((fact) => fact.metricKey))).toEqual(
      new Set(set.descriptors.map((descriptor) => descriptor.key)),
    );
  });

  it('emits only additive metrics, all as decimal strings', async () => {
    const set = await fetch();

    for (const descriptor of set.descriptors) {
      expect(descriptor.additivity).toBe('sum');
    }
    for (const fact of set.facts) {
      expect(fact.value === null || typeof fact.value === 'string').toBe(true);
    }
  });

  it('refuses an unsupported grain', async () => {
    await expect(fetch({ grain: 'week' as never })).rejects.toThrow(
      'Unsupported grain',
    );
  });

  /**
   * The adapter and the operational analytics service must agree about which
   * rows belong to a client.
   *
   * They now share `LEADFLOW_SCOPE_SQL`, so this cannot drift by editing one
   * copy — but sharing a string is not the same as producing the same answer,
   * because each caller binds it into different SQL with its own joins and its
   * own parameter positions. A wrong `$3`/`$4` offset in either would still
   * compile, still run, and quietly scope to the wrong client.
   *
   * So this asserts the outcome rather than the text: the same fixtures, split
   * across two clients and the agency, counted by the adapter and by the
   * predicate applied directly.
   */
  describe('scope parity with the canonical predicate', () => {
    const countCanonically = async (client: string | null) => {
      const rows = await AgencyDataSource.query<{ count: string }[]>(
        `
          SELECT COUNT(*)::text AS count
          FROM inbox_conversations conversation
          LEFT JOIN inbox_channels channel
            ON channel.id = conversation.channel_id
           AND channel.tenant_id = conversation.tenant_id
           AND channel.workspace_id = conversation.workspace_id
           AND channel.deleted_at IS NULL
          WHERE conversation.tenant_id = $1
            AND conversation.workspace_id = $2
            AND conversation.created_at >= $5::date
            AND conversation.created_at < ($6::date + INTERVAL '1 day')
            AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
        `,
        [
          ...leadFlowScopeParameters({
            tenantId,
            workspaceId,
            contextType: client ? 'client' : 'agency',
            clientId: client,
          }),
          '2026-08-01',
          '2026-08-31',
        ],
      );

      return rows[0].count;
    };

    const countOpportunitiesCanonically = async (client: string | null) => {
      const rows = await AgencyDataSource.query<{ count: string }[]>(
        `
          SELECT COUNT(*)::text AS count
          FROM crm_opportunities opportunity
          WHERE opportunity.tenant_id = $1
            AND opportunity.workspace_id = $2
            AND opportunity.created_at >= $5::date
            AND opportunity.created_at < ($6::date + INTERVAL '1 day')
            AND ${LEADFLOW_SCOPE_SQL.OPPORTUNITY}
        `,
        [
          ...leadFlowScopeParameters({
            tenantId,
            workspaceId,
            contextType: client ? 'client' : 'agency',
            clientId: client,
          }),
          '2026-08-01',
          '2026-08-31',
        ],
      );

      return rows[0].count;
    };

    beforeEach(async () => {
      // A deliberately mixed population: two managed clients, an agency-only
      // channel, an agency-operated client channel, and a channel-less
      // conversation. Every branch of both predicates is exercised.
      const mine = await createChannel({ client: clientId });
      const theirs = await createChannel({ client: otherClientId });
      const agencyOwn = await createChannel({ client: null });
      const agencyOperated = await createChannel({
        client: clientId,
        operatingMode: 'agency',
      });

      for (const [channel, count] of [
        [mine, 3],
        [theirs, 2],
        [agencyOwn, 1],
        [agencyOperated, 1],
      ] as const) {
        for (let index = 0; index < count; index += 1) {
          await createConversation({
            channelId: channel,
            createdAt: `2026-08-${String(10 + index).padStart(2, '0')}T12:00:00Z`,
          });
        }
      }

      await createConversation({
        channelId: null,
        createdAt: '2026-08-15T12:00:00Z',
      });

      const { pipelineId, stageId } = await createPipeline();
      for (const [client, count] of [
        [clientId, 2],
        [otherClientId, 3],
        [null, 1],
      ] as const) {
        for (let index = 0; index < count; index += 1) {
          await createOpportunity({
            pipelineId,
            stageId,
            client,
            createdAt: `2026-08-${String(10 + index).padStart(2, '0')}T12:00:00Z`,
          });
        }
      }
    });

    it.each([
      ['managed client', 'client'],
      ['the other managed client', 'other'],
      ['agency own context', 'agency'],
    ])(
      'conversations_started matches the canonical predicate for %s',
      async (_label, which) => {
        const client =
          which === 'client'
            ? clientId
            : which === 'other'
              ? otherClientId
              : null;

        const set = await fetch({ client });

        expect(valueOf(set, 'conversations_started')).toBe(
          await countCanonically(client),
        );
      },
    );

    it.each([
      ['managed client', 'client'],
      ['the other managed client', 'other'],
      ['agency own context', 'agency'],
    ])(
      'opportunities_created matches the canonical predicate for %s',
      async (_label, which) => {
        const client =
          which === 'client'
            ? clientId
            : which === 'other'
              ? otherClientId
              : null;

        const set = await fetch({ client });

        expect(valueOf(set, 'opportunities_created')).toBe(
          await countOpportunitiesCanonically(client),
        );
      },
    );

    /**
     * The three contexts cover every row, and overlap on exactly one shape.
     *
     * This started as a strict partition assertion and failed, 9 against 8 —
     * which turned out to be a property of the canonical predicate itself,
     * present in `LeadFlowOperationalAnalyticsService` since long before this
     * adapter: a channel carrying **both** `clientId` and
     * `operatingMode: 'agency'` satisfies the client branch *and* the agency
     * branch, so its conversations are counted under both.
     *
     * Whether that is right is a product question about what an
     * agency-operated client channel means, and answering it would change what
     * every LeadFlow screen reports — well outside a boundary audit. What
     * belongs here is that the adapter inherits the established meaning exactly,
     * including this, rather than quietly diverging from the screens. So the
     * overlap is asserted as the known behaviour it is: if someone later makes
     * the predicate partition properly, this test fails and points at the
     * decision instead of letting the two surfaces drift apart.
     */
    it('covers every conversation, overlapping only on agency-operated client channels', async () => {
      const [mine, theirs, agency] = await Promise.all([
        fetch({ client: clientId }),
        fetch({ client: otherClientId }),
        fetch({ client: null }),
      ]);

      const total = [mine, theirs, agency].reduce(
        (sum, set) => sum + Number(valueOf(set, 'conversations_started')),
        0,
      );

      const [{ count }] = await AgencyDataSource.query<{ count: string }[]>(
        `SELECT COUNT(*)::text AS count FROM inbox_conversations
          WHERE tenant_id = $1 AND workspace_id = $2
            AND created_at >= '2026-08-01' AND created_at < '2026-09-01'`,
        [tenantId, workspaceId],
      );

      // 3 mine + 2 theirs + 1 agency-own + 1 agency-operated + 1 channel-less.
      expect(count).toBe('8');

      // 9, not 8: the single agency-operated client channel is counted twice.
      expect(total).toBe(9);

      // And it is that channel specifically — the client's own count includes
      // it, and so does the agency's.
      expect(valueOf(mine, 'conversations_started')).toBe('4'); // 3 + operated
      expect(valueOf(theirs, 'conversations_started')).toBe('2');
      expect(valueOf(agency, 'conversations_started')).toBe('3'); // own + operated + channel-less
    });
  });

  /**
   * Realistic windows, measured rather than assumed.
   *
   * The four counting queries run concurrently and each is a `GROUP BY` over an
   * indexed tenant/workspace prefix. The point is to know the cost before anyone
   * proposes materialising anything — nothing is materialised here.
   */
  describe('performance', () => {
    // Seeded per test rather than once: `afterEach` resets the tenant, so a
    // `beforeAll` here would leave every test after the first measuring an
    // empty table — a fast number that means nothing.
    beforeEach(async () => {
      const channelId = await createChannel({ client: clientId });
      const { pipelineId, stageId } = await createPipeline();

      // ~120 days of traffic: one conversation with two inbound messages per
      // day, plus an opportunity, so both windows have real rows to scan.
      for (let offset = 0; offset < 120; offset += 1) {
        const day = new Date(Date.UTC(2026, 3, 1) + offset * 86_400_000)
          .toISOString()
          .slice(0, 10);
        const conversationId = await createConversation({
          channelId,
          createdAt: `${day}T12:00:00Z`,
        });
        await createInboundMessage({
          conversationId,
          occurredAt: `${day}T12:01:00Z`,
        });
        await createInboundMessage({
          conversationId,
          occurredAt: `${day}T12:02:00Z`,
        });
        await createOpportunity({
          pipelineId,
          stageId,
          client: clientId,
          createdAt: `${day}T13:00:00Z`,
          status: 'won',
          wonAt: `${day}T18:00:00Z`,
          value: '100.00',
        });
      }
    });

    it.each([
      ['30d', '2026-06-02', '2026-07-01'],
      ['90d', '2026-04-03', '2026-07-01'],
    ])('answers a %s period window', async (label, since, until) => {
      const started = Date.now();
      const set = await fetch({ since, until });
      const elapsed = Date.now() - started;

      expect(set.facts).toHaveLength(5);
      expect(valueOf(set, 'conversations_started')).not.toBe('0');

      console.log(`[perf] leadflow period ${label}: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(5_000);
    });

    it.each([
      ['30d', '2026-06-02', '2026-07-01', 30],
      ['90d', '2026-04-03', '2026-07-01', 90],
    ])('answers a %s day-grain window', async (label, since, until, days) => {
      const started = Date.now();
      const set = await fetch({ grain: 'day', since, until });
      const elapsed = Date.now() - started;

      expect(set.facts).toHaveLength(days * 5);
      // Proves the measurement ran against seeded rows, not an empty table.
      expect(valueOf(set, 'conversations_started', since)).toBe('1');

      console.log(`[perf] leadflow day ${label}: ${elapsed}ms`);
      expect(elapsed).toBeLessThan(5_000);
    });
  });
});
