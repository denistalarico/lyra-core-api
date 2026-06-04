import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddBankAccountChartAccount1760002039000 implements MigrationInterface {
  name = 'AddBankAccountChartAccount1760002039000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_bank_accounts"
        ADD COLUMN IF NOT EXISTS "account_id" uuid NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "finance_bank_accounts"
        DROP COLUMN IF EXISTS "account_id";
    `);
  }
}
