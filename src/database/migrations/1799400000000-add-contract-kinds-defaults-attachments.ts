import type { MigrationInterface, QueryRunner } from 'typeorm';
export class AddContractKindsDefaultsAttachments1799400000000 implements MigrationInterface {
  name = 'AddContractKindsDefaultsAttachments1799400000000';
  async up(runner: QueryRunner): Promise<void> {
    await runner.query(`ALTER TABLE agency_contract_records
      ADD COLUMN document_kind varchar(30) NOT NULL DEFAULT 'contract' CHECK (document_kind IN ('contract','amendment','settlement','termination')),
      ADD COLUMN parent_contract_id uuid NULL REFERENCES agency_contract_records(id) ON DELETE RESTRICT`);
    await runner.query(
      `CREATE INDEX agency_contract_parent_idx ON agency_contract_records (tenant_id, workspace_id, parent_contract_id) WHERE parent_contract_id IS NOT NULL`,
    );
    // idx_agency_contract_records_target already covers tenant/workspace/target (1760002022000).
    await runner.query(
      `ALTER TABLE agency_contract_documents ADD COLUMN attachment_kind varchar(40) NULL CHECK (attachment_kind IN ('contract_pdf','quote','amendment','settlement','termination','other'))`,
    );
    await runner.query(
      `UPDATE agency_contract_documents SET attachment_kind='contract_pdf' WHERE type='attachment'`,
    );
    await runner.query(`CREATE TABLE agency_contract_defaults (
      id uuid PRIMARY KEY DEFAULT gen_random_uuid(), tenant_id uuid NOT NULL, workspace_id uuid NOT NULL,
      target_type varchar(60) NOT NULL, "values" jsonb NOT NULL DEFAULT '{}', presets jsonb NOT NULL DEFAULT '{}',
      expiring_window_days int NOT NULL DEFAULT 30 CHECK (expiring_window_days BETWEEN 1 AND 180),
      version int NOT NULL DEFAULT 1, created_by_id uuid NULL, updated_by_id uuid NULL,
      created_at timestamptz NOT NULL DEFAULT now(), updated_at timestamptz NOT NULL DEFAULT now(),
      UNIQUE (tenant_id, workspace_id, target_type))`);
  }
  async down(runner: QueryRunner): Promise<void> {
    await runner.query(`DROP TABLE agency_contract_defaults`);
    await runner.query(
      `ALTER TABLE agency_contract_documents DROP COLUMN attachment_kind`,
    );
    await runner.query(`DROP INDEX agency_contract_parent_idx`);
    await runner.query(
      `ALTER TABLE agency_contract_records DROP COLUMN parent_contract_id, DROP COLUMN document_kind`,
    );
  }
}
