import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateWorkspaceSettingsEmail1760000005000 implements MigrationInterface {
  name = 'CreateWorkspaceSettingsEmail1760000005000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_settings_email" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "notification_email" varchar(160) NOT NULL DEFAULT '',
        "incoming_host" varchar(255) NOT NULL DEFAULT '',
        "incoming_port" varchar(10) NOT NULL DEFAULT '',
        "incoming_username" varchar(160) NOT NULL DEFAULT '',
        "incoming_password_encrypted" text,
        "incoming_security" varchar(20) NOT NULL DEFAULT 'ssl_tls',
        "incoming_server_type" varchar(20) NOT NULL DEFAULT 'imap',
        "outgoing_host" varchar(255) NOT NULL DEFAULT '',
        "outgoing_port" varchar(10) NOT NULL DEFAULT '',
        "outgoing_username" varchar(160) NOT NULL DEFAULT '',
        "outgoing_password_encrypted" text,
        "outgoing_security" varchar(20) NOT NULL DEFAULT 'starttls',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workspace_settings_email_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workspace_settings_email_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_settings_email_tenant_workspace"
      ON "workspace_settings_email" ("tenant_id", "workspace_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_workspace_settings_email_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_settings_email";`);
  }
}
