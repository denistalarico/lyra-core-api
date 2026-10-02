import type { MigrationInterface, QueryRunner } from 'typeorm';
import { getPermissionDefinition } from '../../modules/permissions/catalog/permission-keys.catalog';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../../modules/permissions/catalog/role-permission-matrix.catalog';
import { PLATFORM_ROLE_KEYS } from '../../modules/permissions/enums/permission.enums';

const PERMISSIONS = [
  'agency.client_conversations.view.assigned',
  'agency.client_conversations.send.assigned',
];

/**
 * CCOM1 — Client Conversation domain.
 *
 * WHAT THE DATABASE ITSELF GUARANTEES (§55)
 * -----------------------------------------
 * The constraints are not decoration; each one closes a mistake that
 * application code could otherwise make silently:
 *
 *   composite FKs to `agency_client_company_contexts`
 *       the four scope columns must describe ONE real company. Without this a
 *       row could pair company A with client B and every scoped query would
 *       still "work", just on the wrong tenant's data.
 *   CK ..._participant_membership
 *       `client_area` ⇒ `membership_id NOT NULL`, `agency` ⇒ NULL. The rule
 *       that a client seat must cite its membership cannot be forgotten by a
 *       future writer.
 *   CK ..._messages_sender
 *       a NULL sender is only legal for `sender_surface='agency'` (the
 *       platform speaking). A client-attributed message always has a person.
 *   UQ ..._active_default (partial)
 *       one active default conversation per company, enforced where two
 *       concurrent requests race — the application relies on this index as the
 *       arbiter rather than on ordering.
 *   UQ ..._participants_identity
 *       `(conversation, surface, user)`: the same person may hold both an
 *       agency and a client seat without collision (§54).
 *   FKs from messages/attachments to their conversation
 *       ownership is structural; an attachment cannot outlive or escape the
 *       conversation it was uploaded to.
 *
 * `ON DELETE RESTRICT` throughout: a conversation is a record of what was said
 * to a party outside the agency, so nothing cascades it away.
 */
