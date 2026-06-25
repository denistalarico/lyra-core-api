import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddQuoteItemTaxType1782400000000 implements MigrationInterface {
  name = 'AddQuoteItemTaxType1782400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "quote_items"
        ADD COLUMN IF NOT EXISTS "tax_type" varchar(20) NOT NULL DEFAULT 'percentage',
        ADD COLUMN IF NOT EXISTS "tax_value" int NOT NULL DEFAULT 0;
    `);

    await queryRunner.query(`
      UPDATE "quote_items"
      SET "tax_value" = "tax_rate_bps"
      WHERE "tax_type" = 'percentage'
        AND "tax_value" = 0
        AND "tax_rate_bps" <> 0;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "quote_items"
        DROP COLUMN IF EXISTS "tax_value",
        DROP COLUMN IF EXISTS "tax_type";
    `);
  }
}
