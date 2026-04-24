// src/database/migrations/1760000003000-create-user-profile.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateUserProfile1760000003000 implements MigrationInterface {
  name = 'CreateUserProfile1760000003000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_profile" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "first_name" varchar(60) NOT NULL DEFAULT '',
        "last_name" varchar(60) NOT NULL DEFAULT '',
        "display_name" varchar(120) NOT NULL DEFAULT '',
        "email" varchar(160) NOT NULL DEFAULT '',
        "job_title" varchar(80),
        "bio" varchar(280),
        "avatar_url" text,
        "avatar_asset_key" varchar(255),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_profile_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_user_profile_tenant_user" UNIQUE ("tenant_id", "user_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_profile_tenant_user"
      ON "user_profile" ("tenant_id", "user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_profile_tenant_user";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_profile";`);
  }
}