export class CreateClientConversations1797500000000 implements MigrationInterface {
  name = 'CreateClientConversations1797500000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_conversations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid NOT NULL,
      "company_context_id" uuid NOT NULL,
      "kind" varchar(16) NOT NULL DEFAULT 'default',
      "status" varchar(16) NOT NULL DEFAULT 'active',
      "last_message_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      "archived_at" timestamptz,
      CONSTRAINT "CK_client_conversations_kind" CHECK ("kind" IN ('default')),
      CONSTRAINT "CK_client_conversations_status" CHECK ("status" IN ('active','archived')),
      CONSTRAINT "CK_client_conversations_archived" CHECK (("status" = 'archived') = ("archived_at" IS NOT NULL)),
      CONSTRAINT "FK_client_conversations_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id") REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_conversations_company" ON "client_conversations" ("tenant_id","workspace_id","company_context_id","status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_conversations_client" ON "client_conversations" ("tenant_id","workspace_id","agency_client_id","status")`,
    );
    // Partial: archived rows may repeat, so history survives a re-open (§4).
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_conversations_active_default" ON "client_conversations" ("company_context_id","kind") WHERE "status" = 'active'`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_conversation_participants" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "conversation_id" uuid NOT NULL,
      "company_context_id" uuid NOT NULL,
      "participant_surface" varchar(16) NOT NULL,
      "user_id" uuid NOT NULL,
      "membership_id" uuid,
      "role" varchar(16) NOT NULL DEFAULT 'member',
      "last_read_at" timestamptz,
      "muted_until" timestamptz,
      "joined_at" timestamptz NOT NULL DEFAULT now(),
      "left_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_client_conversation_participants_surface" CHECK ("participant_surface" IN ('agency','client_area')),
      CONSTRAINT "CK_client_conversation_participants_role" CHECK ("role" IN ('member','owner')),
      CONSTRAINT "CK_client_conversation_participants_membership" CHECK (("participant_surface" = 'client_area' AND "membership_id" IS NOT NULL) OR ("participant_surface" = 'agency' AND "membership_id" IS NULL)),
      CONSTRAINT "FK_client_conversation_participants_conversation" FOREIGN KEY ("conversation_id") REFERENCES "client_conversations" ("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_client_conversation_participants_membership" FOREIGN KEY ("membership_id") REFERENCES "client_area_memberships" ("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_conversation_participants_identity" ON "client_conversation_participants" ("conversation_id","participant_surface","user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_conversation_participants_user" ON "client_conversation_participants" ("tenant_id","participant_surface","user_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_conversation_participants_conversation" ON "client_conversation_participants" ("conversation_id","left_at")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_conversation_messages" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid NOT NULL,
      "company_context_id" uuid NOT NULL,
      "conversation_id" uuid NOT NULL,
      "sender_surface" varchar(16) NOT NULL,
      "sender_user_id" uuid,
      "body" text NOT NULL,
      "kind" varchar(16) NOT NULL DEFAULT 'text',
      "metadata" jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_client_conversation_messages_surface" CHECK ("sender_surface" IN ('agency','client_area')),
      CONSTRAINT "CK_client_conversation_messages_kind" CHECK ("kind" IN ('text','attachment','system')),
      CONSTRAINT "CK_client_conversation_messages_sender" CHECK ("sender_user_id" IS NOT NULL OR "sender_surface" = 'agency'),
      CONSTRAINT "CK_client_conversation_messages_body" CHECK ("kind" <> 'text' OR length(btrim("body")) > 0),
      CONSTRAINT "FK_client_conversation_messages_conversation" FOREIGN KEY ("conversation_id") REFERENCES "client_conversations" ("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_client_conversation_messages_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id") REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT
    )`);
    // The keyset index matches the ORDER BY of `pageMessages` exactly, so
    // paging is an index scan rather than a sort of the whole thread (§46).
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_conversation_messages_keyset" ON "client_conversation_messages" ("conversation_id","created_at","id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_conversation_messages_scope" ON "client_conversation_messages" ("tenant_id","workspace_id","company_context_id")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_conversation_attachments" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid NOT NULL,
      "company_context_id" uuid NOT NULL,
      "conversation_id" uuid NOT NULL,
      "message_id" uuid,
      "uploaded_by_surface" varchar(16) NOT NULL,
      "uploaded_by_user_id" uuid NOT NULL,
      "kind" varchar(16) NOT NULL,
      "file_name" varchar(255) NOT NULL,
      "mime_type" varchar(120) NOT NULL,
      "size_bytes" bigint NOT NULL,
      "storage_provider" varchar(32) NOT NULL DEFAULT 'minio',
      "storage_key" text NOT NULL,
      "width" integer,
      "height" integer,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_client_conversation_attachments_surface" CHECK ("uploaded_by_surface" IN ('agency','client_area')),
      CONSTRAINT "CK_client_conversation_attachments_kind" CHECK ("kind" IN ('image','video','audio','document')),
      CONSTRAINT "CK_client_conversation_attachments_size" CHECK ("size_bytes" > 0),
      CONSTRAINT "FK_client_conversation_attachments_conversation" FOREIGN KEY ("conversation_id") REFERENCES "client_conversations" ("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_client_conversation_attachments_message" FOREIGN KEY ("message_id") REFERENCES "client_conversation_messages" ("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_conversation_attachments_message" ON "client_conversation_attachments" ("message_id")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_conversation_attachments_conversation" ON "client_conversation_attachments" ("conversation_id","created_at")`,
    );

    // §19 — the per-company switch, in the existing settings tables rather
    // than a parallel one. Default false: a channel to the outside is opt-in.
    await queryRunner.query(
      `ALTER TABLE "client_area_company_settings" ADD COLUMN IF NOT EXISTS "conversations_enabled" boolean NOT NULL DEFAULT false`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_area_settings" ADD COLUMN IF NOT EXISTS "conversations_default_enabled" boolean NOT NULL DEFAULT false`,
    );

    await this.seedPermissions(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    for (const permission of PERMISSIONS) {
      await queryRunner.query(
        `DELETE FROM platform_role_permissions WHERE permission_key = $1 AND tenant_id IS NULL`,
        [permission],
      );
      await queryRunner.query(
        `DELETE FROM platform_permissions WHERE key = $1`,
        [permission],
      );
    }

    await queryRunner.query(
      `ALTER TABLE "client_area_settings" DROP COLUMN IF EXISTS "conversations_default_enabled"`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_area_company_settings" DROP COLUMN IF EXISTS "conversations_enabled"`,
    );
    // Reverse creation order: attachments reference messages, which reference
    // conversations, and every FK is RESTRICT.
    await queryRunner.query(
      `DROP TABLE IF EXISTS "client_conversation_attachments"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "client_conversation_messages"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "client_conversation_participants"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "client_conversations"`);
  }

  /**
   * Seeds the two Agency permission keys and their default role grants, the
   * same way `CreateClientAreaManagement` seeds its own — a key absent from
   * `platform_permissions` makes `PermissionsGuard` fail closed at runtime, so
   * the migration is what makes the new routes reachable at all.
   */
  private async seedPermissions(queryRunner: QueryRunner) {
    for (const permission of PERMISSIONS) {
      const definition = getPermissionDefinition(permission);
      if (!definition) {
        throw new Error(`Missing permission definition: ${permission}`);
      }

      await queryRunner.query(
        `INSERT INTO platform_permissions (key, product_key, module_key, resource_key, action_key, scope_key, risk_level, is_dangerous, is_system) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT (key) DO UPDATE SET product_key=EXCLUDED.product_key,module_key=EXCLUDED.module_key,resource_key=EXCLUDED.resource_key,action_key=EXCLUDED.action_key,scope_key=EXCLUDED.scope_key,risk_level=EXCLUDED.risk_level,is_dangerous=EXCLUDED.is_dangerous,is_system=true,updated_at=now()`,
        [
          definition.key,
          definition.productKey,
          definition.moduleKey,
          definition.resourceKey,
          definition.actionKey,
          definition.scopeKey,
          definition.riskLevel,
          definition.isDangerous,
        ],
      );

      for (const roleKey of PLATFORM_ROLE_KEYS) {
        if (!DEFAULT_ROLE_PERMISSION_MATRIX[roleKey].includes(permission)) {
          continue;
        }
        await queryRunner.query(
          `INSERT INTO platform_role_permissions (role_id, permission_key, enabled) SELECT id,$1,true FROM platform_roles WHERE tenant_id IS NULL AND key=$2 ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL DO UPDATE SET enabled=true,updated_at=now()`,
          [permission, roleKey],
        );
      }
    }
  }
}
