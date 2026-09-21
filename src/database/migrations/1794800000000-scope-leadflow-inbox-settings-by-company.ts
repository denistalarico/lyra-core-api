import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeLeadflowInboxSettingsByCompany1794800000000
  implements MigrationInterface
{
  name = 'ScopeLeadflowInboxSettingsByCompany1794800000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'ALTER TABLE "leadflow_client_settings" ADD COLUMN IF NOT EXISTS "company_context_id" uuid',
    );
    await queryRunner.query(`
      WITH candidates AS (
        SELECT "tenant_id", "workspace_id", "agency_client_id",
               (array_agg("id" ORDER BY "id"))[1] AS "company_context_id",
               count(*) AS "context_count"
          FROM "agency_client_company_contexts"
         GROUP BY "tenant_id", "workspace_id", "agency_client_id"
      )
      UPDATE "leadflow_client_settings" AS settings
         SET "company_context_id" = candidates."company_context_id"
        FROM candidates
       WHERE settings."context_type" = 'client'
         AND settings."company_context_id" IS NULL
         AND candidates."tenant_id" = settings."tenant_id"
         AND candidates."workspace_id" = settings."workspace_id"
         AND candidates."agency_client_id" = settings."agency_client_id"
         AND candidates."context_count" = 1
    `);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_lf_client_settings_unique_client_context"',
    );
    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
        ADD CONSTRAINT "CK_lf_client_settings_company_scope"
          CHECK (
            ("context_type" = 'agency' AND "agency_client_id" IS NULL AND "company_context_id" IS NULL)
            OR
            ("context_type" = 'client' AND "agency_client_id" IS NOT NULL)
          ),
        ADD CONSTRAINT "FK_lf_client_settings_company_context"
          FOREIGN KEY ("company_context_id", "tenant_id", "workspace_id", "agency_client_id")
          REFERENCES "agency_client_company_contexts" ("id", "tenant_id", "workspace_id", "agency_client_id")
          ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_client_settings_unique_company_context"
        ON "leadflow_client_settings" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
        )
        WHERE "context_type" = 'client' AND "company_context_id" IS NOT NULL
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_client_settings_unique_legacy_context"
        ON "leadflow_client_settings" ("tenant_id", "workspace_id", "agency_client_id")
        WHERE "context_type" = 'client' AND "company_context_id" IS NULL
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_lf_client_settings_company_scope"
        ON "leadflow_client_settings" (
          "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
        )
    `);

    for (const table of ['inbox_settings', 'inbox_autonomy_controls']) {
      await queryRunner.query(`
        ALTER TABLE "${table}"
          ADD COLUMN IF NOT EXISTS "agency_client_id" uuid,
          ADD COLUMN IF NOT EXISTS "company_context_id" uuid,
          ADD COLUMN IF NOT EXISTS "scope_kind" varchar(24)
      `);
      await queryRunner.query(`
        UPDATE "${table}"
           SET "scope_kind" = 'legacy_unassigned'
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
    }
    await queryRunner.query(
      'DROP INDEX IF EXISTS "idx_inbox_settings_tenant_workspace"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "uq_inbox_autonomy_control_scope"',
    );
    await this.createInboxScopeIndexes(queryRunner, 'inbox_settings');
    await this.createInboxScopeIndexes(
      queryRunner,
      'inbox_autonomy_controls',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await this.dropInboxScopeIndexes(queryRunner, 'inbox_autonomy_controls');
    await this.dropInboxScopeIndexes(queryRunner, 'inbox_settings');
    for (const table of ['inbox_autonomy_controls', 'inbox_settings']) {
      await queryRunner.query(`
        DELETE FROM "${table}" newer
         USING "${table}" older
         WHERE newer."tenant_id" = older."tenant_id"
           AND newer."workspace_id" = older."workspace_id"
           AND newer."id" > older."id"
      `);
      await queryRunner.query(`
        ALTER TABLE "${table}"
          DROP CONSTRAINT IF EXISTS "FK_${table}_company_context",
          DROP CONSTRAINT IF EXISTS "CK_${table}_company_scope",
          DROP COLUMN IF EXISTS "scope_kind",
          DROP COLUMN IF EXISTS "company_context_id",
          DROP COLUMN IF EXISTS "agency_client_id"
      `);
    }
    await queryRunner.query(`
      CREATE UNIQUE INDEX "idx_inbox_settings_tenant_workspace"
        ON "inbox_settings" ("tenant_id", "workspace_id")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_inbox_autonomy_control_scope"
        ON "inbox_autonomy_controls" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_lf_client_settings_company_scope"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_lf_client_settings_unique_legacy_context"',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_lf_client_settings_unique_company_context"',
    );
    await queryRunner.query(`
      DELETE FROM "leadflow_client_settings" newer
       USING "leadflow_client_settings" older
       WHERE newer."context_type" = 'client'
         AND older."context_type" = 'client'
         AND newer."tenant_id" = older."tenant_id"
         AND newer."workspace_id" = older."workspace_id"
         AND newer."agency_client_id" = older."agency_client_id"
         AND newer."id" > older."id"
    `);
    await queryRunner.query(`
      ALTER TABLE "leadflow_client_settings"
        DROP CONSTRAINT IF EXISTS "FK_lf_client_settings_company_context",
        DROP CONSTRAINT IF EXISTS "CK_lf_client_settings_company_scope",
        DROP COLUMN IF EXISTS "company_context_id"
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "IDX_lf_client_settings_unique_client_context"
        ON "leadflow_client_settings" ("tenant_id", "workspace_id", "agency_client_id")
        WHERE "context_type" = 'client'
    `);
  }

  private async createInboxScopeIndexes(
    queryRunner: QueryRunner,
    table: string,
  ): Promise<void> {
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_${table}_company_scope"
        ON "${table}" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id")
        WHERE "scope_kind" = 'company'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_${table}_agency_scope"
        ON "${table}" ("tenant_id", "workspace_id")
        WHERE "scope_kind" = 'agency'
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX "UQ_${table}_legacy_scope"
        ON "${table}" ("tenant_id", "workspace_id")
        WHERE "scope_kind" = 'legacy_unassigned'
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_${table}_company_scope"
        ON "${table}" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id")
    `);
  }

  private async dropInboxScopeIndexes(
    queryRunner: QueryRunner,
    table: string,
  ): Promise<void> {
    await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${table}_company_scope"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_${table}_legacy_scope"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_${table}_agency_scope"`);
    await queryRunner.query(`DROP INDEX IF EXISTS "UQ_${table}_company_scope"`);
  }
}
