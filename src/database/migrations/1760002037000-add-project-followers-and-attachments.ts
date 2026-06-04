import { MigrationInterface, QueryRunner } from 'typeorm';

export class AddProjectFollowersAndAttachments1760002037000 implements MigrationInterface {
  name = 'AddProjectFollowersAndAttachments1760002037000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_project_followers" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "user_name" character varying(160) NOT NULL DEFAULT '',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_project_followers" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_project_followers_project_user" UNIQUE ("project_id", "user_id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_project_followers_project"
      ON "agency_project_followers" ("project_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_project_attachments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "project_id" uuid NOT NULL,
        "uploaded_by_id" uuid NOT NULL,
        "file_name" character varying(255) NOT NULL,
        "file_size" integer NOT NULL DEFAULT 0,
        "mime_type" character varying(128) NOT NULL DEFAULT '',
        "asset_path" character varying(512) NOT NULL,
        "asset_url" text NOT NULL,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_project_attachments" PRIMARY KEY ("id")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_project_attachments_project"
      ON "agency_project_attachments" ("project_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_project_attachments"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_project_followers"`);
  }
}
