import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreatePlatformAdminInvitations1787400000000 implements MigrationInterface {
  name = 'CreatePlatformAdminInvitations1787400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "platform_admin_invitations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "email" varchar(320) NOT NULL,
        "normalized_email" varchar(320) NOT NULL,
        "role_key" varchar(40) NOT NULL,
        "status" varchar(20) NOT NULL,
        "token_hash" varchar(128) NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "accepted_at" timestamptz,
        "cancelled_at" timestamptz,
        "invited_by_admin_id" uuid NOT NULL,
        "accepted_by_user_id" uuid,
        "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_platform_admin_invitations" PRIMARY KEY ("id"),
        CONSTRAINT "ck_platform_admin_invitations_status"
          CHECK ("status" IN ('pending', 'accepted', 'expired', 'cancelled')),
        CONSTRAINT "ck_platform_admin_invitations_role"
          CHECK ("role_key" IN (
            'super_admin',
            'admin',
            'support_admin',
            'billing_admin',
            'operations_admin',
            'read_only'
          )),
        CONSTRAINT "fk_platform_admin_invitations_inviter"
          FOREIGN KEY ("invited_by_admin_id")
          REFERENCES "platform_internal_admins"("id")
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_invitations_email"
      ON "platform_admin_invitations" ("normalized_email")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_invitations_status"
      ON "platform_admin_invitations" ("status")
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_platform_admin_invitations_expires_at"
      ON "platform_admin_invitations" ("expires_at")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_admin_invitations_token_hash"
      ON "platform_admin_invitations" ("token_hash")
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_platform_admin_invitations_pending_email"
      ON "platform_admin_invitations" ("normalized_email")
      WHERE "status" = 'pending'
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS "platform_admin_invitations"`,
    );
  }
}
