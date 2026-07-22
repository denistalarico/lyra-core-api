import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeCrmOpportunityUniquenessToOpen1784550000000 implements MigrationInterface {
  name = 'ScopeCrmOpportunityUniquenessToOpen1784550000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_crm_opportunity_active_inbox_conversation"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_crm_opportunity_open_inbox_conversation"
      ON "crm_opportunities" ("tenant_id", "workspace_id", "inbox_conversation_id")
      WHERE "inbox_conversation_id" IS NOT NULL
        AND "deleted_at" IS NULL
        AND "status" = 'open'
    `);
    await queryRunner.query(`
      CREATE INDEX "idx_crm_opportunity_contact_lifecycle"
      ON "crm_opportunities" ("tenant_id", "workspace_id", "contact_id", "status")
      WHERE "deleted_at" IS NULL
    `);
    await queryRunner.query(`
      INSERT INTO "contact_list_members"
        ("tenant_id", "workspace_id", "list_id", "contact_id", "added_by_user_id")
      SELECT contact."tenant_id", contact."workspace_id", list."id", contact."id", NULL
      FROM "contacts" contact
      JOIN "contact_lists" list
        ON list."tenant_id" = contact."tenant_id"
       AND list."workspace_id" = contact."workspace_id"
       AND list."source_product" = 'leadflow'
       AND (
         (list."parent_list_id" IS NULL AND list."source_context" = 'shared_contacts')
         OR EXISTS (
           SELECT 1
           FROM "inbox_conversations" conversation
           JOIN "inbox_channels" channel
             ON channel."id" = conversation."channel_id"
            AND channel."tenant_id" = conversation."tenant_id"
            AND channel."workspace_id" = conversation."workspace_id"
           WHERE conversation."contact_id" = contact."id"
             AND list."source_context" = 'client:' || (channel."metadata"->>'clientId')
         )
       )
      WHERE contact."source" = 'leadflow_whatsapp'
      ON CONFLICT ("list_id", "contact_id") DO NOTHING
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_crm_opportunity_contact_lifecycle"`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_crm_opportunity_open_inbox_conversation"`,
    );
    await queryRunner.query(`
      CREATE UNIQUE INDEX "uq_crm_opportunity_active_inbox_conversation"
      ON "crm_opportunities" ("tenant_id", "workspace_id", "inbox_conversation_id")
      WHERE "inbox_conversation_id" IS NOT NULL AND "deleted_at" IS NULL
    `);
  }
}
