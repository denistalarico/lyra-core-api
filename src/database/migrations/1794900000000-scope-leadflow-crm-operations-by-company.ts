import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CC2F deliberately leaves rows without an already persisted Agency Client
 * proof in `legacy_unassigned`: no primary-company or metadata heuristic may
 * turn historical workspace data into a company-owned operational record.
 */
export class ScopeLeadflowCrmOperationsByCompany1794900000000
  implements MigrationInterface
{
  name = 'ScopeLeadflowCrmOperationsByCompany1794900000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await this.scopeRoots(queryRunner, [
      'crm_pipelines',
      'crm_opportunities',
      'crm_tags',
      'scheduled_items',
    ]);
    await this.scopeExistingClientRoots(queryRunner, [
      'leadflow_agents',
      'leadflow_automations',
      'leadflow_analytics_views',
      'leadflow_intelligence_recommendations',
    ]);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_cc2f_crm_scope()
      RETURNS trigger AS $$
      DECLARE pipeline_scope record;
      DECLARE stage_pipeline_id uuid;
      DECLARE conversation_scope record;
      BEGIN
        SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
          INTO pipeline_scope FROM "crm_pipelines" WHERE "id" = NEW."pipeline_id";
        SELECT "pipeline_id" INTO stage_pipeline_id FROM "crm_stages" WHERE "id" = NEW."stage_id";
        IF NOT FOUND OR pipeline_scope."tenant_id" IS DISTINCT FROM NEW."tenant_id"
          OR pipeline_scope."workspace_id" IS DISTINCT FROM NEW."workspace_id"
          OR pipeline_scope."agency_client_id" IS DISTINCT FROM NEW."agency_client_id"
          OR pipeline_scope."company_context_id" IS DISTINCT FROM NEW."company_context_id"
          OR stage_pipeline_id IS DISTINCT FROM NEW."pipeline_id" THEN
          RAISE EXCEPTION 'opportunity pipeline and stage must share company scope' USING ERRCODE = '23514';
        END IF;
        IF NEW."inbox_conversation_id" IS NOT NULL THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id"
            INTO conversation_scope FROM "inbox_conversations" WHERE "id" = NEW."inbox_conversation_id";
          IF NOT FOUND OR conversation_scope."tenant_id" IS DISTINCT FROM NEW."tenant_id"
            OR conversation_scope."workspace_id" IS DISTINCT FROM NEW."workspace_id"
            OR conversation_scope."agency_client_id" IS DISTINCT FROM NEW."agency_client_id"
            OR conversation_scope."company_context_id" IS DISTINCT FROM NEW."company_context_id" THEN
            RAISE EXCEPTION 'conversation and opportunity must share company scope' USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_crm_opportunities_company_scope"
      BEFORE INSERT OR UPDATE OF "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "pipeline_id", "stage_id", "inbox_conversation_id"
      ON "crm_opportunities" FOR EACH ROW EXECUTE FUNCTION validate_cc2f_crm_scope()
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_cc2f_scheduled_item_scope()
      RETURNS trigger AS $$
      DECLARE target_scope record;
      BEGIN
        IF NEW."source_conversation_id" IS NOT NULL THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "scope_kind"
            INTO target_scope FROM "inbox_conversations" WHERE "id" = NEW."source_conversation_id";
          IF NOT FOUND OR target_scope."tenant_id" IS DISTINCT FROM NEW."tenant_id"
            OR target_scope."workspace_id" IS DISTINCT FROM NEW."workspace_id"
            OR target_scope."agency_client_id" IS DISTINCT FROM NEW."agency_client_id"
            OR target_scope."company_context_id" IS DISTINCT FROM NEW."company_context_id"
            OR target_scope."scope_kind" IS DISTINCT FROM NEW."scope_kind" THEN
            RAISE EXCEPTION 'scheduled item and conversation must share company scope' USING ERRCODE = '23514';
          END IF;
        END IF;
        IF NEW."source_opportunity_id" IS NOT NULL THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "scope_kind"
            INTO target_scope FROM "crm_opportunities" WHERE "id" = NEW."source_opportunity_id";
          IF NOT FOUND OR target_scope."tenant_id" IS DISTINCT FROM NEW."tenant_id"
            OR target_scope."workspace_id" IS DISTINCT FROM NEW."workspace_id"
            OR target_scope."agency_client_id" IS DISTINCT FROM NEW."agency_client_id"
            OR target_scope."company_context_id" IS DISTINCT FROM NEW."company_context_id"
            OR target_scope."scope_kind" IS DISTINCT FROM NEW."scope_kind" THEN
            RAISE EXCEPTION 'scheduled item and opportunity must share company scope' USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_scheduled_items_company_scope"
      BEFORE INSERT OR UPDATE OF "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "scope_kind", "source_conversation_id", "source_opportunity_id"
      ON "scheduled_items" FOR EACH ROW EXECUTE FUNCTION validate_cc2f_scheduled_item_scope()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP TRIGGER IF EXISTS "TR_crm_opportunities_company_scope" ON "crm_opportunities"');
    await queryRunner.query('DROP FUNCTION IF EXISTS validate_cc2f_crm_scope()');
    await queryRunner.query('DROP TRIGGER IF EXISTS "TR_scheduled_items_company_scope" ON "scheduled_items"');
    await queryRunner.query('DROP FUNCTION IF EXISTS validate_cc2f_scheduled_item_scope()');
    for (const table of [
      'scheduled_items', 'crm_tags', 'crm_opportunities', 'crm_pipelines',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${table}_company_scope"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_company_context", DROP CONSTRAINT IF EXISTS "CK_${table}_company_scope", DROP COLUMN IF EXISTS "scope_kind", DROP COLUMN IF EXISTS "company_context_id", DROP COLUMN IF EXISTS "agency_client_id"`);
    }
    for (const table of [
      'leadflow_intelligence_recommendations', 'leadflow_analytics_views',
      'leadflow_automations', 'leadflow_agents',
    ]) {
      await queryRunner.query(`DROP INDEX IF EXISTS "IDX_${table}_company_scope"`);
      await queryRunner.query(`ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "FK_${table}_company_context", DROP CONSTRAINT IF EXISTS "CK_${table}_company_scope", DROP COLUMN IF EXISTS "company_context_id"`);
    }
  }

  private async scopeRoots(queryRunner: QueryRunner, tables: string[]) {
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "agency_client_id" uuid, ADD COLUMN IF NOT EXISTS "company_context_id" uuid, ADD COLUMN IF NOT EXISTS "scope_kind" varchar(24)`);
      await queryRunner.query(`UPDATE "${table}" SET "scope_kind" = 'legacy_unassigned' WHERE "scope_kind" IS NULL`);
      await queryRunner.query(`ALTER TABLE "${table}" ALTER COLUMN "scope_kind" SET NOT NULL`);
      await this.addScopeConstraints(queryRunner, table, true);
    }
  }

  private async scopeExistingClientRoots(queryRunner: QueryRunner, tables: string[]) {
    for (const table of tables) {
      await queryRunner.query(`ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "company_context_id" uuid`);
      await queryRunner.query(`
        WITH candidates AS (
          SELECT "tenant_id", "workspace_id", "agency_client_id", (array_agg("id" ORDER BY "id"))[1] AS "company_context_id", count(*) AS count
          FROM "agency_client_company_contexts"
          GROUP BY "tenant_id", "workspace_id", "agency_client_id"
        )
        UPDATE "${table}" root SET "company_context_id" = candidates."company_context_id"
        FROM candidates
        WHERE root."agency_client_id" = candidates."agency_client_id"
          AND root."tenant_id" = candidates."tenant_id"
          AND root."workspace_id" = candidates."workspace_id"
          AND candidates.count = 1
          AND root."company_context_id" IS NULL
      `);
      await this.addScopeConstraints(queryRunner, table, false);
    }
  }

  private async addScopeConstraints(queryRunner: QueryRunner, table: string, hasScopeKind: boolean) {
    await queryRunner.query(`
      ALTER TABLE "${table}"
        ADD CONSTRAINT "CK_${table}_company_scope" CHECK (
          ${hasScopeKind
            ? `("scope_kind" = 'agency' AND "agency_client_id" IS NULL AND "company_context_id" IS NULL) OR
               ("scope_kind" = 'company' AND "agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL) OR
               ("scope_kind" = 'legacy_unassigned' AND "agency_client_id" IS NULL AND "company_context_id" IS NULL)`
            : `("agency_client_id" IS NULL AND "company_context_id" IS NULL) OR
               ("agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL) OR
               ("agency_client_id" IS NOT NULL AND "company_context_id" IS NULL)`}
        ),
        ADD CONSTRAINT "FK_${table}_company_context"
          FOREIGN KEY ("company_context_id", "tenant_id", "workspace_id", "agency_client_id")
          REFERENCES "agency_client_company_contexts" ("id", "tenant_id", "workspace_id", "agency_client_id") ON DELETE RESTRICT
    `);
    await queryRunner.query(`CREATE INDEX "IDX_${table}_company_scope" ON "${table}" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id")`);
  }
}
