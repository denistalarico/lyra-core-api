import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeInboxChannelsByCompany1794810000000
  implements MigrationInterface
{
  name = 'ScopeInboxChannelsByCompany1794810000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    for (const table of [
      'inbox_channels',
      'inbox_channel_connection_sessions',
    ]) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD COLUMN IF NOT EXISTS "agency_client_id" uuid,
          ADD COLUMN IF NOT EXISTS "company_context_id" uuid,
          ADD COLUMN IF NOT EXISTS "scope_kind" varchar(24)
      `);
      await queryRunner.query(`
        UPDATE "${table}" SET "scope_kind" = 'legacy_unassigned'
         WHERE "scope_kind" IS NULL
      `);
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ALTER COLUMN "scope_kind" SET NOT NULL,
          ADD CONSTRAINT "CK_${table}_company_scope"
            CHECK (
              ("scope_kind" = 'agency' AND "agency_client_id" IS NULL AND "company_context_id" IS NULL)
              OR
              ("scope_kind" = 'company' AND "agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL)
              OR
              ("scope_kind" = 'legacy_unassigned' AND "agency_client_id" IS NULL AND "company_context_id" IS NULL)
            ),
          ADD CONSTRAINT "FK_${table}_company_context"
            FOREIGN KEY ("company_context_id", "tenant_id", "workspace_id", "agency_client_id")
            REFERENCES "agency_client_company_contexts" ("id", "tenant_id", "workspace_id", "agency_client_id")
            ON DELETE RESTRICT
      `);
      await queryRunner.query(`
        CREATE INDEX "IDX_${table}_company_scope"
          ON "${table}" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id")
      `);
    }

    await queryRunner.query('DROP INDEX IF EXISTS "uq_inbox_channel_meta_phone"');
    for (const [suffix, column] of [
      ['phone', 'external_phone_number_id'],
      ['page', 'external_page_id'],
      ['account', 'external_account_id'],
      ['external', 'external_id'],
    ]) {
      await queryRunner.query(`
        CREATE UNIQUE INDEX "UQ_inbox_channels_${suffix}_binding"
          ON "inbox_channels" ("tenant_id", "workspace_id", "provider", "type", "${column}")
          WHERE "deleted_at" IS NULL AND "${column}" IS NOT NULL
      `);
    }
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const suffix of ['external', 'account', 'page', 'phone']) {
      await queryRunner.query(
        `DROP INDEX IF EXISTS "UQ_inbox_channels_${suffix}_binding"`,
      );
    }
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_inbox_channel_meta_phone"
        ON "inbox_channels" ("provider", "type", "external_phone_number_id")
        WHERE "deleted_at" IS NULL AND "status" = 'active' AND "external_phone_number_id" IS NOT NULL
    `);
    for (const table of [
      'inbox_channel_connection_sessions',
      'inbox_channels',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${table}_company_scope"`);
      await queryRunner.query(`
        ALTER TABLE "${table}"
          DROP CONSTRAINT IF EXISTS "FK_${table}_company_context",
          DROP CONSTRAINT IF EXISTS "CK_${table}_company_scope",
          DROP COLUMN IF EXISTS "scope_kind",
          DROP COLUMN IF EXISTS "company_context_id",
          DROP COLUMN IF EXISTS "agency_client_id"
      `);
    }
  }
}
