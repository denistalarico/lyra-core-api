import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * IX2 — Lyra follow-up templates (`inbox_followup_templates`).
 *
 * Additive and idempotent: the PostgreSQL specs run `up()` against a database
 * the runner already migrated. The scope CHECK mirrors the operational Inbox
 * contract — agency (both ids null) or company (both set); the legacy bucket is
 * never written by request-driven code.
 */
export class CreateInboxFollowupTemplates1800300000000 implements MigrationInterface {
  name = 'CreateInboxFollowupTemplates1800300000000';

  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS inbox_followup_templates (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      tenant_id uuid NOT NULL,
      workspace_id uuid NOT NULL,
      agency_client_id uuid,
      company_context_id uuid,
      scope_kind varchar(24) NOT NULL,
      name varchar(120) NOT NULL,
      step_key varchar(8) NOT NULL,
      channel_types jsonb NOT NULL DEFAULT '[]'::jsonb,
      body text NOT NULL,
      is_active boolean NOT NULL DEFAULT true,
      sort_order integer NOT NULL DEFAULT 0,
      created_at timestamptz NOT NULL DEFAULT now(),
      updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_inbox_followup_templates_scope" CHECK (
        (scope_kind = 'agency' AND agency_client_id IS NULL AND company_context_id IS NULL)
        OR (scope_kind = 'company' AND agency_client_id IS NOT NULL AND company_context_id IS NOT NULL)
      ),
      CONSTRAINT "CK_inbox_followup_templates_step" CHECK (step_key IN ('d0','d1','d3','d7','any')),
      CONSTRAINT "CK_inbox_followup_templates_channels" CHECK (jsonb_typeof(channel_types) = 'array'),
      CONSTRAINT "CK_inbox_followup_templates_name" CHECK (length(btrim(name)) > 0),
      CONSTRAINT "CK_inbox_followup_templates_body" CHECK (length(btrim(body)) > 0 AND length(body) <= 1000)
    )`);
    await runner.query(
      'CREATE INDEX IF NOT EXISTS idx_inbox_followup_templates_scope ON inbox_followup_templates(tenant_id, workspace_id, agency_client_id, company_context_id, sort_order)',
    );
  }

  async down(runner: QueryRunner): Promise<void> {
    await runner.query('DROP TABLE IF EXISTS inbox_followup_templates');
  }
}
