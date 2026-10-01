import type { MigrationInterface, QueryRunner } from 'typeorm';

/** CA4 — CRM identity bridge and immutable-enough relationship validity. */
export class CreateClientAreaCrmIdentityRelationships1797300000000 implements MigrationInterface {
  name = 'CreateClientAreaCrmIdentityRelationships1797300000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "client_area_identity_contacts" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "user_id" uuid NOT NULL,
        "contact_id" uuid NOT NULL REFERENCES "contacts"("id") ON DELETE RESTRICT,
        "status" varchar(16) NOT NULL DEFAULT 'active',
        "linked_by_user_id" uuid,
        "linked_at" timestamptz NOT NULL DEFAULT now(),
        "revoked_by_user_id" uuid,
        "revoked_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "CK_client_area_identity_contacts_status"
          CHECK ("status" IN ('active','revoked')),
        CONSTRAINT "CK_client_area_identity_contacts_revocation"
          CHECK (("status" = 'revoked') = ("revoked_at" IS NOT NULL)),
        CONSTRAINT "CK_client_area_identity_contacts_revoked_by"
          CHECK ("revoked_by_user_id" IS NULL OR "status" = 'revoked')
      );
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_area_identity_contacts_active_user"
      ON "client_area_identity_contacts" ("tenant_id", "user_id")
      WHERE "status" = 'active';
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_area_identity_contacts_active_contact"
      ON "client_area_identity_contacts" ("tenant_id", "contact_id")
      WHERE "status" = 'active';
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_client_area_identity_contacts_contact"
      ON "client_area_identity_contacts" ("tenant_id", "workspace_id", "contact_id", "status");
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_client_area_identity_contact()
      RETURNS trigger AS $$
      DECLARE contact_type varchar(20); identity_exists boolean;
      BEGIN
        SELECT "type" INTO contact_type FROM "contacts"
          WHERE "id" = NEW."contact_id" AND "tenant_id" = NEW."tenant_id"
            AND "workspace_id" = NEW."workspace_id";
        SELECT true INTO identity_exists FROM "user_security_settings"
          WHERE "tenant_id" = NEW."tenant_id" AND "user_id" = NEW."user_id";
        IF contact_type IS DISTINCT FROM 'person' THEN
          RAISE EXCEPTION 'contact_id must reference a person in the same tenant/workspace' USING ERRCODE = '23514';
        END IF;
        IF identity_exists IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'user_id must reference an identity in the same tenant' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_client_area_identity_contacts_scope_type" ON "client_area_identity_contacts";
      CREATE TRIGGER "TR_client_area_identity_contacts_scope_type"
      BEFORE INSERT OR UPDATE OF "tenant_id", "workspace_id", "user_id", "contact_id"
      ON "client_area_identity_contacts" FOR EACH ROW
      EXECUTE FUNCTION validate_client_area_identity_contact();
    `);

    await queryRunner.query(`
      ALTER TABLE "client_area_invitations"
      ADD COLUMN IF NOT EXISTS "contact_id" uuid REFERENCES "contacts"("id") ON DELETE RESTRICT;
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_client_area_invitations_contact"
      ON "client_area_invitations" ("tenant_id", "workspace_id", "contact_id");
    `);
    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_client_area_invitation_contact()
      RETURNS trigger AS $$
      DECLARE contact_type varchar(20);
      BEGIN
        IF NEW."contact_id" IS NULL THEN RETURN NEW; END IF;
        SELECT "type" INTO contact_type FROM "contacts"
          WHERE "id" = NEW."contact_id" AND "tenant_id" = NEW."tenant_id"
            AND "workspace_id" = NEW."workspace_id";
        IF contact_type IS DISTINCT FROM 'person' THEN
          RAISE EXCEPTION 'invitation contact_id must reference a person in the same tenant/workspace' USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_client_area_invitations_contact_scope_type" ON "client_area_invitations";
      CREATE TRIGGER "TR_client_area_invitations_contact_scope_type"
      BEFORE INSERT OR UPDATE OF "tenant_id", "workspace_id", "contact_id"
      ON "client_area_invitations" FOR EACH ROW
      EXECUTE FUNCTION validate_client_area_invitation_contact();
    `);

    await queryRunner.query(`
      ALTER TABLE "contact_company_links"
      ADD COLUMN IF NOT EXISTS "linked_at" timestamptz NOT NULL DEFAULT now(),
      ADD COLUMN IF NOT EXISTS "unlinked_at" timestamptz;
    `);
    await queryRunner.query(`
      UPDATE "contact_company_links" SET "linked_at" = COALESCE("linked_at", "created_at", now());
    `);
    await queryRunner.query(`
      UPDATE "contact_company_links" SET "unlinked_at" = COALESCE("unlinked_at", "updated_at", now())
      WHERE "status" <> 'active';
    `);
    await queryRunner.query(`
      ALTER TABLE "contact_company_links" DROP CONSTRAINT IF EXISTS "CK_contact_company_links_validity";
      ALTER TABLE "contact_company_links" ADD CONSTRAINT "CK_contact_company_links_validity"
      CHECK (("status" = 'active') = ("unlinked_at" IS NULL));
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_client_area_invitations_contact_scope_type" ON "client_area_invitations";`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS validate_client_area_invitation_contact();`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "IDX_client_area_invitations_contact";`,
    );
    await queryRunner.query(
      `ALTER TABLE "client_area_invitations" DROP COLUMN IF EXISTS "contact_id";`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_company_links" DROP CONSTRAINT IF EXISTS "CK_contact_company_links_validity";`,
    );
    await queryRunner.query(
      `ALTER TABLE "contact_company_links" DROP COLUMN IF EXISTS "unlinked_at", DROP COLUMN IF EXISTS "linked_at";`,
    );
    await queryRunner.query(
      `DROP TRIGGER IF EXISTS "TR_client_area_identity_contacts_scope_type" ON "client_area_identity_contacts";`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS validate_client_area_identity_contact();`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "client_area_identity_contacts";`,
    );
  }
}
