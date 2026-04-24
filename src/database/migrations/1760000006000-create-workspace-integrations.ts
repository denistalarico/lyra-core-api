// src/database/migrations/1760000006000-create-workspace-integrations.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkspaceIntegrations1760000006000 implements MigrationInterface {
  name = 'CreateWorkspaceIntegrations1760000006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_integrations" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "item_id" varchar(80) NOT NULL,
        "category" varchar(30) NOT NULL,
        "status" varchar(30) NOT NULL,
        "is_installed" boolean NOT NULL DEFAULT false,
        "is_pinned" boolean NOT NULL DEFAULT false,
        "sidebar_order" int,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workspace_integrations_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workspace_integrations_workspace_item" UNIQUE ("workspace_id", "item_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_integrations_tenant_workspace"
      ON "workspace_integrations" ("tenant_id", "workspace_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_workspace_integrations_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_integrations";`);
  }
}
