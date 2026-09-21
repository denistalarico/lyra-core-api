import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { ScopeLeadflowCrmOperationsByCompany1794900000000 } from './1794900000000-scope-leadflow-crm-operations-by-company';

const run = describePostgresIntegration();

run('CC2F CRM and operations company scope migration', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('covers up/down/up, legacy backfill cardinality, and company tuple isolation', async () => {
    const runner = AgencyDataSource.createQueryRunner();
    const schema = `cc2f_${process.pid}_${Date.now()}`;
    const migration = new ScopeLeadflowCrmOperationsByCompany1794900000000();
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const clientId = randomUUID();
    const companyAId = randomUUID();
    const companyBId = randomUUID();
    const exactClientId = randomUUID();
    const exactCompanyId = randomUUID();
    const zeroClientId = randomUUID();
    const multiClientId = randomUUID();
    const zeroAgentId = randomUUID();
    const exactAgentId = randomUUID();
    const multiAgentId = randomUUID();
    const pipelineId = randomUUID();
    const stageId = randomUUID();
    const stageBId = randomUUID();

    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET LOCAL search_path TO "${schema}", public`);
      await createLegacySchema(runner);
      await runner.query(
        `INSERT INTO agency_client_company_contexts (id, tenant_id, workspace_id, agency_client_id)
         VALUES ($1,$3,$4,$5),($2,$3,$4,$5),($6,$3,$4,$7),($8,$3,$4,$9),($10,$3,$4,$9)`,
        [companyAId, companyBId, tenantId, workspaceId, clientId,
          exactCompanyId, exactClientId, randomUUID(), multiClientId, randomUUID()],
      );
      await runner.query(
        `INSERT INTO crm_pipelines (id, tenant_id, workspace_id) VALUES ($1,$2,$3)`,
        [pipelineId, tenantId, workspaceId],
      );
      await runner.query(
        `INSERT INTO crm_stages (id, tenant_id, workspace_id, pipeline_id) VALUES ($1,$2,$3,$4)`,
        [stageId, tenantId, workspaceId, pipelineId],
      );
      const conversationBId = randomUUID();
      await runner.query(
        `INSERT INTO leadflow_agents (id, tenant_id, workspace_id, agency_client_id)
         VALUES ($1,$2,$3,$4),($5,$2,$3,$6),($7,$2,$3,$8),($9,$2,$3,NULL)`,
        [multiAgentId, tenantId, workspaceId, clientId,
          exactAgentId, exactClientId, zeroAgentId, zeroClientId, randomUUID()],
      );

      await migration.up(runner);
      const roots = (await runner.query(
        `SELECT scope_kind FROM crm_pipelines WHERE id = $1`, [pipelineId],
      )) as Array<{ scope_kind: string }>;
      expect(roots[0]?.scope_kind).toBe('legacy_unassigned');
      const agents = (await runner.query(
        `SELECT id, company_context_id FROM leadflow_agents`,
      )) as Array<{ id: string; company_context_id: string | null }>;
      expect(agents.find((row) => row.id === exactAgentId)?.company_context_id).toBe(exactCompanyId);
      expect(agents.find((row) => row.id === zeroAgentId)?.company_context_id).toBeNull();
      expect(agents.find((row) => row.id === multiAgentId)?.company_context_id).toBeNull();

      // New Agency roots and legacy workspace-only rows remain distinct.
      const agencyPipelineId = randomUUID();
      await runner.query(
        `INSERT INTO crm_pipelines (id, tenant_id, workspace_id, scope_kind)
         VALUES ($1,$2,$3,'agency')`,
        [agencyPipelineId, tenantId, workspaceId],
      );
      const legacy = await runner.query(
        `SELECT scope_kind, agency_client_id, company_context_id FROM crm_pipelines WHERE id=$1`,
        [pipelineId],
      ) as Array<{ scope_kind: string; agency_client_id: string | null; company_context_id: string | null }>;
      expect(legacy[0]).toMatchObject({ scope_kind: 'legacy_unassigned', agency_client_id: null, company_context_id: null });

      const companyPipelineBId = randomUUID();
      await runner.query(
        `INSERT INTO crm_pipelines (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind)
         VALUES ($1,$2,$3,$4,$5,'company')`,
        [companyPipelineBId, tenantId, workspaceId, clientId, companyBId],
      );
      await runner.query(
        `INSERT INTO crm_stages (id, tenant_id, workspace_id, pipeline_id) VALUES ($1,$2,$3,$4)`,
        [stageBId, tenantId, workspaceId, companyPipelineBId],
      );
      await runner.query(
        `INSERT INTO inbox_conversations (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind)
         VALUES ($1,$2,$3,$4,$5,'company')`,
        [conversationBId, tenantId, workspaceId, clientId, companyBId],
      );

      await runner.query(
        `UPDATE crm_pipelines SET agency_client_id=$2, company_context_id=$3, scope_kind='company' WHERE id=$1`,
        [pipelineId, clientId, companyAId],
      );
      const insertOpportunity = (company: string, pipeline: string) => runner.query(
        `INSERT INTO crm_opportunities
           (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind, pipeline_id, stage_id)
         VALUES ($1,$2,$3,$4,$5,'company',$6,$7)`,
        [randomUUID(), tenantId, workspaceId, clientId, company, pipeline, stageId],
      );
      await expectRejectedQuery(runner, () => insertOpportunity(companyBId, pipelineId), '23514');
      await expectRejectedQuery(runner, () => insertOpportunity(companyAId, companyPipelineBId), '23514');
      const opportunityBId = randomUUID();
      await runner.query(
        `INSERT INTO crm_opportunities
           (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind, pipeline_id, stage_id, inbox_conversation_id)
         VALUES ($1,$2,$3,$4,$5,'company',$6,$7,$8)`,
        [opportunityBId, tenantId, workspaceId, clientId, companyBId,
          companyPipelineBId, stageBId, conversationBId],
      );
      for (const [relation, targetId] of [
        ['source_conversation_id', conversationBId],
        ['source_opportunity_id', opportunityBId],
      ]) {
        await expectRejectedQuery(runner, () => runner.query(
          `INSERT INTO scheduled_items
             (id, tenant_id, workspace_id, agency_client_id, company_context_id, scope_kind, "${relation}")
           VALUES ($1,$2,$3,$4,$5,'company',$6)`,
          [randomUUID(), tenantId, workspaceId, clientId, companyAId, targetId],
        ), '23514');
      }

      // The composite FK independently rejects a context paired with the
      // wrong tenant, workspace, or Agency Client.
      for (const [wrongTenant, wrongWorkspace, wrongClient] of [
        [randomUUID(), workspaceId, clientId],
        [tenantId, randomUUID(), clientId],
        [tenantId, workspaceId, randomUUID()],
      ]) {
        await expectRejectedQuery(runner, () => runner.query(
          `INSERT INTO leadflow_agents (id, tenant_id, workspace_id, agency_client_id, company_context_id)
           VALUES ($1,$2,$3,$4,$5)`,
          [randomUUID(), wrongTenant, wrongWorkspace, wrongClient, companyAId],
        ), '23503');
      }

      await migration.down(runner);
      await migration.up(runner);
      const rerun = await runner.query(
        `SELECT scope_kind FROM crm_pipelines WHERE id=$1`, [pipelineId],
      ) as Array<{ scope_kind: string }>;
      expect(rerun[0]?.scope_kind).toBe('legacy_unassigned');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});

async function createLegacySchema(runner: QueryRunner) {
  await runner.query(`
    CREATE TABLE agency_client_company_contexts (
      id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid NOT NULL,
      UNIQUE (id, tenant_id, workspace_id, agency_client_id)
    );
    CREATE TABLE crm_pipelines (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL);
    CREATE TABLE crm_stages (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, pipeline_id uuid NOT NULL);
    CREATE TABLE inbox_conversations (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, agency_client_id uuid, company_context_id uuid, scope_kind varchar(24));
    CREATE TABLE crm_opportunities (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, pipeline_id uuid NOT NULL, stage_id uuid NOT NULL, inbox_conversation_id uuid);
    CREATE TABLE crm_tags (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL);
    CREATE TABLE scheduled_items (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, source_conversation_id uuid, source_opportunity_id uuid);
    CREATE TABLE leadflow_agents (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, agency_client_id uuid);
    CREATE TABLE leadflow_automations (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, agency_client_id uuid);
    CREATE TABLE leadflow_analytics_views (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, agency_client_id uuid);
    CREATE TABLE leadflow_intelligence_recommendations (id uuid PRIMARY KEY, tenant_id uuid NOT NULL, workspace_id uuid NOT NULL, agency_client_id uuid);
  `);
}

async function expectRejectedQuery(
  runner: QueryRunner,
  query: () => Promise<unknown>,
  code: string,
) {
  const savepoint = `cc2f_reject_${randomUUID().replace(/-/g, '')}`;
  await runner.query(`SAVEPOINT "${savepoint}"`);
  await expect(query()).rejects.toMatchObject({ code });
  await runner.query(`ROLLBACK TO SAVEPOINT "${savepoint}"`);
  await runner.query(`RELEASE SAVEPOINT "${savepoint}"`);
}
