import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * TC-CL1 — default members of the client conversations that already exist:
 * every active Agency Owner/Admin and the company's active Client Owner, the
 * same seats a new conversation is born with. `ON CONFLICT DO NOTHING` on the
 * identity key: a live seat is kept and a seat someone left stays left.
 */
export class SeatClientConversationDefaultMembers1802000000000
  implements MigrationInterface
{
  name = 'SeatClientConversationDefaultMembers1802000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "client_conversation_participants"
        ("tenant_id","workspace_id","conversation_id","company_context_id",
         "participant_surface","user_id","membership_id","role",
         "joined_at","last_read_at")
      SELECT c."tenant_id", c."workspace_id", c."id", c."company_context_id",
             'agency', u."user_id", NULL,
             CASE WHEN u."role" = 'owner' THEN 'owner' ELSE 'member' END,
             now(), now()
        FROM "client_conversations" c
        JOIN "workspace_users" u
          ON u."tenant_id" = c."tenant_id" AND u."workspace_id" = c."workspace_id"
       WHERE c."status" = 'active' AND u."status" = 'active'
         AND u."role" IN ('owner','admin') AND u."user_id" IS NOT NULL
      ON CONFLICT ("conversation_id","participant_surface","user_id") DO NOTHING
    `);
    await queryRunner.query(`
      INSERT INTO "client_conversation_participants"
        ("tenant_id","workspace_id","conversation_id","company_context_id",
         "participant_surface","user_id","membership_id","role",
         "joined_at","last_read_at")
      SELECT c."tenant_id", c."workspace_id", c."id", c."company_context_id",
             'client_area', m."user_id", m."id", 'member', now(), now()
        FROM "client_conversations" c
        JOIN "client_area_memberships" m
          ON m."tenant_id" = c."tenant_id" AND m."workspace_id" = c."workspace_id"
         AND m."agency_client_id" = c."agency_client_id"
         AND m."company_context_id" = c."company_context_id"
       WHERE c."status" = 'active' AND m."status" = 'active'
         AND m."role" = 'client_owner'
      ON CONFLICT ("conversation_id","participant_surface","user_id") DO NOTHING
    `);
  }

  async down(): Promise<void> {
    // Data backfill: seats are indistinguishable from manual ones afterwards.
  }
}
