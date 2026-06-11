import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformAccounts1760002048000 implements MigrationInterface {
  name = 'CreatePlatformAccounts1760002048000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_accounts (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        account_type varchar(30) NOT NULL,
        status varchar(30) NOT NULL DEFAULT 'active',
        display_name varchar(180),
        onboarding_mode varchar(30),
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_platform_accounts_tenant UNIQUE (tenant_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_accounts_account_type
      ON platform_accounts (account_type)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_accounts_status
      ON platform_accounts (status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_platform_accounts_status
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_platform_accounts_account_type
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS platform_accounts
    `);
  }
}
