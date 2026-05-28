import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyContractsLayer1760002022000 implements MigrationInterface {
  name = 'CreateAgencyContractsLayer1760002022000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_contract_templates (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        name varchar(160) NOT NULL,
        description text NULL,
        category varchar(60) NOT NULL,
        target_type varchar(60) NOT NULL,
        status varchar(40) NOT NULL DEFAULT 'draft',
        default_signature_mode varchar(40) NOT NULL DEFAULT 'manual',
        header_html text NULL,
        body_html text NOT NULL,
        footer_html text NULL,
        variables_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by_id uuid NULL,
        updated_by_id uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_templates_tenant_workspace
      ON agency_contract_templates (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_templates_status
      ON agency_contract_templates (tenant_id, workspace_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_templates_target_category
      ON agency_contract_templates (tenant_id, workspace_id, target_type, category)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_contract_template_versions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        template_id uuid NOT NULL,
        version int NOT NULL,
        status varchar(40) NOT NULL DEFAULT 'draft',
        signature_mode varchar(40) NOT NULL DEFAULT 'manual',
        header_html text NULL,
        body_html text NOT NULL,
        footer_html text NULL,
        variables_schema jsonb NOT NULL DEFAULT '{}'::jsonb,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by_id uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_template_versions_template
      ON agency_contract_template_versions (tenant_id, workspace_id, template_id)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_agency_contract_template_versions_number
      ON agency_contract_template_versions (tenant_id, workspace_id, template_id, version)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_contract_records (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        title varchar(180) NOT NULL,
        target_type varchar(60) NOT NULL,
        target_id uuid NULL,
        template_id uuid NULL,
        template_version_id uuid NULL,
        status varchar(40) NOT NULL DEFAULT 'draft',
        signature_mode varchar(40) NOT NULL DEFAULT 'manual',
        signature_provider varchar(40) NOT NULL DEFAULT 'none',
        external_document_id varchar(160) NULL,
        variables_data jsonb NOT NULL DEFAULT '{}'::jsonb,
        generated_html text NULL,
        valid_from date NULL,
        valid_until date NULL,
        signed_at timestamptz NULL,
        completed_at timestamptz NULL,
        cancelled_at timestamptz NULL,
        archived_at timestamptz NULL,
        created_by_id uuid NULL,
        updated_by_id uuid NULL,
        cancelled_by_id uuid NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_records_tenant_workspace
      ON agency_contract_records (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_records_status
      ON agency_contract_records (tenant_id, workspace_id, status)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_records_target
      ON agency_contract_records (tenant_id, workspace_id, target_type, target_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_records_template
      ON agency_contract_records (tenant_id, workspace_id, template_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_records_external_document
      ON agency_contract_records (tenant_id, workspace_id, signature_provider, external_document_id)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_contract_parties (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        contract_id uuid NOT NULL,
        role varchar(60) NOT NULL,
        contact_id uuid NULL,
        user_id uuid NULL,
        name varchar(160) NOT NULL,
        email varchar(180) NULL,
        document varchar(40) NULL,
        signature_status varchar(40) NOT NULL DEFAULT 'pending',
        signed_at timestamptz NULL,
        signature_order int NOT NULL DEFAULT 1,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_parties_contract
      ON agency_contract_parties (tenant_id, workspace_id, contract_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_parties_signature_status
      ON agency_contract_parties (tenant_id, workspace_id, contract_id, signature_status)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_contract_documents (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        contract_id uuid NOT NULL,
        type varchar(60) NOT NULL,
        file_name varchar(240) NULL,
        file_key varchar(500) NULL,
        mime_type varchar(120) NULL,
        size_bytes bigint NULL,
        external_url text NULL,
        uploaded_by_id uuid NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_documents_contract
      ON agency_contract_documents (tenant_id, workspace_id, contract_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_documents_type
      ON agency_contract_documents (tenant_id, workspace_id, contract_id, type)
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_contract_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        contract_id uuid NOT NULL,
        type varchar(80) NOT NULL,
        actor_user_id uuid NULL,
        message text NULL,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_events_contract
      ON agency_contract_events (tenant_id, workspace_id, contract_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_events_type
      ON agency_contract_events (tenant_id, workspace_id, type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_events_created_at
      ON agency_contract_events (tenant_id, workspace_id, created_at DESC)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TABLE IF EXISTS agency_contract_events');
    await queryRunner.query('DROP TABLE IF EXISTS agency_contract_documents');
    await queryRunner.query('DROP TABLE IF EXISTS agency_contract_parties');
    await queryRunner.query('DROP TABLE IF EXISTS agency_contract_records');
    await queryRunner.query('DROP TABLE IF EXISTS agency_contract_template_versions');
    await queryRunner.query('DROP TABLE IF EXISTS agency_contract_templates');
  }
}
