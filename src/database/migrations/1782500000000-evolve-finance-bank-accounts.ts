import { MigrationInterface, QueryRunner } from 'typeorm';

export class EvolveFinanceBankAccounts1782500000000
  implements MigrationInterface
{
  name = 'EvolveFinanceBankAccounts1782500000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_bank_accounts"
        ADD COLUMN IF NOT EXISTS "country_code" varchar(2) NULL,
        ADD COLUMN IF NOT EXISTS "initial_balance_date" date NULL,
        ADD COLUMN IF NOT EXISTS "is_primary" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "reconciliation_enabled" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "description" text NULL,
        ADD COLUMN IF NOT EXISTS "bank_details" jsonb NOT NULL DEFAULT '{}'::jsonb,
        ADD COLUMN IF NOT EXISTS "card_details" jsonb NOT NULL DEFAULT '{}'::jsonb;
    `);

    // At most one primary account per tenant/workspace/currency.
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_finance_bank_accounts_primary"
        ON "finance_bank_accounts" ("tenant_id", "workspace_id", "currency")
        WHERE "is_primary" = true;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS "UQ_finance_bank_accounts_primary";
    `);

    await queryRunner.query(`
      ALTER TABLE "finance_bank_accounts"
        DROP COLUMN IF EXISTS "country_code",
        DROP COLUMN IF EXISTS "initial_balance_date",
        DROP COLUMN IF EXISTS "is_primary",
        DROP COLUMN IF EXISTS "reconciliation_enabled",
        DROP COLUMN IF EXISTS "description",
        DROP COLUMN IF EXISTS "bank_details",
        DROP COLUMN IF EXISTS "card_details";
    `);
  }
}
