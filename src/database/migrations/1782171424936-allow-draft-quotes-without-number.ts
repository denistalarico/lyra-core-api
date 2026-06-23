import { MigrationInterface, QueryRunner } from 'typeorm';

export class AllowDraftQuotesWithoutNumber1782171424936
  implements MigrationInterface
{
  name = 'AllowDraftQuotesWithoutNumber1782171424936';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "quotes"
      DROP CONSTRAINT IF EXISTS "uq_quotes_number_workspace";
    `);

    await queryRunner.query(`
      ALTER TABLE "quotes"
      ALTER COLUMN "quote_number" DROP NOT NULL;
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "idx_quotes_number"
      ON "quotes" ("tenant_id", "workspace_id", "quote_number")
      WHERE "quote_number" IS NOT NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_quotes_number";`);

    await queryRunner.query(`
      UPDATE "quotes"
      SET "quote_number" = 'Q-LEGACY-' || substring("id"::text, 1, 8)
      WHERE "quote_number" IS NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "quotes"
      ALTER COLUMN "quote_number" SET NOT NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "quotes"
      ADD CONSTRAINT "uq_quotes_number_workspace"
      UNIQUE ("tenant_id", "workspace_id", "quote_number");
    `);
  }
}
