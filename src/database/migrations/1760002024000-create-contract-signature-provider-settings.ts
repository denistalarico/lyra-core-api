import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContractSignatureProviderSettings1760002024000
  implements MigrationInterface
{
  name = 'CreateContractSignatureProviderSettings1760002024000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_contract_signature_provider_settings (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        provider varchar(40) NOT NULL,
        status varchar(40) NOT NULL DEFAULT 'inactive',
        api_base_url varchar(255) NULL,
        api_token_encrypted text NULL,
        webhook_secret_encrypted text NULL,
        default_signature_mode varchar(40) NOT NULL DEFAULT 'digital',
        sandbox_enabled boolean NOT NULL DEFAULT false,
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_by_id uuid NULL,
        updated_by_id uuid NULL,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_agency_contract_signature_provider_settings_provider
          UNIQUE (tenant_id, workspace_id, provider)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_signature_provider_settings_workspace
      ON agency_contract_signature_provider_settings (tenant_id, workspace_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_signature_provider_settings_status
      ON agency_contract_signature_provider_settings (tenant_id, workspace_id, status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_contract_signature_provider_settings_status
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_contract_signature_provider_settings_workspace
    `);

    await queryRunner.query(`
      DROP TABLE IF EXISTS agency_contract_signature_provider_settings
    `);
  }
}
