import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CA3: preserve the existing logo upload as light logo and add nullable
 * references/colors for the public Client Area projection. */
export class AddCompanyBrandIdentityFoundation1797160000000 implements MigrationInterface {
  name = 'AddCompanyBrandIdentityFoundation1797160000000';
  async up(queryRunner: QueryRunner) {
    for (const [name, type] of [
      ['logo_dark_url', 'text'],
      ['mark_light_url', 'text'],
      ['mark_dark_url', 'text'],
      ['favicon_url', 'text'],
      ['primary_color', 'varchar(7)'],
      ['secondary_color', 'varchar(7)'],
    ] as const)
      await queryRunner.query(
        `ALTER TABLE "workspace_company_settings" ADD COLUMN IF NOT EXISTS "${name}" ${type}`,
      );
    await queryRunner.query(
      `ALTER TABLE "workspace_company_settings" DROP CONSTRAINT IF EXISTS "CK_workspace_company_settings_brand_colors"`,
    );
    await queryRunner.query(
      `ALTER TABLE "workspace_company_settings" ADD CONSTRAINT "CK_workspace_company_settings_brand_colors" CHECK (("primary_color" IS NULL OR "primary_color" ~ '^#[0-9A-Fa-f]{6}$') AND ("secondary_color" IS NULL OR "secondary_color" ~ '^#[0-9A-Fa-f]{6}$'))`,
    );
  }
  async down(queryRunner: QueryRunner) {
    await queryRunner.query(
      `ALTER TABLE "workspace_company_settings" DROP CONSTRAINT IF EXISTS "CK_workspace_company_settings_brand_colors"`,
    );
    for (const name of [
      'secondary_color',
      'primary_color',
      'favicon_url',
      'mark_dark_url',
      'mark_light_url',
      'logo_dark_url',
    ])
      await queryRunner.query(
        `ALTER TABLE "workspace_company_settings" DROP COLUMN IF EXISTS "${name}"`,
      );
  }
}
