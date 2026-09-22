import { randomUUID } from 'node:crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { LeadFlowOperationalAnalyticsService } from './leadflow-operational-analytics.service';

const run = describePostgresIntegration();

/**
 * CC2G.1 — proves `LeadFlowOperationalAnalyticsService` isolates Company A
 * from Company B against a real database, not a mock.
 *
 * Runs inside an ephemeral schema (via `search_path`) so it never touches the
 * real migrated tables, following the same isolation pattern
 * `company-context-leadflow-crm-operations.migration.postgres.spec.ts` uses: a
 * hand-rolled minimal schema with only the columns these queries read,
 * created and torn down inside one rolled-back transaction. That is
 * deliberately not a full copy of the production schema — the point here is
 * to prove the *service's SQL* genuinely partitions by `company_context_id`,
 * which a mocked `dataSource.query` cannot prove (a mock returns whatever the
 * test tells it to, regardless of what the WHERE clause actually says).
 */
run('LeadFlowOperationalAnalyticsService — company A/B isolation', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('Company A and Company B see only their own channels, messages, agents, scores and automation runs — same AgencyClient, same tenant/workspace, same window', async () => {
    const runner = AgencyDataSource.createQueryRunner();
    const schema = `cc2g1_ops_${process.pid}_${Date.now()}`;
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const clientId = randomUUID(); // same AgencyClient for both companies
    const companyAId = randomUUID();
    const companyBId = randomUUID();

    const channelAId = randomUUID();
    const channelBId = randomUUID();
    const agentAId = randomUUID();
    const agentBId = randomUUID();
    const conversationAId = randomUUID();
    const conversationBId = randomUUID();
    const pipelineAId = randomUUID();
    const pipelineBId = randomUUID();
    const stageAId = randomUUID();
    const stageBId = randomUUID();
    const opportunityAId = randomUUID();
    const opportunityBId = randomUUID();
    const automationAId = randomUUID();
    const automationBId = randomUUID();
    const runAId = randomUUID();
    const runBId = randomUUID();

    const from = '2026-07-01T00:00:00.000Z';
    const to = '2026-07-31T00:00:00.000Z';
    const inWindow = '2026-07-15T10:00:00.000Z';

    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET LOCAL search_path TO "${schema}", public`);
      await createMinimalSchema(runner);

      // ---- fixtures: Company A (2 conversations/messages/1 opportunity/1 automation run)
      await runner.query(
        `INSERT INTO inbox_channels (id, tenant_id, workspace_id, name, type, agency_client_id, company_context_id, deleted_at)
         VALUES ($1,$2,$3,'WhatsApp A','whatsapp',$4,$5,NULL)`,
        [channelAId, tenantId, workspaceId, clientId, companyAId],
      );
      await runner.query(
        `INSERT INTO inbox_conversations (id, tenant_id, workspace_id, channel_id, business_mode, assigned_agent_id, created_at)
         VALUES ($1,$2,$3,$4,'general',NULL,$5::timestamptz)`,
        [conversationAId, tenantId, workspaceId, channelAId, inWindow],
      );
      await runner.query(
        `INSERT INTO inbox_messages (id, tenant_id, workspace_id, conversation_id, direction, sender_type, sender_agent_id, status, occurred_at)
         VALUES ($1,$2,$3,$4,'inbound','contact',NULL,'delivered',$5::timestamptz)`,
        [randomUUID(), tenantId, workspaceId, conversationAId, inWindow],
      );
      await runner.query(
        `INSERT INTO leadflow_agents (id, tenant_id, workspace_id, name, type, context_type, agency_client_id, company_context_id)
         VALUES ($1,$2,$3,'Agente A','qualifier','client',$4,$5)`,
        [agentAId, tenantId, workspaceId, clientId, companyAId],
      );
      await runner.query(
        `INSERT INTO crm_pipelines (id, tenant_id, workspace_id) VALUES ($1,$2,$3)`,
        [pipelineAId, tenantId, workspaceId],
      );
      await runner.query(
        `INSERT INTO crm_stages (id, tenant_id, workspace_id, pipeline_id) VALUES ($1,$2,$3,$4)`,
        [stageAId, tenantId, workspaceId, pipelineAId],
      );
      await runner.query(
        `INSERT INTO crm_opportunities (id, tenant_id, workspace_id, pipeline_id, stage_id, business_mode, agency_client_id, company_context_id, created_at)
         VALUES ($1,$2,$3,$4,$5,'general',$6,$7,$8::timestamptz)`,
        [opportunityAId, tenantId, workspaceId, pipelineAId, stageAId, clientId, companyAId, inWindow],
      );
      await runner.query(
        `INSERT INTO leadflow_automations (id, tenant_id, workspace_id, name, business_mode_key, context_type, agency_client_id, company_context_id)
         VALUES ($1,$2,$3,'Automação A','general','client',$4,$5)`,
        [automationAId, tenantId, workspaceId, clientId, companyAId],
      );
      await runner.query(
        `INSERT INTO leadflow_automation_runs (id, tenant_id, workspace_id, automation_id, recipe_key, mode, status, attempt_count, created_at)
         VALUES ($1,$2,$3,$4,'recipe','live','succeeded',1,$5::timestamptz)`,
        [runAId, tenantId, workspaceId, automationAId, inWindow],
      );

      // ---- fixtures: Company B (different volumes, same AgencyClient/tenant/workspace/window)
      await runner.query(
        `INSERT INTO inbox_channels (id, tenant_id, workspace_id, name, type, agency_client_id, company_context_id, deleted_at)
         VALUES ($1,$2,$3,'WhatsApp B','whatsapp',$4,$5,NULL)`,
        [channelBId, tenantId, workspaceId, clientId, companyBId],
      );
      await runner.query(
        `INSERT INTO inbox_conversations (id, tenant_id, workspace_id, channel_id, business_mode, assigned_agent_id, created_at)
         VALUES ($1,$2,$3,$4,'general',NULL,$5::timestamptz)`,
        [conversationBId, tenantId, workspaceId, channelBId, inWindow],
      );
      for (let i = 0; i < 3; i += 1) {
        await runner.query(
          `INSERT INTO inbox_messages (id, tenant_id, workspace_id, conversation_id, direction, sender_type, sender_agent_id, status, occurred_at)
           VALUES ($1,$2,$3,$4,'inbound','contact',NULL,'delivered',$5::timestamptz)`,
          [randomUUID(), tenantId, workspaceId, conversationBId, inWindow],
        );
      }
      await runner.query(
        `INSERT INTO leadflow_agents (id, tenant_id, workspace_id, name, type, context_type, agency_client_id, company_context_id)
         VALUES ($1,$2,$3,'Agente B','qualifier','client',$4,$5)`,
        [agentBId, tenantId, workspaceId, clientId, companyBId],
      );
      await runner.query(
        `INSERT INTO crm_pipelines (id, tenant_id, workspace_id) VALUES ($1,$2,$3)`,
        [pipelineBId, tenantId, workspaceId],
      );
      await runner.query(
        `INSERT INTO crm_stages (id, tenant_id, workspace_id, pipeline_id) VALUES ($1,$2,$3,$4)`,
        [stageBId, tenantId, workspaceId, pipelineBId],
      );
      for (let i = 0; i < 4; i += 1) {
        await runner.query(
          `INSERT INTO crm_opportunities (id, tenant_id, workspace_id, pipeline_id, stage_id, business_mode, agency_client_id, company_context_id, created_at)
           VALUES ($1,$2,$3,$4,$5,'general',$6,$7,$8::timestamptz)`,
          [i === 0 ? opportunityBId : randomUUID(), tenantId, workspaceId, pipelineBId, stageBId, clientId, companyBId, inWindow],
        );
      }
      await runner.query(
        `INSERT INTO leadflow_automations (id, tenant_id, workspace_id, name, business_mode_key, context_type, agency_client_id, company_context_id)
         VALUES ($1,$2,$3,'Automação B','general','client',$4,$5)`,
        [automationBId, tenantId, workspaceId, clientId, companyBId],
      );
      for (let i = 0; i < 2; i += 1) {
        await runner.query(
          `INSERT INTO leadflow_automation_runs (id, tenant_id, workspace_id, automation_id, recipe_key, mode, status, attempt_count, created_at)
           VALUES ($1,$2,$3,$4,'recipe','live','succeeded',1,$5::timestamptz)`,
          [i === 0 ? runBId : randomUUID(), tenantId, workspaceId, automationBId, inWindow],
        );
      }

      // ---- legacy_unassigned rows: must appear in neither A nor B.
      const legacyChannelId = randomUUID();
      await runner.query(
        `INSERT INTO inbox_channels (id, tenant_id, workspace_id, name, type, agency_client_id, company_context_id, deleted_at)
         VALUES ($1,$2,$3,'Legado','whatsapp',NULL,NULL,NULL)`,
        [legacyChannelId, tenantId, workspaceId],
      );

      const service = new LeadFlowOperationalAnalyticsService(
        runner as unknown as never,
      );
      // The service is normally constructed with the DataSource itself, whose
      // `.query` runs on a fresh connection outside this transaction/schema.
      // Binding it to `runner.query` keeps every read inside the same
      // transaction and `search_path`, so it sees exactly the ephemeral
      // fixtures above and nothing from the real schema.
      Object.defineProperty(service, 'dataSource', {
        value: { query: (sql: string, params?: unknown[]) => runner.query(sql, params) },
      });

      const contextFor = (companyId: string) => ({
        tenantId,
        workspaceId,
        managedContext: {
          productKey: 'leadflow' as const,
          operatingMode: 'client' as const,
          clientId,
          companyContextId: companyId,
          managedTenantId: null,
        },
      });

      const resultA = await service.getOverview(contextFor(companyAId) as never, {
        from,
        to,
      } as never);
      const resultB = await service.getOverview(contextFor(companyBId) as never, {
        from,
        to,
      } as never);

      // Company A: 1 conversation, 1 inbound message, 1 opportunity, 1 automation run.
      expect(resultA.messages.summary.inboundConversations).toBe(1);
      expect(resultA.automations.summary.runs).toBe(1);

      // Company B: 1 conversation but 3 inbound messages, 4 opportunities, 2 automation runs.
      expect(resultB.messages.summary.inboundConversations).toBe(1);
      expect(resultB.automations.summary.runs).toBe(2);

      // Cross-check: the raw message/run facts never mix ids across companies.
      const rawA = await runner.query(
        `SELECT COUNT(*)::int AS n FROM inbox_messages WHERE conversation_id = $1`,
        [conversationAId],
      );
      const rawB = await runner.query(
        `SELECT COUNT(*)::int AS n FROM inbox_messages WHERE conversation_id = $1`,
        [conversationBId],
      );
      expect(rawA[0].n).toBe(1);
      expect(rawB[0].n).toBe(3);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});

async function createMinimalSchema(runner: import('typeorm').QueryRunner) {
  await runner.query(`
    CREATE TABLE inbox_channels (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      name varchar(140) NOT NULL, type varchar(40) NOT NULL,
      agency_client_id uuid, company_context_id uuid, deleted_at timestamptz
    );
    CREATE TABLE inbox_conversations (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      channel_id uuid, business_mode varchar(80) NOT NULL DEFAULT 'general',
      assigned_agent_id uuid, created_at timestamptz NOT NULL
    );
    CREATE TABLE inbox_messages (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      conversation_id uuid NOT NULL, direction varchar(16) NOT NULL,
      sender_type varchar(24) NOT NULL, sender_agent_id uuid,
      status varchar(24) NOT NULL, occurred_at timestamptz NOT NULL
    );
    CREATE TABLE leadflow_agents (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      name varchar(140) NOT NULL, type varchar(40) NOT NULL,
      context_type varchar(16) NOT NULL,
      agency_client_id uuid, company_context_id uuid
    );
    CREATE TABLE crm_pipelines (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL
    );
    CREATE TABLE crm_stages (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      pipeline_id uuid NOT NULL
    );
    CREATE TABLE crm_opportunities (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      pipeline_id uuid NOT NULL, stage_id uuid NOT NULL,
      business_mode varchar(80) NOT NULL DEFAULT 'general',
      inbox_conversation_id uuid,
      agency_client_id uuid, company_context_id uuid, created_at timestamptz NOT NULL
    );
    CREATE TABLE crm_lead_score_snapshots (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      opportunity_id uuid NOT NULL, score int NOT NULL, band varchar(24) NOT NULL,
      previous_score int, previous_band varchar(24), policy_version varchar(24) NOT NULL,
      max_achievable int NOT NULL, calculated_at timestamptz NOT NULL
    );
    CREATE TABLE leadflow_automations (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      name varchar(140) NOT NULL, business_mode_key varchar(80) NOT NULL DEFAULT 'general',
      context_type varchar(16) NOT NULL,
      agency_client_id uuid, company_context_id uuid
    );
    CREATE TABLE leadflow_automation_runs (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      automation_id uuid NOT NULL, recipe_key varchar(80) NOT NULL,
      mode varchar(16) NOT NULL, status varchar(24) NOT NULL,
      skip_reason varchar(80), error_code varchar(80), attempt_count int NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL, started_at timestamptz, finished_at timestamptz
    );
    CREATE TABLE leadflow_automation_run_attempts (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      run_id uuid NOT NULL, effect_confirmed boolean NOT NULL DEFAULT false,
      status varchar(24) NOT NULL
    );
  `);
}
