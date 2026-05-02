import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateContactsCore1760000015000 implements MigrationInterface {
  name = 'CreateContactsCore1760000015000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contacts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "type" varchar(20) NOT NULL,
        "display_name" varchar(160) NOT NULL,
        "first_name" varchar(80),
        "last_name" varchar(120),
        "legal_name" varchar(180),
        "document_type" varchar(30),
        "document_number" varchar(60),
        "job_title" varchar(120),
        "company_contact_id" uuid,
        "source" varchar(30) NOT NULL DEFAULT 'manual',
        "business_mode" varchar(40) NOT NULL DEFAULT 'general',
        "lifecycle_stage" varchar(30) NOT NULL DEFAULT 'lead',
        "status" varchar(20) NOT NULL DEFAULT 'active',
        "owner_user_id" uuid,
        "created_by_user_id" uuid,
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contacts_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_contacts_company_contact" FOREIGN KEY ("company_contact_id") REFERENCES "contacts"("id") ON DELETE SET NULL
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contacts_tenant_workspace"
      ON "contacts" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contacts_workspace_type"
      ON "contacts" ("workspace_id", "type");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contacts_workspace_status"
      ON "contacts" ("workspace_id", "status");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contacts_workspace_lifecycle_stage"
      ON "contacts" ("workspace_id", "lifecycle_stage");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contacts_workspace_source"
      ON "contacts" ("workspace_id", "source");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contacts_company_contact"
      ON "contacts" ("company_contact_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_methods" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
        "type" varchar(30) NOT NULL,
        "value" varchar(255) NOT NULL,
        "label" varchar(80),
        "is_primary" boolean NOT NULL DEFAULT false,
        "verified_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_methods_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_methods_tenant_workspace"
      ON "contact_methods" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_methods_contact"
      ON "contact_methods" ("contact_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_methods_contact_type"
      ON "contact_methods" ("contact_id", "type");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_addresses" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
        "type" varchar(30) NOT NULL DEFAULT 'main',
        "street" varchar(160),
        "number" varchar(30),
        "complement" varchar(120),
        "district" varchar(120),
        "city" varchar(120),
        "state" varchar(120),
        "postal_code" varchar(30),
        "country" varchar(80),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_addresses_id" PRIMARY KEY ("id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_addresses_tenant_workspace"
      ON "contact_addresses" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_addresses_contact"
      ON "contact_addresses" ("contact_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_lists" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(120) NOT NULL,
        "description" varchar(500),
        "color" varchar(7) NOT NULL DEFAULT '#2563EB',
        "visibility" varchar(20) NOT NULL DEFAULT 'workspace',
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_lists_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_lists_workspace_name" UNIQUE ("workspace_id", "name")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_lists_tenant_workspace"
      ON "contact_lists" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_list_members" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "list_id" uuid NOT NULL REFERENCES "contact_lists"("id") ON DELETE CASCADE,
        "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
        "added_by_user_id" uuid,
        "added_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_list_members_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_list_members_list_contact" UNIQUE ("list_id", "contact_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_list_members_tenant_workspace"
      ON "contact_list_members" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_list_members_list"
      ON "contact_list_members" ("list_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_list_members_contact"
      ON "contact_list_members" ("contact_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_tags" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "color" varchar(7) NOT NULL DEFAULT '#64748B',
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_tags_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_tags_workspace_name" UNIQUE ("workspace_id", "name")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_tags_tenant_workspace"
      ON "contact_tags" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "contact_tag_assignments" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE CASCADE,
        "tag_id" uuid NOT NULL REFERENCES "contact_tags"("id") ON DELETE CASCADE,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_contact_tag_assignments_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_contact_tag_assignments_contact_tag" UNIQUE ("contact_id", "tag_id")
      );
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_tag_assignments_tenant_workspace"
      ON "contact_tag_assignments" ("tenant_id", "workspace_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_tag_assignments_contact"
      ON "contact_tag_assignments" ("contact_id");
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_contact_tag_assignments_tag"
      ON "contact_tag_assignments" ("tag_id");
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_tag_assignments_tag";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_tag_assignments_contact";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_tag_assignments_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_tag_assignments";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_tags_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_tags";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_list_members_contact";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_list_members_list";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_list_members_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_list_members";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_lists_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_lists";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_addresses_contact";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_addresses_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_addresses";`);

    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_methods_contact_type";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_methods_contact";`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contact_methods_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contact_methods";`);

    await queryRunner.query(`DROP INDEX IF EXISTS "idx_contacts_company_contact";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_contacts_workspace_source";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contacts_workspace_lifecycle_stage";`,
    );
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_contacts_workspace_status";`);
    await queryRunner.query(`DROP INDEX IF EXISTS "idx_contacts_workspace_type";`);
    await queryRunner.query(
      `DROP INDEX IF EXISTS "idx_contacts_tenant_workspace";`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "contacts";`);
  }
}
