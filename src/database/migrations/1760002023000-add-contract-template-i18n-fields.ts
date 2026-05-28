import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContractTemplateI18nFields1760002023000
  implements MigrationInterface
{
  name = 'AddContractTemplateI18nFields1760002023000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_contract_templates
      ADD COLUMN IF NOT EXISTS locale varchar(20) NOT NULL DEFAULT 'pt-BR',
      ADD COLUMN IF NOT EXISTS country_code varchar(2) NULL,
      ADD COLUMN IF NOT EXISTS jurisdiction_region varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS template_source varchar(40) NOT NULL DEFAULT 'custom',
      ADD COLUMN IF NOT EXISTS editor_mode varchar(40) NOT NULL DEFAULT 'html',
      ADD COLUMN IF NOT EXISTS legal_disclaimer text NULL
    `);

    await queryRunner.query(`
      ALTER TABLE agency_contract_template_versions
      ADD COLUMN IF NOT EXISTS locale varchar(20) NOT NULL DEFAULT 'pt-BR',
      ADD COLUMN IF NOT EXISTS country_code varchar(2) NULL,
      ADD COLUMN IF NOT EXISTS jurisdiction_region varchar(120) NULL,
      ADD COLUMN IF NOT EXISTS template_source varchar(40) NOT NULL DEFAULT 'custom',
      ADD COLUMN IF NOT EXISTS editor_mode varchar(40) NOT NULL DEFAULT 'html',
      ADD COLUMN IF NOT EXISTS legal_disclaimer text NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_templates_locale_country
      ON agency_contract_templates (tenant_id, workspace_id, locale, country_code)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_contract_templates_source
      ON agency_contract_templates (tenant_id, workspace_id, template_source)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_contract_templates_source
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_agency_contract_templates_locale_country
    `);

    await queryRunner.query(`
      ALTER TABLE agency_contract_template_versions
      DROP COLUMN IF EXISTS legal_disclaimer,
      DROP COLUMN IF EXISTS editor_mode,
      DROP COLUMN IF EXISTS template_source,
      DROP COLUMN IF EXISTS jurisdiction_region,
      DROP COLUMN IF EXISTS country_code,
      DROP COLUMN IF EXISTS locale
    `);

    await queryRunner.query(`
      ALTER TABLE agency_contract_templates
      DROP COLUMN IF EXISTS legal_disclaimer,
      DROP COLUMN IF EXISTS editor_mode,
      DROP COLUMN IF EXISTS template_source,
      DROP COLUMN IF EXISTS jurisdiction_region,
      DROP COLUMN IF EXISTS country_code,
      DROP COLUMN IF EXISTS locale
    `);
  }
}
