import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddCrmOpportunitySortOrder1783100000000 implements MigrationInterface {
  name = 'AddCrmOpportunitySortOrder1783100000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      ADD COLUMN IF NOT EXISTS "sort_order" integer NOT NULL DEFAULT 0
    `);

    await queryRunner.query(`
      WITH ranked AS (
        SELECT
          "id",
          (row_number() OVER (
            PARTITION BY "stage_id"
            ORDER BY "next_follow_up_at" ASC NULLS LAST, "created_at" DESC
          ) - 1) * 10 AS "next_sort_order"
        FROM "crm_opportunities"
      )
      UPDATE "crm_opportunities" opportunity
      SET "sort_order" = ranked."next_sort_order"
      FROM ranked
      WHERE opportunity."id" = ranked."id"
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_crm_opportunities_stage_sort"
      ON "crm_opportunities" ("stage_id", "sort_order")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_crm_opportunities_stage_sort"`,
    );
    await queryRunner.query(`
      ALTER TABLE "crm_opportunities"
      DROP COLUMN IF EXISTS "sort_order"
    `);
  }
}
