import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCrmOpportunityLineage1784590000000 implements MigrationInterface {
  name = 'AddCrmOpportunityLineage1784590000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      ADD COLUMN "source_opportunity_id" uuid NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      ADD CONSTRAINT "chk_crm_opportunity_lineage_not_self"
      CHECK ("source_opportunity_id" IS NULL OR "source_opportunity_id" <> "id")
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      ADD CONSTRAINT "fk_crm_opportunity_lineage_scope"
      FOREIGN KEY ("tenant_id", "workspace_id", "source_opportunity_id")
      REFERENCES "crm_opportunities" ("tenant_id", "workspace_id", "id")
      ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_crm_opportunity_lineage"
      ON "crm_opportunities" ("tenant_id", "workspace_id", "source_opportunity_id")
      WHERE "source_opportunity_id" IS NOT NULL
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_crm_opportunity_lineage"`,
    );
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      DROP CONSTRAINT IF EXISTS "fk_crm_opportunity_lineage_scope"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      DROP CONSTRAINT IF EXISTS "chk_crm_opportunity_lineage_not_self"
    `);
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      DROP COLUMN IF EXISTS "source_opportunity_id"
    `);
  }
}
