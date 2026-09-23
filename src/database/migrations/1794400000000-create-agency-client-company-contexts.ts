import type { MigrationInterface, QueryRunner } from 'typeorm';

export class CreateAgencyClientCompanyContexts1794400000000 implements MigrationInterface {
  name = 'CreateAgencyClientCompanyContexts1794400000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "agency_client_company_contexts" (
        "id" uuid NOT NULL DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid NOT NULL,
        "company_contact_id" uuid NOT NULL,
        "status" varchar(20) NOT NULL DEFAULT 'active',
        "is_primary" boolean NOT NULL DEFAULT false,
        "created_by_user_id" uuid,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        "archived_at" timestamptz,
        CONSTRAINT "PK_agency_client_company_contexts" PRIMARY KEY ("id"),
        CONSTRAINT "UQ_agency_client_company_contexts_client_company"
          UNIQUE ("agency_client_id", "company_contact_id"),
        CONSTRAINT "CK_agency_client_company_contexts_status"
          CHECK ("status" IN ('active', 'inactive', 'archived')),
        CONSTRAINT "CK_agency_client_company_contexts_archive_state"
          CHECK (("status" = 'archived') = ("archived_at" IS NOT NULL)),
        CONSTRAINT "FK_agency_client_company_contexts_client"
          FOREIGN KEY ("agency_client_id") REFERENCES "agency_clients"("id") ON DELETE CASCADE,
        CONSTRAINT "FK_agency_client_company_contexts_company"
          FOREIGN KEY ("company_contact_id") REFERENCES "contacts"("id") ON DELETE RESTRICT
      );
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_agency_client_company_contexts_scope"
      ON "agency_client_company_contexts"
        ("tenant_id", "workspace_id", "agency_client_id");
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS
        "UQ_agency_client_company_contexts_active_primary"
      ON "agency_client_company_contexts" ("agency_client_id")
      WHERE "is_primary" = true
        AND "status" = 'active'
        AND "archived_at" IS NULL;
    `);

    await queryRunner.query(`
      ALTER TABLE "contact_company_links"
        ADD COLUMN IF NOT EXISTS "role" varchar(60),
        ADD COLUMN IF NOT EXISTS "is_primary" boolean NOT NULL DEFAULT false,
        ADD COLUMN IF NOT EXISTS "status" varchar(20) NOT NULL DEFAULT 'active',
        ADD COLUMN IF NOT EXISTS "updated_at" timestamptz NOT NULL DEFAULT now();
    `);
    await queryRunner.query(`
      DO $$
      BEGIN
        IF NOT EXISTS (
          SELECT 1 FROM pg_constraint
          WHERE conname = 'CK_contact_company_links_status'
        ) THEN
          ALTER TABLE "contact_company_links"
            ADD CONSTRAINT "CK_contact_company_links_status"
            CHECK ("status" IN ('active', 'inactive', 'archived'));
        END IF;
      END $$;
    `);
    await queryRunner.query(`
      WITH ranked AS (
        SELECT "id",
               row_number() OVER (
                 PARTITION BY "person_contact_id" ORDER BY "created_at", "id"
               ) AS position
        FROM "contact_company_links"
        WHERE "status" = 'active'
      )
      UPDATE "contact_company_links" AS link
      SET "is_primary" = (ranked.position = 1)
      FROM ranked
      WHERE link."id" = ranked."id";
    `);
    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS "uq_contact_company_links_active_primary"
      ON "contact_company_links" ("person_contact_id")
      WHERE "is_primary" = true AND "status" = 'active';
    `);

    await queryRunner.query(`
      DO $$
      BEGIN
        IF EXISTS (
          SELECT 1
          FROM "contact_company_links" link
          LEFT JOIN "contacts" person
            ON person."id" = link."person_contact_id"
           AND person."tenant_id" = link."tenant_id"
           AND person."workspace_id" = link."workspace_id"
           AND person."type" = 'person'
          LEFT JOIN "contacts" company
            ON company."id" = link."company_contact_id"
           AND company."tenant_id" = link."tenant_id"
           AND company."workspace_id" = link."workspace_id"
           AND company."type" = 'organization'
          WHERE person."id" IS NULL OR company."id" IS NULL
        ) THEN
          RAISE EXCEPTION 'existing contact_company_links contain invalid type or scope relationships'
            USING ERRCODE = '23514';
        END IF;
      END $$;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_contact_company_link_scope_and_type()
      RETURNS trigger AS $$
      DECLARE person_type varchar(20);
      DECLARE company_type varchar(20);
      BEGIN
        SELECT "type" INTO person_type
        FROM "contacts"
        WHERE "id" = NEW."person_contact_id"
          AND "tenant_id" = NEW."tenant_id"
          AND "workspace_id" = NEW."workspace_id";

        SELECT "type" INTO company_type
        FROM "contacts"
        WHERE "id" = NEW."company_contact_id"
          AND "tenant_id" = NEW."tenant_id"
          AND "workspace_id" = NEW."workspace_id";

        IF person_type IS DISTINCT FROM 'person' THEN
          RAISE EXCEPTION 'person_contact_id must reference a person in the same tenant/workspace'
            USING ERRCODE = '23514';
        END IF;
        IF company_type IS DISTINCT FROM 'organization' THEN
          RAISE EXCEPTION 'company_contact_id must reference an organization in the same tenant/workspace'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_contact_company_links_scope_type"
      ON "contact_company_links";
      CREATE TRIGGER "TR_contact_company_links_scope_type"
      BEFORE INSERT OR UPDATE OF
        "tenant_id", "workspace_id", "person_contact_id", "company_contact_id"
      ON "contact_company_links"
      FOR EACH ROW EXECUTE FUNCTION validate_contact_company_link_scope_and_type();
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION validate_agency_client_company_context_scope()
      RETURNS trigger AS $$
      DECLARE client_matches boolean;
      DECLARE company_type varchar(20);
      BEGIN
        SELECT true INTO client_matches
        FROM "agency_clients"
        WHERE "id" = NEW."agency_client_id"
          AND "tenant_id" = NEW."tenant_id"
          AND "workspace_id" = NEW."workspace_id";

        SELECT "type" INTO company_type
        FROM "contacts"
        WHERE "id" = NEW."company_contact_id"
          AND "tenant_id" = NEW."tenant_id"
          AND "workspace_id" = NEW."workspace_id";

        IF client_matches IS DISTINCT FROM true THEN
          RAISE EXCEPTION 'agency_client_id must belong to the same tenant/workspace'
            USING ERRCODE = '23514';
        END IF;
        IF company_type IS DISTINCT FROM 'organization' THEN
          RAISE EXCEPTION 'company_contact_id must reference an organization in the same tenant/workspace'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_agency_client_company_contexts_scope"
      ON "agency_client_company_contexts";
      CREATE TRIGGER "TR_agency_client_company_contexts_scope"
      BEFORE INSERT OR UPDATE OF
        "tenant_id", "workspace_id", "agency_client_id", "company_contact_id"
      ON "agency_client_company_contexts"
      FOR EACH ROW EXECUTE FUNCTION validate_agency_client_company_context_scope();
    `);

    await queryRunner.query(`
      INSERT INTO "agency_client_company_contexts" (
        "tenant_id", "workspace_id", "agency_client_id", "company_contact_id",
        "status", "is_primary", "created_by_user_id"
      )
      SELECT client."tenant_id", client."workspace_id", client."id", contact."id",
             'active', true, NULL
      FROM "agency_clients" AS client
      INNER JOIN "contacts" AS contact
        ON contact."id" = client."contact_id"
       AND contact."tenant_id" = client."tenant_id"
       AND contact."workspace_id" = client."workspace_id"
       AND contact."type" = 'organization'
      WHERE client."contact_id" IS NOT NULL
      ON CONFLICT ("agency_client_id", "company_contact_id") DO NOTHING;
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION protect_contact_company_relationship_invariants()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "contact_company_links" link
          WHERE link."person_contact_id" = OLD."id"
            AND (
              NEW."type" <> 'person'
              OR link."tenant_id" <> NEW."tenant_id"
              OR link."workspace_id" <> NEW."workspace_id"
            )
        ) THEN
          RAISE EXCEPTION 'contact update would invalidate a person/company relationship'
            USING ERRCODE = '23514';
        END IF;

        IF EXISTS (
          SELECT 1 FROM "contact_company_links" link
          WHERE link."company_contact_id" = OLD."id"
            AND (
              NEW."type" <> 'organization'
              OR link."tenant_id" <> NEW."tenant_id"
              OR link."workspace_id" <> NEW."workspace_id"
            )
        ) OR EXISTS (
          SELECT 1 FROM "agency_client_company_contexts" context
          WHERE context."company_contact_id" = OLD."id"
            AND (
              NEW."type" <> 'organization'
              OR context."tenant_id" <> NEW."tenant_id"
              OR context."workspace_id" <> NEW."workspace_id"
            )
        ) THEN
          RAISE EXCEPTION 'contact update would invalidate an organization relationship'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_contacts_company_relationship_invariants"
      ON "contacts";
      CREATE TRIGGER "TR_contacts_company_relationship_invariants"
      BEFORE UPDATE OF "tenant_id", "workspace_id", "type"
      ON "contacts"
      FOR EACH ROW EXECUTE FUNCTION protect_contact_company_relationship_invariants();
    `);

    await queryRunner.query(`
      CREATE OR REPLACE FUNCTION protect_agency_client_company_context_scope()
      RETURNS trigger AS $$
      BEGIN
        IF EXISTS (
          SELECT 1 FROM "agency_client_company_contexts" context
          WHERE context."agency_client_id" = OLD."id"
            AND (
              context."tenant_id" <> NEW."tenant_id"
              OR context."workspace_id" <> NEW."workspace_id"
            )
        ) THEN
          RAISE EXCEPTION 'agency client update would invalidate company context scope'
            USING ERRCODE = '23514';
        END IF;
        RETURN NEW;
      END;
      $$ LANGUAGE plpgsql;
    `);
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_agency_clients_company_context_scope"
      ON "agency_clients";
      CREATE TRIGGER "TR_agency_clients_company_context_scope"
      BEFORE UPDATE OF "tenant_id", "workspace_id"
      ON "agency_clients"
      FOR EACH ROW EXECUTE FUNCTION protect_agency_client_company_context_scope();
    `);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_contacts_company_relationship_invariants"
      ON "contacts";
    `);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS protect_contact_company_relationship_invariants();`,
    );
    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_agency_clients_company_context_scope"
      ON "agency_clients";
    `);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS protect_agency_client_company_context_scope();`,
    );
    await queryRunner.query(
      // A direct down/up verification can run against a database that already
      // contains later Company Context migrations. Their foreign keys must be
      // removed together with this migration's root table.
      `DROP TABLE IF EXISTS "agency_client_company_contexts" CASCADE;`,
    );
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS validate_agency_client_company_context_scope();`,
    );

    await queryRunner.query(`
      DROP TRIGGER IF EXISTS "TR_contact_company_links_scope_type"
      ON "contact_company_links";
    `);
    await queryRunner.query(
      `DROP FUNCTION IF EXISTS validate_contact_company_link_scope_and_type();`,
    );
    await queryRunner.query(
      `DROP INDEX IF EXISTS "uq_contact_company_links_active_primary";`,
    );
    await queryRunner.query(`
      ALTER TABLE "contact_company_links"
        DROP CONSTRAINT IF EXISTS "CK_contact_company_links_status",
        DROP COLUMN IF EXISTS "updated_at",
        DROP COLUMN IF EXISTS "status",
        DROP COLUMN IF EXISTS "is_primary",
        DROP COLUMN IF EXISTS "role";
    `);
  }
}
