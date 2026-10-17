import { createHash } from 'node:crypto';
import type { MigrationInterface, QueryRunner } from 'typeorm';
import { CLIENT_AREA_MODULE_KEYS } from '../../modules/client-area/client-area.types';

const roles = "('client_owner','client_member')";
const legacy = "('client_admin','client_operator','client_viewer')";
const actions =
  "'invited','invitation_resent','invitation_revoked','invitation_accepted','invitation_acceptance_blocked','role_changed','membership_revoked','access_removed'";
export const ESSENTIAL_PROCESSING_PURPOSE = 'client_area_essential_processing';
const placeholder =
  'AVISO PROVISÓRIO — texto jurídico de tratamento essencial pendente de aprovação (EXT-CA-4). Não liberar produtos a clientes reais.';

export class ClientAreaAccessModelV21799700000000 implements MigrationInterface {
  name = 'ClientAreaAccessModelV21799700000000';
  async up(q: QueryRunner): Promise<void> {
    const moduleKeys = CLIENT_AREA_MODULE_KEYS.map((key) => `'${key}'`).join(
      ',',
    );
    await q.query(`ALTER TABLE client_area_company_settings
      ADD COLUMN IF NOT EXISTS module_settings jsonb NOT NULL DEFAULT '{}',
      ADD COLUMN IF NOT EXISTS allow_ai_cost_actions boolean NOT NULL DEFAULT false,
      ADD COLUMN IF NOT EXISTS allow_media_spend_actions boolean NOT NULL DEFAULT false`);
    await q.query(
      `ALTER TABLE client_area_invitations ADD COLUMN IF NOT EXISTS module_levels jsonb NOT NULL DEFAULT '{}'`,
    );
    // Only absent module entries are filled, so rerunning up cannot overwrite Agency choices.
    await q.query(`UPDATE client_area_company_settings s SET module_settings =
      (SELECT jsonb_object_agg(k, jsonb_build_object('enabled', CASE k WHEN 'approvals' THEN s.approvals_enabled WHEN 'conversations' THEN s.conversations_enabled ELSE k IN ('overview','analytics','settings') END,
      'defaultLevel', CASE s.default_role WHEN 'client_admin' THEN 'manager' WHEN 'client_operator' THEN 'operator' ELSE 'viewer' END)) FROM unnest(ARRAY[${moduleKeys}]) k) || s.module_settings`);
    await q.query(`CREATE TABLE IF NOT EXISTS client_area_member_module_access (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), membership_id uuid NOT NULL REFERENCES client_area_memberships(id) ON DELETE RESTRICT,
      module_key varchar(40) NOT NULL CHECK (module_key IN (${moduleKeys})),
      level varchar(16) NOT NULL CHECK (level IN ('viewer','operator','manager')),
      granted_by_user_id uuid, granted_by_surface varchar(16) NOT NULL CHECK (granted_by_surface IN ('agency','client_area')),
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_client_area_member_module_access" UNIQUE (membership_id,module_key))`);
    await q.query(`INSERT INTO client_area_member_module_access (membership_id,module_key,level,granted_by_user_id,granted_by_surface)
      SELECT m.id, entry.key, CASE m.role WHEN 'client_admin' THEN 'manager' WHEN 'client_operator' THEN 'operator' ELSE 'viewer' END, m.granted_by_user_id, 'agency'
      FROM client_area_memberships m JOIN client_area_company_settings s ON s.company_context_id=m.company_context_id,
      LATERAL jsonb_each(s.module_settings) entry
      WHERE m.role IN ${legacy} AND entry.value->>'enabled'='true'
      ON CONFLICT (membership_id,module_key) DO NOTHING`);
    await q.query(
      `ALTER TABLE client_area_memberships DROP CONSTRAINT IF EXISTS "CK_client_area_memberships_role"`,
    );
    await q.query(
      `ALTER TABLE client_area_invitations DROP CONSTRAINT IF EXISTS "CK_client_area_invitations_role"`,
    );
    await q.query(`UPDATE client_area_memberships m SET role=CASE WHEN role='client_admin'
      AND (SELECT count(*) FROM client_area_memberships a WHERE a.company_context_id=m.company_context_id AND a.status='active')=1 AND m.status='active'
      THEN 'client_owner' ELSE 'client_member' END WHERE role IN ${legacy}`);
    await q.query(`UPDATE client_area_invitations i SET module_levels=(SELECT COALESCE(jsonb_object_agg(e.key, CASE i.role WHEN 'client_admin' THEN 'manager' WHEN 'client_operator' THEN 'operator' ELSE 'viewer' END),'{}')
      FROM client_area_company_settings s, LATERAL jsonb_each(s.module_settings) e WHERE s.company_context_id=i.company_context_id AND e.value->>'enabled'='true') WHERE role IN ${legacy}`);
    await q.query(`UPDATE client_area_invitations i SET role=CASE WHEN role='client_admin' AND status='pending'
      AND NOT EXISTS (SELECT 1 FROM client_area_memberships m WHERE m.company_context_id=i.company_context_id AND m.status='active')
      AND (SELECT count(*) FROM client_area_invitations a WHERE a.company_context_id=i.company_context_id AND a.status='pending' AND a.expires_at>now())=1
      THEN 'client_owner' ELSE 'client_member' END WHERE role IN ${legacy}`);
    await q.query(
      `ALTER TABLE client_area_memberships ADD CONSTRAINT "CK_client_area_memberships_role" CHECK (role IN ${roles})`,
    );
    await q.query(
      `ALTER TABLE client_area_invitations ADD CONSTRAINT "CK_client_area_invitations_role" CHECK (role IN ${roles})`,
    );
    await q.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_area_owner_active" ON client_area_memberships(company_context_id) WHERE status='active' AND role='client_owner'`,
    );
    await q.query(
      `ALTER TABLE client_area_member_events DROP CONSTRAINT IF EXISTS "CK_client_area_member_events_action"`,
    );
    await q.query(
      `ALTER TABLE client_area_member_events ADD CONSTRAINT "CK_client_area_member_events_action" CHECK (action IN (${actions},'module_access_changed','owner_transferred'))`,
    );
    await q.query(
      `ALTER TABLE client_area_member_events DROP CONSTRAINT IF EXISTS "CK_client_area_member_events_roles"`,
    );
    await q.query(
      `ALTER TABLE client_area_member_events ADD CONSTRAINT "CK_client_area_member_events_roles" CHECK ((previous_role IS NULL OR previous_role IN ('client_owner','client_member','client_admin','client_operator','client_viewer')) AND (new_role IS NULL OR new_role IN ('client_owner','client_member','client_admin','client_operator','client_viewer')))`,
    );
    await q.query(`ALTER TABLE leadflow_telemetry_consents ADD COLUMN IF NOT EXISTS company_context_id uuid,
      ADD COLUMN IF NOT EXISTS actor_surface varchar(16) NOT NULL DEFAULT 'agency' CHECK (actor_surface IN ('agency','client_area','system'))`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_lf_consents_company_purpose_time" ON leadflow_telemetry_consents(tenant_id,workspace_id,company_context_id,purpose_key,occurred_at DESC)`,
    );
    await q.query(
      `INSERT INTO leadflow_telemetry_consent_notices (purpose_key,version,locale,title,body,content_hash,categories,retention_days,k_anonymity_threshold,legal_review_status,status,effective_at)
      VALUES ($1,1,'pt-BR','Tratamento essencial de dados',$2,$3,'[]',365,5,'pending','active',now()) ON CONFLICT (purpose_key,version,locale) DO NOTHING`,
      [
        ESSENTIAL_PROCESSING_PURPOSE,
        placeholder,
        createHash('sha256').update(placeholder).digest('hex'),
      ],
    );
    await q.query(`CREATE TABLE IF NOT EXISTS audit_change_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, workspace_id uuid,
      agency_client_id uuid, company_context_id uuid, actor_user_id uuid,
      actor_surface varchar(16) NOT NULL CHECK (actor_surface IN ('agency','client_area','system')),
      module_key varchar(80) NOT NULL, entity_type varchar(80) NOT NULL, entity_id uuid,
      action varchar(16) NOT NULL CHECK (action IN ('create','update','delete','archive','restore','state_change')),
      changed_fields jsonb NOT NULL DEFAULT '[]', diff jsonb NOT NULL DEFAULT '{}', request_id varchar(128),
      ip varchar(64), user_agent varchar(512), internal boolean NOT NULL DEFAULT false, occurred_at timestamptz NOT NULL DEFAULT now())`);
    await q.query(
      `CREATE INDEX IF NOT EXISTS "IDX_audit_change_events_client_time" ON audit_change_events(tenant_id,workspace_id,agency_client_id,occurred_at DESC)`,
    );
    // Search path is pinned to this migration's schema, including isolated PostgreSQL specs.
    const [{ current_schema: schema }] = (await q.query(
      'SELECT current_schema()',
    )) as { current_schema: string }[];
    const quoted = '"' + schema.replaceAll('"', '""') + '"';
    await q.query(`CREATE OR REPLACE FUNCTION audit_change_append_only() RETURNS trigger LANGUAGE plpgsql AS $body$
      DECLARE stack text;
      BEGIN
        GET DIAGNOSTICS stack = PG_CONTEXT;
        IF TG_OP='DELETE' AND current_setting('lyra.audit_purge',true)='on'
          AND stack ~ 'audit_change_purge\\(integer\\)' THEN RETURN OLD; END IF;
        RAISE EXCEPTION 'audit_change_events is append-only' USING ERRCODE='23514';
      END $body$`);
    await q.query(
      `DROP TRIGGER IF EXISTS audit_change_events_append_only ON audit_change_events`,
    );
    await q.query(
      `CREATE TRIGGER audit_change_events_append_only BEFORE UPDATE OR DELETE ON audit_change_events FOR EACH ROW EXECUTE FUNCTION audit_change_append_only()`,
    );
    await q.query(`CREATE OR REPLACE FUNCTION audit_change_purge(retention_months integer DEFAULT 12) RETURNS bigint
      LANGUAGE plpgsql SECURITY DEFINER SET search_path=${quoted},pg_temp AS $body$
      DECLARE removed bigint;
      BEGIN
        IF retention_months IS NULL OR retention_months<1 OR retention_months>120 THEN RAISE EXCEPTION 'Invalid audit retention'; END IF;
        PERFORM set_config('lyra.audit_purge','on',true);
        DELETE FROM audit_change_events WHERE occurred_at < now()-make_interval(months=>retention_months);
        GET DIAGNOSTICS removed = ROW_COUNT;
        PERFORM set_config('lyra.audit_purge','off',true);
        RETURN removed;
      END $body$`);
    await q.query(`CREATE OR REPLACE FUNCTION client_area_consent_append_only() RETURNS trigger LANGUAGE plpgsql AS $body$
      BEGIN IF OLD.company_context_id IS NOT NULL THEN RAISE EXCEPTION 'Client Area consent is append-only' USING ERRCODE='23514'; END IF;
      IF TG_OP='DELETE' THEN RETURN OLD; END IF; RETURN NEW; END $body$`);
    await q.query(
      `DROP TRIGGER IF EXISTS client_area_consent_append_only ON leadflow_telemetry_consents`,
    );
    await q.query(
      `CREATE TRIGGER client_area_consent_append_only BEFORE UPDATE OR DELETE ON leadflow_telemetry_consents FOR EACH ROW EXECUTE FUNCTION client_area_consent_append_only()`,
    );
  }
  async down(q: QueryRunner): Promise<void> {
    // Audit events, consent notices/decisions, company grain and append-only protections survive rollback.
    await q.query('DROP INDEX IF EXISTS "UQ_client_area_owner_active"');
    for (const table of ['client_area_memberships', 'client_area_invitations'])
      await q.query(
        `ALTER TABLE ${table} DROP CONSTRAINT IF EXISTS "CK_${table}_role"`,
      );
    await q.query(`UPDATE client_area_memberships m SET role=CASE WHEN role='client_owner' OR EXISTS (SELECT 1 FROM client_area_member_module_access a WHERE a.membership_id=m.id AND a.level='manager') THEN 'client_admin'
      WHEN EXISTS (SELECT 1 FROM client_area_member_module_access a WHERE a.membership_id=m.id AND a.level='operator') THEN 'client_operator' ELSE 'client_viewer' END WHERE role IN ${roles}`);
    await q.query(
      `UPDATE client_area_invitations SET role=CASE WHEN role='client_owner' OR EXISTS (SELECT 1 FROM jsonb_each_text(module_levels) v WHERE v.value='manager') THEN 'client_admin' WHEN EXISTS (SELECT 1 FROM jsonb_each_text(module_levels) v WHERE v.value='operator') THEN 'client_operator' ELSE 'client_viewer' END WHERE role IN ${roles}`,
    );
    for (const table of ['client_area_memberships', 'client_area_invitations'])
      await q.query(
        `ALTER TABLE ${table} ADD CONSTRAINT "CK_${table}_role" CHECK (role IN ${legacy})`,
      );
    await q.query(
      'ALTER TABLE client_area_member_events DROP CONSTRAINT IF EXISTS "CK_client_area_member_events_action"',
    );
    await q.query(
      `ALTER TABLE client_area_member_events ADD CONSTRAINT "CK_client_area_member_events_action" CHECK (action IN (${actions})) NOT VALID`,
    );
    await q.query(
      'ALTER TABLE client_area_member_events DROP CONSTRAINT IF EXISTS "CK_client_area_member_events_roles"',
    );
    await q.query(
      `ALTER TABLE client_area_member_events ADD CONSTRAINT "CK_client_area_member_events_roles" CHECK ((previous_role IS NULL OR previous_role IN ${legacy}) AND (new_role IS NULL OR new_role IN ${legacy})) NOT VALID`,
    );
    await q.query('DROP TABLE IF EXISTS client_area_member_module_access');
    await q.query(
      'ALTER TABLE client_area_invitations DROP COLUMN IF EXISTS module_levels',
    );
    await q.query(
      'ALTER TABLE client_area_company_settings DROP COLUMN IF EXISTS module_settings, DROP COLUMN IF EXISTS allow_ai_cost_actions, DROP COLUMN IF EXISTS allow_media_spend_actions',
    );
  }
}
