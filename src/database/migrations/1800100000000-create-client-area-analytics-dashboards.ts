import type { MigrationInterface, QueryRunner } from 'typeorm';
/** D-19: arrangement only. No product data or personal dashboards copied to Agency. */
export class CreateClientAreaAnalyticsDashboards1800100000000 implements MigrationInterface {
  name = 'CreateClientAreaAnalyticsDashboards1800100000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS client_area_analytics_dashboards (
   id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
   agency_client_id uuid NOT NULL,company_context_id uuid NOT NULL,
   owner_surface varchar(16) NOT NULL,owner_user_id uuid,is_default boolean NOT NULL DEFAULT false,
   name varchar(120) NOT NULL,layout jsonb NOT NULL DEFAULT '{"version":1,"sections":[]}'::jsonb,
   created_at timestamptz NOT NULL DEFAULT now(),updated_at timestamptz NOT NULL DEFAULT now(),
   CONSTRAINT "CK_ca_dashboards_owner" CHECK ((owner_surface='agency' AND owner_user_id IS NULL) OR (owner_surface='client_area' AND owner_user_id IS NOT NULL AND NOT is_default)),
   CONSTRAINT "CK_ca_dashboards_name" CHECK (length(btrim(name))>0),
   CONSTRAINT "CK_ca_dashboards_layout" CHECK (jsonb_typeof(layout)='object' AND layout ? 'version' AND layout ? 'sections' AND layout->'version'='1'::jsonb AND jsonb_typeof(layout->'sections')='array')
  )`);
    await runner.query(
      'CREATE INDEX IF NOT EXISTS "IDX_ca_dashboards_scope_owner" ON client_area_analytics_dashboards(tenant_id,workspace_id,agency_client_id,company_context_id,owner_surface,owner_user_id,created_at)',
    );
    await runner.query(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_ca_dashboards_default" ON client_area_analytics_dashboards(tenant_id,workspace_id,agency_client_id,company_context_id) WHERE is_default',
    );
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE IF EXISTS client_area_analytics_dashboards');
  }
}
