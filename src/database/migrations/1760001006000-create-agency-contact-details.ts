import { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyContactDetails1760001006000
  implements MigrationInterface
{
  name = 'CreateAgencyContactDetails1760001006000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_contact_profiles" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL,
        "avatar_object_key" varchar(500),
        "avatar_url" varchar(1000),
        "language" varchar(20),
        "billing_channel" varchar(30),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_contact_profiles_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_contact_profiles_contact" UNIQUE ("workspace_id", "contact_id"),
        CONSTRAINT "fk_agency_contact_profiles_contact" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_contact_profiles_tenant_workspace"
      ON "agency_contact_profiles" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_contact_profiles_contact"
      ON "agency_contact_profiles" ("contact_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_contact_identification_types" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(80) NOT NULL,
        "code" varchar(40) NOT NULL,
        "is_system" boolean NOT NULL DEFAULT false,
        "is_protected" boolean NOT NULL DEFAULT false,
        "position" integer NOT NULL DEFAULT 0,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_contact_identification_types_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_contact_identification_types_workspace_code" UNIQUE ("workspace_id", "code")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_contact_identification_types_tenant_workspace"
      ON "agency_contact_identification_types" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_banks" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "name" varchar(160) NOT NULL,
        "bic_swift" varchar(80),
        "street" varchar(160),
        "number" varchar(30),
        "complement" varchar(120),
        "district" varchar(120),
        "city" varchar(120),
        "state" varchar(120),
        "postal_code" varchar(30),
        "country" varchar(80),
        "phone" varchar(80),
        "email" varchar(160),
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_banks_id" PRIMARY KEY ("id"),
        CONSTRAINT "uq_agency_banks_workspace_name" UNIQUE ("workspace_id", "name")
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_banks_tenant_workspace"
      ON "agency_banks" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_contact_bank_accounts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL,
        "bank_id" uuid,
        "account_number" varchar(120) NOT NULL,
        "agency_number" varchar(80),
        "holder_name" varchar(160) NOT NULL,
        "can_send_money" boolean NOT NULL DEFAULT false,
        "currency" varchar(10) NOT NULL DEFAULT 'BRL',
        "iban" varchar(120),
        "notes" text,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "pk_agency_contact_bank_accounts_id" PRIMARY KEY ("id"),
        CONSTRAINT "fk_agency_contact_bank_accounts_contact" FOREIGN KEY ("contact_id") REFERENCES "contacts"("id") ON DELETE CASCADE,
        CONSTRAINT "fk_agency_contact_bank_accounts_bank" FOREIGN KEY ("bank_id") REFERENCES "agency_banks"("id") ON DELETE SET NULL
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_contact_bank_accounts_tenant_workspace"
      ON "agency_contact_bank_accounts" ("tenant_id", "workspace_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_contact_bank_accounts_contact"
      ON "agency_contact_bank_accounts" ("contact_id")
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "idx_agency_contact_bank_accounts_bank"
      ON "agency_contact_bank_accounts" ("bank_id")
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_contact_bank_accounts"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_banks"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_contact_identification_types"`);
    await queryRunner.query(`DROP TABLE IF EXISTS "agency_contact_profiles"`);
  }
}
