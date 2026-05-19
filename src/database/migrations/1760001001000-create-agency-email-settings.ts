import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyEmailSettings1760001001000
  implements MigrationInterface
{
  name = 'CreateAgencyEmailSettings1760001001000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_email_settings" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "provider" varchar(40) NOT NULL DEFAULT 'smtp_imap',
        "from_name" varchar(120) NOT NULL DEFAULT '',
        "from_email" varchar(160),
        "reply_to_email" varchar(160),
        "smtp_host" varchar(160),
        "smtp_port" int,
        "smtp_secure" boolean NOT NULL DEFAULT true,
        "smtp_user" varchar(160),
        "smtp_password_encrypted" text,
        "imap_host" varchar(160),
        "imap_port" int,
        "imap_secure" boolean NOT NULL DEFAULT true,
        "imap_user" varchar(160),
        "imap_password_encrypted" text,
        "status" varchar(30) NOT NULL DEFAULT 'not_configured',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_workspace_email_settings_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_workspace_email_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_workspace_email_tenant_workspace"
      ON "workspace_email_settings" (tenant_id, workspace_id);
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_agency_workspace_email_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_email_settings";`);
  }
}
