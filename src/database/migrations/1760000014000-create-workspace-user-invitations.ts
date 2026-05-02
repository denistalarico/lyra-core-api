import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkspaceUserInvitations1760000014000
  implements MigrationInterface
{
  name = 'CreateWorkspaceUserInvitations1760000014000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_user_invitations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "email" varchar(160) NOT NULL,
        "role" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'pending',
        "token_hash" text NOT NULL,
        "expires_at" timestamptz NOT NULL,
        "accepted_at" timestamptz,
        "revoked_at" timestamptz,
        "invited_by_user_id" uuid NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workspace_user_invitations_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_user_invitations_tenant_workspace"
      ON "workspace_user_invitations" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_user_invitations_token_hash"
      ON "workspace_user_invitations" ("token_hash");
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_workspace_user_invitations_pending_email"
      ON "workspace_user_invitations" ("tenant_id", "workspace_id", lower("email"))
      WHERE "status" = 'pending' AND "revoked_at" IS NULL AND "accepted_at" IS NULL;
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_workspace_user_invitations_pending_email";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_workspace_user_invitations_token_hash";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_workspace_user_invitations_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_user_invitations";`,
    );
  }
}
