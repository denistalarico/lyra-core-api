import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import {
  LEADFLOW_SCOPE_SQL,
  leadFlowScopeParameters,
} from '../../leadflow-analytics/scope/leadflow-analytics-scope.sql';
import {
  QUALIFICATION_STATUS_CHANGED_EVENT,
  recordQualificationTransition,
  type QualificationStatus,
} from './qualification-transition.recorder';

const run = describePostgresIntegration();

/**
 * The history against a real database.
 *
 * Three of the properties this history is supposed to have cannot be observed
 * against a mock. Atomicity is one: the whole point is that a transition and
 * the status it describes commit together, and a fake repository commits
 * nothing. Concurrency is another. The third is the query I3 will eventually
 * run — it joins through the channel to resolve the client, and whether that
 * isolates one client from another is a question about SQL, not about
 * TypeScript.
 */
run('qualification transition history', () => {
  const tenantId = randomUUID();
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const otherWorkspaceId = randomUUID();
  const clientId = randomUUID();
  const otherClientId = randomUUID();

  const tables = [
    'inbox_conversation_events',
    'inbox_messages',
    'inbox_conversations',
    'inbox_channels',
  ];

  const reset = async () => {
    for (const tenant of [tenantId, otherTenantId]) {
      await deleteFixtureTenant(AgencyDataSource, tenant, tables);
    }
  };

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    await reset();
  });

  afterAll(async () => {
    await reset();
  });

  beforeEach(reset);

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
    tenant?: string;
    workspace?: string;
    status?: QualificationStatus;
  }) => {
    const id = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO inbox_conversations
         (id, tenant_id, workspace_id, channel_id, status, priority, source,
          business_mode, unread_count, ai_enabled, metadata, created_at,
          updated_at, ownership_state, ownership_version, ownership_changed_at,
          qualification_status)
       VALUES ($1, $2, $3, $4, 'new', 'normal', 'inbound', 'general', 0, false,
               '{}'::jsonb, now(), now(), 'paused', 1, now(), $5)`,
      [
        id,
        options.tenant ?? tenantId,
        options.workspace ?? workspaceId,
        options.channelId,
        options.status ?? 'pending',
      ],
    );
    return id;
  };

  /**
   * `query` is typed `any`, so the shape is declared once here rather than
   * asserted at every call site.
   */
  const select = async <T>(
    runner: { query: (sql: string, params?: unknown[]) => Promise<unknown> },
    sql: string,
    params: unknown[],
  ): Promise<T[]> => (await runner.query(sql, params)) as T[];

  const currentStatus = async (conversationId: string) => {
    const [row] = await select<{ qualification_status: QualificationStatus }>(
      AgencyDataSource,
      `SELECT qualification_status FROM inbox_conversations WHERE id = $1`,
      [conversationId],
    );
    return row.qualification_status;
  };

  /**
   * What a writer does: change the status and record the transition, together.
   */
  const applyTransition = async (options: {
    conversationId: string;
    newStatus: QualificationStatus;
    tenant?: string;
    workspace?: string;
    occurredAt?: string;
    reason?: string | null;
    failAfterHistory?: boolean;
  }) => {
    return AgencyDataSource.transaction(async (manager) => {
      const [row] = await select<{ qualification_status: QualificationStatus }>(
        manager,
        `SELECT qualification_status FROM inbox_conversations WHERE id = $1`,
        [options.conversationId],
      );

      await recordQualificationTransition(manager, {
        conversation: {
          id: options.conversationId,
          tenantId: options.tenant ?? tenantId,
          workspaceId: options.workspace ?? workspaceId,
        },
        previousStatus: row.qualification_status,
        newStatus: options.newStatus,
        reason: options.reason ?? 'test_transition',
        actor: { type: 'system' },
        occurredAt: new Date(options.occurredAt ?? '2026-07-15T12:00:00.000Z'),
      });

      await manager.query(
        `UPDATE inbox_conversations SET qualification_status = $2 WHERE id = $1`,
        [options.conversationId, options.newStatus],
      );

      if (options.failAfterHistory) throw new Error('write_failed');
    });
  };

  const history = async (conversationId: string) =>
    select<{
      previous: string;
      next: string;
      occurred_at: string;
      actor_type: string;
    }>(
      AgencyDataSource,
      `SELECT payload->>'previousStatus' AS previous,
              payload->>'newStatus' AS next,
              payload->>'occurredAt' AS occurred_at,
              actor_type
         FROM inbox_conversation_events
        WHERE conversation_id = $1
          AND event_type = $2
        ORDER BY created_at`,
      [conversationId, QUALIFICATION_STATUS_CHANGED_EVENT],
    );

  describe('recording', () => {
    it('records a promotion and leaves the current state authoritative', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });

      await applyTransition({ conversationId, newStatus: 'qualified' });

      expect(await history(conversationId)).toEqual([
        expect.objectContaining({ previous: 'pending', next: 'qualified' }),
      ]);

      // The projection still answers "is it qualified now?" — unchanged.
      expect(await currentStatus(conversationId)).toBe('qualified');
    });

    it('records a demotion', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({
        channelId,
        status: 'qualified',
      });

      await applyTransition({ conversationId, newStatus: 'disqualified' });

      expect(await history(conversationId)).toEqual([
        expect.objectContaining({
          previous: 'qualified',
          next: 'disqualified',
        }),
      ]);
    });

    it('writes no row when nothing changed', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({
        channelId,
        status: 'qualified',
      });

      await applyTransition({ conversationId, newStatus: 'qualified' });

      expect(await history(conversationId)).toHaveLength(0);
    });

    it('keeps all four legs of a requalification cycle', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });

      await applyTransition({
        conversationId,
        newStatus: 'qualified',
        occurredAt: '2026-07-01T10:00:00.000Z',
      });
      await applyTransition({
        conversationId,
        newStatus: 'disqualified',
        occurredAt: '2026-07-05T10:00:00.000Z',
      });
      await applyTransition({
        conversationId,
        newStatus: 'qualified',
        occurredAt: '2026-07-20T10:00:00.000Z',
      });

      const rows = await history(conversationId);
      expect(rows.map((row) => row.next)).toEqual([
        'qualified',
        'disqualified',
        'qualified',
      ]);
    });
  });

  describe('atomicity', () => {
    /**
     * The property that makes this history trustworthy: it cannot disagree
     * with the column it describes.
     */
    it('rolls back the history when the state write fails', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });

      await expect(
        applyTransition({
          conversationId,
          newStatus: 'qualified',
          failAfterHistory: true,
        }),
      ).rejects.toThrow('write_failed');

      // Neither half survived.
      expect(await history(conversationId)).toHaveLength(0);
      expect(await currentStatus(conversationId)).toBe('pending');
    });

    it('rolls back the state when the history write fails', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });

      await expect(
        AgencyDataSource.transaction(async (manager) => {
          await manager.query(
            `UPDATE inbox_conversations SET qualification_status = 'qualified' WHERE id = $1`,
            [conversationId],
          );
          // A history row that violates the not-null contract: the same
          // failure a bug in the recorder would produce.
          await manager.query(
            `INSERT INTO inbox_conversation_events
               (tenant_id, workspace_id, conversation_id, event_type, actor_type, payload)
             VALUES ($1, $2, $3, NULL, 'system', '{}'::jsonb)`,
            [tenantId, workspaceId, conversationId],
          );
        }),
      ).rejects.toThrow();

      expect(await currentStatus(conversationId)).toBe('pending');
    });
  });

  describe('concurrency', () => {
    /**
     * Two writers racing for the same conversation. The history must agree
     * with whichever state actually won, not describe a third reality.
     */
    it('produces history consistent with the state that was written', async () => {
      const channelId = await createChannel({});
      const conversationId = await createConversation({ channelId });

      const contend = (newStatus: QualificationStatus) =>
        AgencyDataSource.transaction(async (manager) => {
          const [row] = await select<{
            qualification_status: QualificationStatus;
          }>(
            manager,
            `SELECT qualification_status FROM inbox_conversations
              WHERE id = $1 FOR UPDATE`,
            [conversationId],
          );

          await recordQualificationTransition(manager, {
            conversation: { id: conversationId, tenantId, workspaceId },
            previousStatus: row.qualification_status,
            newStatus,
            reason: 'race',
            actor: { type: 'system' },
            occurredAt: new Date('2026-07-15T12:00:00.000Z'),
          });
          await manager.query(
            `UPDATE inbox_conversations SET qualification_status = $2 WHERE id = $1`,
            [conversationId, newStatus],
          );
        });

      await Promise.all([contend('qualified'), contend('disqualified')]);

      const rows = await history(conversationId);
      const current = await currentStatus(conversationId);

      // The row-level lock serialises them, so the chain is unbroken: the
      // second transition starts from what the first one left behind, and the
      // last recorded newStatus is the state now in the column.
      expect(rows).toHaveLength(2);
      expect(rows[0].next).toBe(rows[1].previous);
      expect(rows[1].next).toBe(current);
    });
  });

  describe('the query I3 will run', () => {
    /**
     * Not wiring I3 here — only proving the question is answerable. A
     * conversation counts once, at its first observed transition to qualified,
     * and the client comes from the shared LeadFlow predicate rather than from
     * anything frozen onto the event row.
     */
    const firstQualified = async (options: {
      since: string;
      until: string;
      contextType: 'agency' | 'client';
      client: string | null;
      tenant?: string;
      workspace?: string;
    }) => {
      const rows = await select<{ qualified_leads: string }>(
        AgencyDataSource,
        `SELECT count(*)::bigint AS qualified_leads
           FROM (
             SELECT event.conversation_id,
                    min((event.payload->>'occurredAt')::timestamptz) AS first_qualified_at
               FROM inbox_conversation_events event
               JOIN inbox_conversations conversation
                 ON conversation.id = event.conversation_id
                AND conversation.tenant_id = event.tenant_id
                AND conversation.workspace_id = event.workspace_id
               LEFT JOIN inbox_channels channel
                 ON channel.id = conversation.channel_id
              WHERE event.tenant_id = $1
                AND event.workspace_id = $2
                AND event.event_type = $5
                AND event.payload->>'newStatus' = 'qualified'
                AND ${LEADFLOW_SCOPE_SQL.CHANNEL}
              GROUP BY event.conversation_id
           ) first
          WHERE first.first_qualified_at >= $6::timestamptz
            AND first.first_qualified_at < ($7::date + INTERVAL '1 day')::timestamptz`,
        [
          ...leadFlowScopeParameters({
            tenantId: options.tenant ?? tenantId,
            workspaceId: options.workspace ?? workspaceId,
            contextType: options.contextType,
            clientId: options.client,
          }),
          QUALIFICATION_STATUS_CHANGED_EVENT,
          options.since,
          options.until,
        ],
      );
      return Number(rows[0].qualified_leads);
    };

    it('counts a conversation once at its first qualification', async () => {
      const channelId = await createChannel({ client: clientId });
      const conversationId = await createConversation({ channelId });

      await applyTransition({
        conversationId,
        newStatus: 'qualified',
        occurredAt: '2026-07-10T12:00:00.000Z',
      });
      await applyTransition({
        conversationId,
        newStatus: 'disqualified',
        occurredAt: '2026-07-12T12:00:00.000Z',
      });
      await applyTransition({
        conversationId,
        newStatus: 'qualified',
        occurredAt: '2026-07-20T12:00:00.000Z',
      });

      // Three transitions, two of them to qualified — but one lead.
      expect(
        await firstQualified({
          since: '2026-07-01',
          until: '2026-07-31',
          contextType: 'client',
          client: clientId,
        }),
      ).toBe(1);
    });

    it('places the lead in the window of its first qualification only', async () => {
      const channelId = await createChannel({ client: clientId });
      const conversationId = await createConversation({ channelId });

      await applyTransition({
        conversationId,
        newStatus: 'qualified',
        occurredAt: '2026-07-10T12:00:00.000Z',
      });
      await applyTransition({
        conversationId,
        newStatus: 'disqualified',
        occurredAt: '2026-07-15T12:00:00.000Z',
      });
      await applyTransition({
        conversationId,
        newStatus: 'qualified',
        occurredAt: '2026-08-05T12:00:00.000Z',
      });

      // August sees nothing: the requalification is not a new lead.
      expect(
        await firstQualified({
          since: '2026-08-01',
          until: '2026-08-31',
          contextType: 'client',
          client: clientId,
        }),
      ).toBe(0);
    });

    it('excludes a conversation that never reached qualified', async () => {
      const channelId = await createChannel({ client: clientId });
      const conversationId = await createConversation({ channelId });

      await applyTransition({ conversationId, newStatus: 'internal' });

      expect(
        await firstQualified({
          since: '2026-07-01',
          until: '2026-07-31',
          contextType: 'client',
          client: clientId,
        }),
      ).toBe(0);
    });

    it('isolates one managed client from another', async () => {
      const mine = await createChannel({ client: clientId });
      const theirs = await createChannel({ client: otherClientId });

      for (const channelId of [mine, theirs]) {
        const conversationId = await createConversation({ channelId });
        await applyTransition({ conversationId, newStatus: 'qualified' });
      }

      expect(
        await firstQualified({
          since: '2026-07-01',
          until: '2026-07-31',
          contextType: 'client',
          client: clientId,
        }),
      ).toBe(1);
    });

    it('keeps the agency context out of a client channel', async () => {
      const channelId = await createChannel({ client: clientId });
      const conversationId = await createConversation({ channelId });
      await applyTransition({ conversationId, newStatus: 'qualified' });

      expect(
        await firstQualified({
          since: '2026-07-01',
          until: '2026-07-31',
          contextType: 'agency',
          client: null,
        }),
      ).toBe(0);
    });

    it('reads the agency own channel in the agency context', async () => {
      const channelId = await createChannel({ operatingMode: 'agency' });
      const conversationId = await createConversation({ channelId });
      await applyTransition({ conversationId, newStatus: 'qualified' });

      expect(
        await firstQualified({
          since: '2026-07-01',
          until: '2026-07-31',
          contextType: 'agency',
          client: null,
        }),
      ).toBe(1);
    });

    it('isolates tenants', async () => {
      const channelId = await createChannel({
        tenant: otherTenantId,
        workspace: workspaceId,
        client: clientId,
      });
      const conversationId = await createConversation({
        channelId,
        tenant: otherTenantId,
        workspace: workspaceId,
      });
      await applyTransition({
        conversationId,
        newStatus: 'qualified',
        tenant: otherTenantId,
      });

      expect(
        await firstQualified({
          since: '2026-07-01',
          until: '2026-07-31',
          contextType: 'client',
          client: clientId,
        }),
      ).toBe(0);
    });

    it('isolates workspaces', async () => {
      const channelId = await createChannel({
        workspace: otherWorkspaceId,
        client: clientId,
      });
      const conversationId = await createConversation({
        channelId,
        workspace: otherWorkspaceId,
      });
      await applyTransition({
        conversationId,
        newStatus: 'qualified',
        workspace: otherWorkspaceId,
      });

      expect(
        await firstQualified({
          since: '2026-07-01',
          until: '2026-07-31',
          contextType: 'client',
          client: clientId,
        }),
      ).toBe(0);
    });
  });

  describe('legacy data', () => {
    /**
     * A conversation qualified before this history existed. Its current state
     * is knowable; when it became qualified is not, and nothing here invents
     * an answer from created_at or updated_at.
     */
    it('leaves an already-qualified conversation with no invented history', async () => {
      const channelId = await createChannel({ client: clientId });
      const conversationId = await createConversation({
        channelId,
        status: 'qualified',
      });

      expect(await history(conversationId)).toHaveLength(0);
    });
  });
});
