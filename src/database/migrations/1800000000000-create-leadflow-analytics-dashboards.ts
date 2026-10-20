import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CA12: additive; legacy leadflow_analytics_views remains untouched. */
export class CreateLeadflowAnalyticsDashboards1800000000000 implements MigrationInterface {
  name = 'CreateLeadflowAnalyticsDashboards1800000000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS leadflow_analytics_dashboards (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid, company_context_id uuid,
      name varchar(120) NOT NULL, description varchar(500),
      is_default boolean NOT NULL DEFAULT false, channel_key varchar(32),
      channels jsonb NOT NULL DEFAULT '[]'::jsonb,
      layout jsonb NOT NULL DEFAULT '{"version":1,"sections":[]}'::jsonb,
      created_by_id uuid, created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_leadflow_dashboards_scope" CHECK ((agency_client_id IS NULL) = (company_context_id IS NULL)),
      CONSTRAINT "CK_leadflow_dashboards_name" CHECK (length(btrim(name)) > 0),
      CONSTRAINT "CK_leadflow_dashboards_channels" CHECK (jsonb_typeof(channels) = 'array'),
      CONSTRAINT "CK_leadflow_dashboards_layout" CHECK (jsonb_typeof(layout) = 'object'),
      CONSTRAINT "CK_leadflow_dashboards_channel" CHECK (channel_key IS NULL OR channel_key IN ('overview','service','commercial','lead_quality','automations','recommendations'))
    )`);
    await runner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_leadflow_analytics_dashboards_scope" ON leadflow_analytics_dashboards (tenant_id, workspace_id, agency_client_id, company_context_id, created_at)`,
    );
    // COALESCE covers the agency's NULL/NULL scope as well as company scopes.
    for (const [suffix, expression, predicate] of [
      ['name', 'lower(btrim(name))', 'true'],
      ['default', 'is_default', 'is_default'],
      ['channel', 'channel_key', 'channel_key IS NOT NULL'],
    ]) {
      await runner.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_leadflow_dashboards_${suffix}" ON leadflow_analytics_dashboards
        (tenant_id, workspace_id, COALESCE(agency_client_id,'00000000-0000-0000-0000-000000000000'::uuid),
         COALESCE(company_context_id,'00000000-0000-0000-0000-000000000000'::uuid), ${expression}) WHERE ${predicate}`);
    }
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE IF EXISTS leadflow_analytics_dashboards');
  }
}
