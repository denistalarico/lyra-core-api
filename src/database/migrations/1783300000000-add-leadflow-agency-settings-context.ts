import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddLeadflowAgencySettingsContext1783300000000
  implements MigrationInterface
{
  name = 'AddLeadflowAgencySettingsContext1783300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      ADD COLUMN "context_type" character varying(30) NOT NULL DEFAULT 'client'
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      DROP CONSTRAINT IF EXISTS "UQ_lf_client_settings_tenant_workspace_client"
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      ALTER COLUMN "agency_client_id" DROP NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      ADD CONSTRAINT "CHK_lf_client_settings_context_type"
      CHECK ("context_type" IN ('agency', 'client'))
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      ADD CONSTRAINT "CHK_lf_client_settings_context_client_id"
      CHECK (
        ("context_type" = 'agency' AND "agency_client_id" IS NULL)
        OR ("context_type" = 'client' AND "agency_client_id" IS NOT NULL)
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_client_settings_unique_agency_context"
      ON "leadflow_client_settings" ("tenant_id", "workspace_id")
      WHERE "context_type" = 'agency'
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_client_settings_unique_client_context"
      ON "leadflow_client_settings" ("tenant_id", "workspace_id", "agency_client_id")
      WHERE "context_type" = 'client'
    `);

    await queryRunner.query(`
      CREATE INDEX "IDX_lf_client_settings_context_type"
      ON "leadflow_client_settings" ("context_type")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_client_settings_context_type"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_client_settings_unique_client_context"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_lf_client_settings_unique_agency_context"`,
    );

    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      DROP CONSTRAINT IF EXISTS "CHK_lf_client_settings_context_client_id"
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      DROP CONSTRAINT IF EXISTS "CHK_lf_client_settings_context_type"
    `);

    await queryRunner.query(`
      DELETE FROM "leadflow_client_settings"
      WHERE "context_type" = 'agency'
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      ALTER COLUMN "agency_client_id" SET NOT NULL
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      ADD CONSTRAINT "UQ_lf_client_settings_tenant_workspace_client"
      UNIQUE ("tenant_id", "workspace_id", "agency_client_id")
    `);

    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
      DROP COLUMN "context_type"
    `);
  }
}
