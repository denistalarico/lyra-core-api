import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContactsSettings1760000016000
  implements MigrationInterface
{
  name = 'CreateContactsSettings1760000016000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_custom_fields" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "key" varchar(80) NOT NULL,
        "type" varchar(30) NOT NULL,
        "required" boolean NOT NULL DEFAULT false,
        "options" jsonb,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_custom_fields_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_custom_fields_workspace_key" UNIQUE ("workspace_id", "key")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_custom_fields_tenant_workspace"
      ON "contact_custom_fields" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_custom_fields_workspace_active"
      ON "contact_custom_fields" ("workspace_id", "is_active");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_custom_field_values" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
        "field_id" uuid NOT NULL REFERENCES "contact_custom_fields"("id") ON DELETE CASCADE,
        "value_text" text,
        "value_number" numeric,
        "value_boolean" boolean,
        "value_date" date,
        "value_json" jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_custom_field_values_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_custom_field_values_contact_field" UNIQUE ("contact_id", "field_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_custom_field_values_tenant_workspace"
      ON "contact_custom_field_values" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_custom_field_values_contact"
      ON "contact_custom_field_values" ("contact_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_custom_field_values_field"
      ON "contact_custom_field_values" ("field_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_segments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" varchar(500),
        "rules_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_segments_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_segments_workspace_name" UNIQUE ("workspace_id", "name")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_segments_tenant_workspace"
      ON "contact_segments" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_business_modes" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "key" varchar(80) NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" varchar(500),
        "color" varchar(7) NOT NULL DEFAULT '#2563EB',
        "is_system" boolean NOT NULL DEFAULT false,
        "is_active" boolean NOT NULL DEFAULT true,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_business_modes_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_business_modes_workspace_key" UNIQUE ("workspace_id", "key")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_business_modes_tenant_workspace"
      ON "contact_business_modes" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_business_modes_workspace_active"
      ON "contact_business_modes" ("workspace_id", "is_active");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_view_preferences" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "view_key" varchar(80) NOT NULL,
        "columns_json" jsonb NOT NULL DEFAULT '[]'::jsonb,
        "filters_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "sort_json" jsonb NOT NULL DEFAULT '{}'::jsonb,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_view_preferences_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_view_preferences_user_view" UNIQUE ("workspace_id", "user_id", "view_key")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_view_preferences_tenant_workspace"
      ON "contact_view_preferences" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_view_preferences_user"
      ON "contact_view_preferences" ("user_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_view_preferences_user";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_view_preferences_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_view_preferences";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_business_modes_workspace_active";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_business_modes_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_business_modes";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_segments_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_segments";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_custom_field_values_field";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_custom_field_values_contact";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_custom_field_values_tenant_workspace";`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "contact_custom_field_values";`,
    );

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_custom_fields_workspace_active";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_custom_fields_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_custom_fields";`);
  }
}
