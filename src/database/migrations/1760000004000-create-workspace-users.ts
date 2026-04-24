import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkspaceUsers1760000004000 implements MigrationInterface {
  name = 'CreateWorkspaceUsers1760000004000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_users" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "user_id" uuid,
        "name" varchar(120) NOT NULL,
        "email" varchar(160) NOT NULL,
        "role" varchar(20) NOT NULL,
        "status" varchar(20) NOT NULL,
        "last_access" varchar(120) NOT NULL DEFAULT '',
        "invited_at" timestamptz,
        "activated_at" timestamptz,
        "deactivated_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workspace_users_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workspace_users_workspace_email" UNIQUE ("workspace_id", "email")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_users_tenant_workspace"
      ON "workspace_users" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_user_module_access" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "workspace_user_id" uuid NOT NULL REFERENCES "workspace_users"("id") ON DELETE CASCADE,
        "module_key" varchar(30) NOT NULL,
        "enabled" boolean NOT NULL DEFAULT false,
        "permission" varchar(20) NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workspace_user_module_access_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workspace_user_module_access_user_module" UNIQUE ("workspace_user_id", "module_key")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_user_module_access_user"
      ON "workspace_user_module_access" ("workspace_user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_workspace_user_module_access_user";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_user_module_access";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_workspace_users_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_users";`);
  }
}
