// src/database/migrations/1760000000000-create-settings-tables.ts
import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateSettingsTables1760000000000 implements MigrationInterface {
  name = 'CreateSettingsTables1760000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "user_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "theme_preference" varchar(20) NOT NULL DEFAULT 'system',
        "locale" varchar(10) NOT NULL DEFAULT 'pt-BR',
        "timezone" varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo',
        "date_format" varchar(20) NOT NULL DEFAULT 'dd/MM/yyyy',
        "time_format" varchar(10) NOT NULL DEFAULT '24h',
        "sidebar_collapsed" boolean NOT NULL DEFAULT false,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_user_preferences_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_user_preferences_tenant_user" UNIQUE ("tenant_id", "user_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_user_preferences_tenant_user"
      ON "user_preferences" ("tenant_id", "user_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_settings_ai" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "default_agent_language" varchar(10) NOT NULL DEFAULT 'pt-BR',
        "default_tone" varchar(20) NOT NULL DEFAULT 'professional',
        "enable_suggestions" boolean NOT NULL DEFAULT true,
        "enable_autofill" boolean NOT NULL DEFAULT true,
        "enable_auto_summaries" boolean NOT NULL DEFAULT true,
        "enable_contextual_suggestions" boolean NOT NULL DEFAULT true,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workspace_settings_ai_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workspace_settings_ai_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_settings_ai_tenant_workspace"
      ON "workspace_settings_ai" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "workspace_settings_company" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "legal_name" varchar(120) NOT NULL,
        "public_name" varchar(80) NOT NULL,
        "workspace_name" varchar(63) NOT NULL,
        "tax_id_type" varchar(20) NOT NULL,
        "tax_id_custom_label" varchar(60),
        "tax_id" varchar(40) NOT NULL,
        "description" varchar(500),
        "primary_color" varchar(7) NOT NULL DEFAULT '#2563EB',
        "secondary_color" varchar(7) NOT NULL DEFAULT '#0F172A',
        "support_email" varchar(160),
        "phone" varchar(40),
        "website" varchar(255),
        "instagram_handle" varchar(60),
        "facebook_url" varchar(255),
        "linkedin_url" varchar(255),
        "country" varchar(80) NOT NULL,
        "state_region" varchar(120),
        "city" varchar(120),
        "address_line1" varchar(255),
        "address_line2" varchar(255),
        "postal_code" varchar(30),
        "industry" varchar(80),
        "company_size" varchar(40),
        "timezone" varchar(80) NOT NULL DEFAULT 'America/Sao_Paulo',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_workspace_settings_company_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_workspace_settings_company_tenant_workspace" UNIQUE ("tenant_id", "workspace_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_workspace_settings_company_tenant_workspace"
      ON "workspace_settings_company" ("tenant_id", "workspace_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_workspace_settings_company_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "workspace_settings_company";`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_workspace_settings_ai_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "workspace_settings_ai";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_user_preferences_tenant_user";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "user_preferences";`);
  }
}
