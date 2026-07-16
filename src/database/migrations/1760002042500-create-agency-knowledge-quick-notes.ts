import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Creates the quick-notes table that was introduced by the entity but omitted
 * from the original Agency knowledge migration chain. The later personal-scope
 * migration remains responsible for adding the scope column and its index.
 */
export class CreateAgencyKnowledgeQuickNotes1760002042500 implements MigrationInterface {
  name = 'CreateAgencyKnowledgeQuickNotes1760002042500';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_knowledge_quick_notes" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "author_id" uuid NOT NULL,
        "author_name" character varying(120) NOT NULL,
        "title" character varying(220) NOT NULL,
        "body" text NULL,
        "color" character varying(32) NULL,
        "tags" text[] NOT NULL DEFAULT '{}',
        "position_x" double precision NOT NULL DEFAULT 0,
        "position_y" double precision NOT NULL DEFAULT 0,
        "created_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
        "updated_at" TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_ak_quick_notes_tenant_workspace"
      ON "agency_knowledge_quick_notes" ("tenant_id", "workspace_id")
    `);
  }

  public async down(): Promise<void> {
    await Promise.reject(
      new Error(
        'Automatic rollback is unsafe: the quick-notes table may predate this migration and contain data.',
      ),
    );
  }
}
