import { MigrationInterface, QueryRunner } from 'typeorm';

export class RefineFinanceBillsAndBankAvatars1788300000000 implements MigrationInterface {
  name = 'RefineFinanceBillsAndBankAvatars1788300000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_bank_accounts"
      ADD COLUMN IF NOT EXISTS "avatar_url" varchar(500)
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_finance_bills_number_tenant_workspace"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_bills_number_tenant_workspace"
      ON "finance_bills" ("tenant_id", "workspace_id", "bill_number")
      WHERE "bill_number" <> ''
    `);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_finance_invoices_number_tenant_workspace"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_invoices_number_tenant_workspace"
      ON "finance_invoices" ("tenant_id", "workspace_id", "invoice_number")
      WHERE "invoice_number" <> ''
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_finance_bills_number_tenant_workspace"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "UQ_finance_invoices_number_tenant_workspace"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_bills_number_tenant_workspace"
      ON "finance_bills" ("tenant_id", "workspace_id", "bill_number")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_finance_invoices_number_tenant_workspace"
      ON "finance_invoices" ("tenant_id", "workspace_id", "invoice_number")
    `);
    await queryRunner.query(`
      ALTER TABLE "finance_bank_accounts" DROP COLUMN IF EXISTS "avatar_url"
    `);
  }
}
