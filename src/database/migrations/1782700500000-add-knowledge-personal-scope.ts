import { MigrationInterface, QueryRunner } from "typeorm";

/**
 * Adds a `scope` discriminator to the knowledge vault items and quick notes so
 * the same tables can hold both shared (agency) and personal (user-private)
 * entries. Existing rows default to 'shared'.
 */
export class AddKnowledgePersonalScope1782700500000
  implements MigrationInterface
{
  name = "AddKnowledgePersonalScope1782700500000";

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "agency_knowledge_vault_items"
      ADD COLUMN IF NOT EXISTS "scope" character varying(20) NOT NULL DEFAULT 'shared'
    `);

    await queryRunner.query(`
      ALTER TABLE "agency_knowledge_quick_notes"
      ADD COLUMN IF NOT EXISTS "scope" character varying(20) NOT NULL DEFAULT 'shared'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agency_knowledge_vault_items_scope"
      ON "agency_knowledge_vault_items" ("tenant_id", "workspace_id", "scope", "created_by_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agency_knowledge_quick_notes_scope"
      ON "agency_knowledge_quick_notes" ("tenant_id", "workspace_id", "scope", "author_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_agency_knowledge_quick_notes_scope"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_agency_knowledge_vault_items_scope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agency_knowledge_quick_notes" DROP COLUMN IF EXISTS "scope"`,
    );
    await queryRunner.query(
      `ALTER TABLE "agency_knowledge_vault_items" DROP COLUMN IF EXISTS "scope"`,
    );
  }
}
