import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyClientCompanyProducts1799600000000 implements MigrationInterface {
  name = 'CreateAgencyClientCompanyProducts1799600000000';
  async up(q: QueryRunner): Promise<void> {
    await q.query(`ALTER TABLE agency_clients
      ADD COLUMN IF NOT EXISTS archive_requested_at timestamptz,
      ADD COLUMN IF NOT EXISTS archive_requested_by uuid,
      ADD COLUMN IF NOT EXISTS archive_mode varchar(30) CHECK (archive_mode IN ('immediate','after_last_publication')),
      ADD COLUMN IF NOT EXISTS archive_status varchar(20) NOT NULL DEFAULT 'none' CHECK (archive_status IN ('none','scheduled','blocked'))`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_company_contexts_product_scope"
      ON agency_client_company_contexts (id, tenant_id, workspace_id, agency_client_id)`);
    await q.query(`CREATE TABLE IF NOT EXISTS agency_client_company_products (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid NOT NULL, company_context_id uuid NOT NULL,
      product_key varchar(30) NOT NULL CHECK (product_key IN ('leadflow','social')),
      status varchar(30) NOT NULL CHECK (status IN ('active','removal_scheduled','removal_blocked','removed')),
      activated_at timestamptz NOT NULL DEFAULT now(), activated_by uuid,
      removal_requested_at timestamptz, removal_requested_by uuid,
      removal_mode varchar(30) CHECK (removal_mode IN ('immediate','after_last_publication')),
      removed_at timestamptz, removed_by uuid, metadata jsonb NOT NULL DEFAULT '{}',
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "FK_company_products_context_scope" FOREIGN KEY (company_context_id,tenant_id,workspace_id,agency_client_id)
        REFERENCES agency_client_company_contexts(id,tenant_id,workspace_id,agency_client_id) ON DELETE RESTRICT,
      CONSTRAINT "CK_company_products_removed" CHECK ((status = 'removed') = (removed_at IS NOT NULL))
    )`);
    await q.query(`CREATE UNIQUE INDEX IF NOT EXISTS "UQ_company_products_live" ON agency_client_company_products
      (company_context_id,product_key) WHERE status <> 'removed'`);
    await q.query(`CREATE INDEX IF NOT EXISTS "IDX_company_products_scope" ON agency_client_company_products
      (tenant_id,workspace_id,agency_client_id,product_key,status)`);
    await q.query(`CREATE TABLE IF NOT EXISTS agency_client_company_product_events (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      agency_client_id uuid NOT NULL, company_context_id uuid NOT NULL, product_id uuid NOT NULL,
      product_key varchar(30) NOT NULL CHECK (product_key IN ('leadflow','social')),
      action varchar(40) NOT NULL, actor_user_id uuid, metadata jsonb NOT NULL DEFAULT '{}',
      occurred_at timestamptz NOT NULL DEFAULT now(),
      FOREIGN KEY (product_id) REFERENCES agency_client_company_products(id) ON DELETE RESTRICT
    )`);
    await q.query(`CREATE OR REPLACE FUNCTION prevent_company_product_event_mutation() RETURNS trigger LANGUAGE plpgsql AS $$
      BEGIN RAISE EXCEPTION 'company product events are append-only'; END; $$`);
    await q.query(
      `DROP TRIGGER IF EXISTS company_product_events_append_only ON agency_client_company_product_events`,
    );
    await q.query(`CREATE TRIGGER company_product_events_append_only BEFORE UPDATE OR DELETE ON agency_client_company_product_events
      FOR EACH ROW EXECUTE FUNCTION prevent_company_product_event_mutation()`);
    await q.query(`INSERT INTO agency_client_company_products(tenant_id,workspace_id,agency_client_id,company_context_id,product_key,status,metadata)
      SELECT c.tenant_id,c.workspace_id,c.agency_client_id,c.id,e.product_key,'active','{"backfill":true}'::jsonb
      FROM agency_client_company_contexts c
      JOIN agency_clients a ON a.id=c.agency_client_id AND a.tenant_id=c.tenant_id AND a.workspace_id=c.workspace_id
      JOIN contacts o ON o.id=c.company_contact_id AND o.tenant_id=c.tenant_id AND o.workspace_id=c.workspace_id
      JOIN tenant_product_entitlements e ON e.tenant_id=a.managed_tenant_id
      WHERE c.status='active' AND c.archived_at IS NULL AND a.status='active' AND a.archived_at IS NULL
        AND o.type='organization' AND o.status='active' AND e.product_key IN ('leadflow','social')
        AND e.status IN ('active','trial') AND (e.starts_at IS NULL OR e.starts_at<=now())
        AND (e.ends_at IS NULL OR e.ends_at>now())
        AND (e.status<>'trial' OR e.trial_ends_at IS NULL OR e.trial_ends_at>now())
        AND NOT EXISTS (SELECT 1 FROM agency_client_company_products p WHERE p.company_context_id=c.id AND p.product_key=e.product_key)
      ON CONFLICT (company_context_id,product_key) WHERE status<>'removed' DO NOTHING`);
    await q.query(`INSERT INTO agency_client_company_product_events(tenant_id,workspace_id,agency_client_id,company_context_id,product_id,product_key,action)
      SELECT p.tenant_id,p.workspace_id,p.agency_client_id,p.company_context_id,p.id,p.product_key,'backfilled'
      FROM agency_client_company_products p WHERE p.metadata->>'backfill'='true'
      AND NOT EXISTS(SELECT 1 FROM agency_client_company_product_events e WHERE e.product_id=p.id AND e.action='backfilled')`);
    // INSERT barriers close the request-preflight race without retaining an
    // extra connection while an HTTP handler runs. Execution updates continue.
    await q.query(`CREATE OR REPLACE FUNCTION guard_company_product_social_insert() RETURNS trigger LANGUAGE plpgsql AS $$
      DECLARE company_id uuid; client_status text; archival text; product_status text;
      BEGIN
        IF NEW.agency_client_id IS NULL OR current_setting('lyra.company_product_lifecycle',true)='on' THEN RETURN NEW; END IF;
        IF TG_TABLE_NAME='social_publications' THEN
          EXECUTE format('SELECT p.company_context_id FROM %I.social_content_items c JOIN %I.social_plans p ON p.id=c.plan_id AND p.tenant_id=c.tenant_id AND p.workspace_id=c.workspace_id AND p.agency_client_id=c.agency_client_id WHERE c.id=$1 AND c.tenant_id=$2 AND c.workspace_id=$3 AND c.agency_client_id=$4',TG_TABLE_SCHEMA,TG_TABLE_SCHEMA)
            INTO company_id USING NEW.content_item_id,NEW.tenant_id,NEW.workspace_id,NEW.agency_client_id;
        ELSE company_id=NEW.company_context_id; END IF;
        EXECUTE format('SELECT status,archive_status FROM %I.agency_clients WHERE id=$1 AND tenant_id=$2 AND workspace_id=$3 FOR SHARE',TG_TABLE_SCHEMA)
          INTO client_status,archival USING NEW.agency_client_id,NEW.tenant_id,NEW.workspace_id;
        IF client_status IS DISTINCT FROM 'active' OR company_id IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0404', MESSAGE='company_product_unavailable'; END IF;
        IF archival IS DISTINCT FROM 'none' THEN RAISE EXCEPTION USING ERRCODE='P0409', MESSAGE='client_archive_scheduled'; END IF;
        EXECUTE format('SELECT status FROM %I.agency_client_company_products WHERE tenant_id=$1 AND workspace_id=$2 AND agency_client_id=$3 AND company_context_id=$4 AND product_key=''social'' AND status<>''removed''',TG_TABLE_SCHEMA)
          INTO product_status USING NEW.tenant_id,NEW.workspace_id,NEW.agency_client_id,company_id;
        IF product_status IS NULL THEN RAISE EXCEPTION USING ERRCODE='P0404', MESSAGE='company_product_unavailable'; END IF;
        IF product_status<>'active' THEN RAISE EXCEPTION USING ERRCODE='P0409', MESSAGE='company_product_removal_scheduled'; END IF;
        RETURN NEW;
      END; $$`);
    for (const table of ['social_publications', 'social_approval_requests']) {
      await q.query(
        `DROP TRIGGER IF EXISTS "TR_company_product_social_insert" ON "${table}"`,
      );
      await q.query(
        `CREATE TRIGGER "TR_company_product_social_insert" BEFORE INSERT ON "${table}" FOR EACH ROW EXECUTE FUNCTION guard_company_product_social_insert()`,
      );
    }
  }
  async down(q: QueryRunner): Promise<void> {
    for (const table of ['social_publications', 'social_approval_requests'])
      await q.query(
        `DROP TRIGGER IF EXISTS "TR_company_product_social_insert" ON "${table}"`,
      );
    await q.query(
      `DROP FUNCTION IF EXISTS guard_company_product_social_insert()`,
    );
    await q.query(`DROP TABLE IF EXISTS agency_client_company_product_events`);
    await q.query(
      `DROP FUNCTION IF EXISTS prevent_company_product_event_mutation()`,
    );
    await q.query(`DROP TABLE IF EXISTS agency_client_company_products`);
    await q.query(`DROP INDEX IF EXISTS "UQ_company_contexts_product_scope"`);
    await q.query(`ALTER TABLE agency_clients DROP COLUMN IF EXISTS archive_status, DROP COLUMN IF EXISTS archive_mode,
      DROP COLUMN IF EXISTS archive_requested_by, DROP COLUMN IF EXISTS archive_requested_at`);
  }
}
