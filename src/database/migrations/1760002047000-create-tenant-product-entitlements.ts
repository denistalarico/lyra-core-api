import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateTenantProductEntitlements1760002047000 implements MigrationInterface {
  name = 'CreateTenantProductEntitlements1760002047000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS tenant_product_entitlements (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        product_key varchar(30) NOT NULL,
        status varchar(30) NOT NULL,
        source varchar(30) NOT NULL,
        plan_key varchar(80),
        starts_at timestamptz,
        ends_at timestamptz,
        trial_ends_at timestamptz,
        settings jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_tenant_product_entitlements_tenant_product
          UNIQUE (tenant_id, product_key)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_product_entitlements_tenant
      ON tenant_product_entitlements (tenant_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_tenant_product_entitlements_tenant_status
      ON tenant_product_entitlements (tenant_id, status)
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_tenant_product_entitlements_tenant_status
    `);
    await queryRunner.query(`
      DROP INDEX IF EXISTS idx_tenant_product_entitlements_tenant
    `);
    await queryRunner.query(`
      DROP TABLE IF EXISTS tenant_product_entitlements
    `);
  }
}
