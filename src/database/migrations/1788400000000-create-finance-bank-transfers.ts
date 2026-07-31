import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateFinanceBankTransfers1788400000000 implements MigrationInterface {
  name = 'CreateFinanceBankTransfers1788400000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "finance_bank_transfers" (
        "id" uuid NOT NULL DEFAULT uuid_generate_v4(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "from_bank_account_id" uuid NOT NULL,
        "to_bank_account_id" uuid NOT NULL,
        "transfer_date" date NOT NULL,
        "amount" numeric(14,2) NOT NULL,
        "currency" varchar(3) NOT NULL DEFAULT 'BRL',
        "description" varchar(255),
        "status" varchar(20) NOT NULL DEFAULT 'completed',
        "created_by_id" uuid,
        "reversed_at" timestamptz,
        "reversed_by_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "PK_finance_bank_transfers" PRIMARY KEY ("id"),
        CONSTRAINT "CHK_finance_bank_transfers_accounts" CHECK ("from_bank_account_id" <> "to_bank_account_id"),
        CONSTRAINT "CHK_finance_bank_transfers_amount" CHECK ("amount" > 0),
        CONSTRAINT "CHK_finance_bank_transfers_status" CHECK ("status" IN ('completed', 'reversed')),
        CONSTRAINT "FK_finance_bank_transfers_from_account" FOREIGN KEY ("from_bank_account_id") REFERENCES "finance_bank_accounts"("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_finance_bank_transfers_to_account" FOREIGN KEY ("to_bank_account_id") REFERENCES "finance_bank_accounts"("id") ON DELETE RESTRICT
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_finance_bank_transfers_scope_date"
      ON "finance_bank_transfers" ("tenant_id", "workspace_id", "transfer_date")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_finance_bank_transfers_from_account"
      ON "finance_bank_transfers" ("tenant_id", "workspace_id", "from_bank_account_id")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_finance_bank_transfers_to_account"
      ON "finance_bank_transfers" ("tenant_id", "workspace_id", "to_bank_account_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "finance_bank_transfers" CASCADE`,
    );
  }
}
