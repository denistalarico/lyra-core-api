import type { MigrationInterface, QueryRunner } from 'typeorm';

export class ScopeInboxConversationsByCompany1794820000000
  implements MigrationInterface
{
  name = 'ScopeInboxConversationsByCompany1794820000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "inbox_conversations"
        ADD COLUMN IF NOT EXISTS "agency_client_id" uuid,
        ADD COLUMN IF NOT EXISTS "company_context_id" uuid,
        ADD COLUMN IF NOT EXISTS "scope_kind" varchar(24)
    `);
    await queryRunner.query(`
      UPDATE "inbox_conversations" conversation
         SET "agency_client_id" = channel."agency_client_id",
             "company_context_id" = channel."company_context_id",
             "scope_kind" = channel."scope_kind"
        FROM "inbox_channels" channel
       WHERE channel."id" = conversation."channel_id"
         AND channel."tenant_id" = conversation."tenant_id"
         AND channel."workspace_id" = conversation."workspace_id"
         AND conversation."scope_kind" IS NULL
    `);
    await queryRunner.query(`
      UPDATE "inbox_conversations"
         SET "scope_kind" = 'legacy_unassigned'
       WHERE "scope_kind" IS NULL
    `);
    await queryRunner.query(`
      ALTER TABLE "inbox_conversations"
        ALTER COLUMN "scope_kind" SET NOT NULL,
        ADD CONSTRAINT "CK_inbox_conversations_company_scope"
          CHECK (
            ("scope_kind" = 'agency' AND "agency_client_id" IS NULL AND "company_context_id" IS NULL)
            OR
            ("scope_kind" = 'company' AND "agency_client_id" IS NOT NULL AND "company_context_id" IS NOT NULL)
            OR
            ("scope_kind" = 'legacy_unassigned' AND "agency_client_id" IS NULL AND "company_context_id" IS NULL)
          ),
        ADD CONSTRAINT "FK_inbox_conversations_company_context"
          FOREIGN KEY ("company_context_id", "tenant_id", "workspace_id", "agency_client_id")
          REFERENCES "agency_client_company_contexts" ("id", "tenant_id", "workspace_id", "agency_client_id")
          ON DELETE RESTRICT
    `);
    await queryRunner.query(`
      CREATE INDEX "IDX_inbox_conversations_company_scope"
        ON "inbox_conversations" ("tenant_id", "workspace_id", "agency_client_id", "company_context_id")
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_inbox_conversation_company_scope()
      RETURNS trigger AS $$
      DECLARE channel_scope record;
      BEGIN
        IF TG_OP = 'UPDATE' AND (
          NEW."agency_client_id" IS DISTINCT FROM OLD."agency_client_id" OR
          NEW."company_context_id" IS DISTINCT FROM OLD."company_context_id" OR
          NEW."scope_kind" IS DISTINCT FROM OLD."scope_kind"
        ) THEN
          RAISE EXCEPTION 'conversation company ownership cannot be reassigned'
            USING ERRCODE = '23514';
        END IF;
        IF NEW."channel_id" IS NOT NULL THEN
          SELECT "tenant_id", "workspace_id", "agency_client_id", "company_context_id", "scope_kind"
            INTO channel_scope FROM "inbox_channels" WHERE "id" = NEW."channel_id";
          IF NOT FOUND OR
             channel_scope."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
             channel_scope."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
             channel_scope."agency_client_id" IS DISTINCT FROM NEW."agency_client_id" OR
             channel_scope."company_context_id" IS DISTINCT FROM NEW."company_context_id" OR
             channel_scope."scope_kind" IS DISTINCT FROM NEW."scope_kind" THEN
            RAISE EXCEPTION 'conversation and channel must share company scope'
              USING ERRCODE = '23514';
          END IF;
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_inbox_conversations_company_scope"
      BEFORE INSERT OR UPDATE OF "tenant_id", "workspace_id", "agency_client_id",
        "company_context_id", "scope_kind", "channel_id"
      ON "inbox_conversations"
      FOR EACH ROW EXECUTE FUNCTION validate_inbox_conversation_company_scope()
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_inbox_message_parent_scope()
      RETURNS trigger AS $$
      DECLARE conversation_scope record;
      BEGIN
        SELECT "tenant_id", "workspace_id", "channel_id"
          INTO conversation_scope FROM "inbox_conversations"
         WHERE "id" = NEW."conversation_id";
        IF NOT FOUND OR
           conversation_scope."tenant_id" IS DISTINCT FROM NEW."tenant_id" OR
           conversation_scope."workspace_id" IS DISTINCT FROM NEW."workspace_id" OR
           (NEW."channel_id" IS NOT NULL AND
             conversation_scope."channel_id" IS DISTINCT FROM NEW."channel_id") THEN
          RAISE EXCEPTION 'message must inherit conversation scope'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql
    `);
    await queryRunner.query(`
      CREATE TRIGGER "TR_inbox_messages_parent_scope"
      BEFORE INSERT OR UPDATE OF "tenant_id", "workspace_id", "conversation_id", "channel_id"
      ON "inbox_messages"
      FOR EACH ROW EXECUTE FUNCTION validate_inbox_message_parent_scope()
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_inbox_messages_parent_scope" ON "inbox_messages"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_inbox_message_parent_scope()',
    );
    await queryRunner.query(
      'DROP TRIGGER IF EXISTS "TR_inbox_conversations_company_scope" ON "inbox_conversations"',
    );
    await queryRunner.query(
      'DROP FUNCTION IF EXISTS validate_inbox_conversation_company_scope()',
    );
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_inbox_conversations_company_scope"',
    );
    await queryRunner.query(`
      ALTER TABLE "inbox_conversations"
        DROP CONSTRAINT IF EXISTS "FK_inbox_conversations_company_context",
        DROP CONSTRAINT IF EXISTS "CK_inbox_conversations_company_scope",
        DROP COLUMN IF EXISTS "scope_kind",
        DROP COLUMN IF EXISTS "company_context_id",
        DROP COLUMN IF EXISTS "agency_client_id"
    `);
  }
}
