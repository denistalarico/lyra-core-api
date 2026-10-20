import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CA11: canonical contact data stays in contacts; this is exclusive operational ownership. */
export class IsolateLeadflowContactsByCompany1800050000000 implements MigrationInterface {
  name = 'IsolateLeadflowContactsByCompany1800050000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`CREATE TABLE IF NOT EXISTS leadflow_contact_companies (
      contact_id uuid PRIMARY KEY REFERENCES contacts(id) ON DELETE CASCADE,
      tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid NOT NULL,
      company_context_id uuid NOT NULL REFERENCES agency_client_company_contexts(id),
      scope_kind varchar(24) NOT NULL DEFAULT 'company' CHECK (scope_kind='company'),
      created_at timestamptz NOT NULL DEFAULT now()
    )`);
    await runner.query(`CREATE INDEX IF NOT EXISTS idx_leadflow_contact_companies_scope
      ON leadflow_contact_companies(tenant_id,workspace_id,agency_client_id,company_context_id)`);
    await runner.query(`CREATE OR REPLACE FUNCTION guard_leadflow_contact_company() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF TG_OP='UPDATE' AND (NEW.contact_id,NEW.tenant_id,NEW.workspace_id,NEW.agency_client_id,NEW.company_context_id)
          IS DISTINCT FROM (OLD.contact_id,OLD.tenant_id,OLD.workspace_id,OLD.agency_client_id,OLD.company_context_id) THEN
          RAISE EXCEPTION 'leadflow_contact_company_immutable' USING ERRCODE='23514';
        END IF;
        IF NOT EXISTS(SELECT 1 FROM contacts c JOIN agency_client_company_contexts cc
          ON cc.id=NEW.company_context_id AND cc.tenant_id=c.tenant_id AND cc.workspace_id=c.workspace_id
          AND cc.agency_client_id=NEW.agency_client_id
          WHERE c.id=NEW.contact_id AND c.tenant_id=NEW.tenant_id AND c.workspace_id=NEW.workspace_id
          AND c.lifecycle_stage <> 'internal' AND NOT ('internal'=ANY(c.lifecycle_stages))) THEN
          RAISE EXCEPTION 'leadflow_contact_company_scope' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    await runner.query(
      'DROP TRIGGER IF EXISTS trg_guard_leadflow_contact_company ON leadflow_contact_companies',
    );
    await runner.query(`CREATE TRIGGER trg_guard_leadflow_contact_company BEFORE INSERT OR UPDATE
      ON leadflow_contact_companies FOR EACH ROW EXECUTE FUNCTION guard_leadflow_contact_company()`);
    // No guessing from an employer/PF-PJ link or the old per-client list.
    await runner.query(`WITH refs AS (
      SELECT tenant_id,workspace_id,contact_id,agency_client_id,company_context_id,scope_kind FROM inbox_conversations WHERE contact_id IS NOT NULL
      UNION ALL
      SELECT tenant_id,workspace_id,contact_id,agency_client_id,company_context_id,scope_kind FROM crm_opportunities WHERE contact_id IS NOT NULL
    ), unambiguous AS (
      SELECT tenant_id,workspace_id,contact_id,min(agency_client_id::text)::uuid agency_client_id,
        min(company_context_id::text)::uuid company_context_id FROM refs GROUP BY tenant_id,workspace_id,contact_id
      HAVING bool_and(COALESCE(scope_kind='company' AND agency_client_id IS NOT NULL AND company_context_id IS NOT NULL,false))
        AND count(DISTINCT agency_client_id)=1 AND count(DISTINCT company_context_id)=1
    ) INSERT INTO leadflow_contact_companies(contact_id,tenant_id,workspace_id,agency_client_id,company_context_id)
      SELECT r.contact_id,r.tenant_id,r.workspace_id,r.agency_client_id,r.company_context_id FROM unambiguous r
      JOIN contacts c ON c.id=r.contact_id AND c.tenant_id=r.tenant_id AND c.workspace_id=r.workspace_id
        AND c.lifecycle_stage <> 'internal' AND NOT ('internal'=ANY(c.lifecycle_stages))
      JOIN agency_client_company_contexts cc ON cc.id=r.company_context_id AND cc.agency_client_id=r.agency_client_id
        AND cc.tenant_id=r.tenant_id AND cc.workspace_id=r.workspace_id ON CONFLICT DO NOTHING`);
    // Existing ingestion/commands keep their own implementation. Locking the canonical contact
    // serializes first association across companies, including concurrent channel ingestion.
    await runner.query(`CREATE OR REPLACE FUNCTION bind_leadflow_operational_contact() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN
        IF NEW.contact_id IS NULL THEN RETURN NEW; END IF;
        PERFORM 1 FROM contacts WHERE id=NEW.contact_id AND tenant_id=NEW.tenant_id AND workspace_id=NEW.workspace_id FOR NO KEY UPDATE;
        IF NOT FOUND THEN RAISE EXCEPTION 'leadflow_contact_scope' USING ERRCODE='23514'; END IF;
        -- Internal staff contacts are a workspace-wide suppression identity, not a CRM lead.
        -- Preserve that safety gate across channels without assigning it to the first company.
        IF EXISTS(SELECT 1 FROM contacts WHERE id=NEW.contact_id AND
          (lifecycle_stage='internal' OR 'internal'=ANY(lifecycle_stages))) THEN
          IF TG_TABLE_NAME='inbox_conversations' OR COALESCE(NEW.scope_kind,'') <> 'company' THEN RETURN NEW; END IF;
          RAISE EXCEPTION 'leadflow_internal_contact_not_crm_lead' USING ERRCODE='23514';
        END IF;
        IF COALESCE(NEW.scope_kind,'') <> 'company' THEN
          IF EXISTS(SELECT 1 FROM leadflow_contact_companies WHERE contact_id=NEW.contact_id) THEN
            RAISE EXCEPTION 'leadflow_contact_company_scope' USING ERRCODE='23514';
          END IF;
          RETURN NEW;
        END IF;
        IF EXISTS(SELECT 1 FROM (
          SELECT tenant_id,workspace_id,contact_id,agency_client_id,company_context_id,scope_kind FROM inbox_conversations
          UNION ALL SELECT tenant_id,workspace_id,contact_id,agency_client_id,company_context_id,scope_kind FROM crm_opportunities
        ) r WHERE r.contact_id=NEW.contact_id AND
          (r.tenant_id,r.workspace_id,r.agency_client_id,r.company_context_id,r.scope_kind) IS DISTINCT FROM
          (NEW.tenant_id,NEW.workspace_id,NEW.agency_client_id,NEW.company_context_id,'company'::varchar)) THEN
          RAISE EXCEPTION 'leadflow_contact_company_ambiguous' USING ERRCODE='23514';
        END IF;
        INSERT INTO leadflow_contact_companies(contact_id,tenant_id,workspace_id,agency_client_id,company_context_id)
          VALUES(NEW.contact_id,NEW.tenant_id,NEW.workspace_id,NEW.agency_client_id,NEW.company_context_id) ON CONFLICT DO NOTHING;
        IF NOT EXISTS(SELECT 1 FROM leadflow_contact_companies WHERE contact_id=NEW.contact_id AND tenant_id=NEW.tenant_id
          AND workspace_id=NEW.workspace_id AND agency_client_id=NEW.agency_client_id AND company_context_id=NEW.company_context_id) THEN
          RAISE EXCEPTION 'leadflow_contact_company_scope' USING ERRCODE='23514';
        END IF;
        RETURN NEW;
      END $$`);
    for (const table of ['inbox_conversations', 'crm_opportunities']) {
      await runner.query(
        `DROP TRIGGER IF EXISTS trg_bind_leadflow_contact ON ${table}`,
      );
      await runner.query(`CREATE TRIGGER trg_bind_leadflow_contact AFTER INSERT OR UPDATE OF contact_id,agency_client_id,company_context_id,scope_kind
        ON ${table} FOR EACH ROW EXECUTE FUNCTION bind_leadflow_operational_contact()`);
    }
  }
  async down(runner: QueryRunner): Promise<void> {
    for (const table of ['inbox_conversations', 'crm_opportunities'])
      await runner.query(
        `DROP TRIGGER IF EXISTS trg_bind_leadflow_contact ON ${table}`,
      );
    await runner.query(
      'DROP FUNCTION IF EXISTS bind_leadflow_operational_contact()',
    );
    await runner.query('DROP TABLE IF EXISTS leadflow_contact_companies');
    await runner.query(
      'DROP FUNCTION IF EXISTS guard_leadflow_contact_company()',
    );
  }
}
