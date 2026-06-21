import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddContractTemplateLetterheadPresets1760002056000
  implements MigrationInterface
{
  name = 'AddContractTemplateLetterheadPresets1760002056000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_contract_templates
      ADD COLUMN IF NOT EXISTS header_preset varchar(40) NULL,
      ADD COLUMN IF NOT EXISTS footer_preset varchar(40) NULL,
      ADD COLUMN IF NOT EXISTS show_logo boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS show_company_data boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS show_contract_number boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS show_powered_by_lyra boolean NOT NULL DEFAULT true
    `);

    await queryRunner.query(`
      ALTER TABLE agency_contract_template_versions
      ADD COLUMN IF NOT EXISTS header_preset varchar(40) NULL,
      ADD COLUMN IF NOT EXISTS footer_preset varchar(40) NULL,
      ADD COLUMN IF NOT EXISTS show_logo boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS show_company_data boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS show_contract_number boolean NOT NULL DEFAULT true,
      ADD COLUMN IF NOT EXISTS show_powered_by_lyra boolean NOT NULL DEFAULT true
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE agency_contract_template_versions
      DROP COLUMN IF EXISTS show_powered_by_lyra,
      DROP COLUMN IF EXISTS show_contract_number,
      DROP COLUMN IF EXISTS show_company_data,
      DROP COLUMN IF EXISTS show_logo,
      DROP COLUMN IF EXISTS footer_preset,
      DROP COLUMN IF EXISTS header_preset
    `);

    await queryRunner.query(`
      ALTER TABLE agency_contract_templates
      DROP COLUMN IF EXISTS show_powered_by_lyra,
      DROP COLUMN IF EXISTS show_contract_number,
      DROP COLUMN IF EXISTS show_company_data,
      DROP COLUMN IF EXISTS show_logo,
      DROP COLUMN IF EXISTS footer_preset,
      DROP COLUMN IF EXISTS header_preset
    `);
  }
}
