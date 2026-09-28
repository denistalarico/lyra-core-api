import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * CA1 — Client Area identity & membership foundation.
 *
 * `client_area_memberships` binds an existing `user_security_settings`
 * identity of the agency tenant to one Company Context. It carries the full
 * operational tuple redundantly and a composite FK so the database refuses a
 * membership that describes an impossible tenant/workspace/client/company
 * combination (same pattern as AP1 approvals).
 *
 * `user_sessions.surface` and `user_login_events.surface` separate the Agency
 * and Client Area sessions/events that share those tables. Existing rows are
 * Agency by default, so current sessions keep refreshing unchanged.
 *
 * Idempotent (`IF NOT EXISTS` / guarded constraints): postgres specs re-run
 * `up()` against an already migrated database.
 */
export class CreateClientAreaMemberships1797000000000 implements MigrationInterface {
  name = 'CreateClientAreaMemberships1797000000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_area_memberships" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid NOT NULL,
      "company_context_id" uuid NOT NULL,
      "user_id" uuid NOT NULL,
      "role" varchar(24) NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'active',
      "granted_by_user_id" uuid,
      "granted_at" timestamptz NOT NULL DEFAULT now(),
      "revoked_by_user_id" uuid,
      "revoked_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_client_area_memberships_role" CHECK ("role" IN ('client_admin','client_operator','client_viewer')),
      CONSTRAINT "CK_client_area_memberships_status" CHECK ("status" IN ('active','revoked')),
      CONSTRAINT "CK_client_area_memberships_revocation" CHECK (("status" = 'revoked') = ("revoked_at" IS NOT NULL)),
      CONSTRAINT "CK_client_area_memberships_revoked_by" CHECK ("revoked_by_user_id" IS NULL OR "status" = 'revoked'),
      CONSTRAINT "FK_client_area_memberships_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id")
        REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_area_memberships_active" ON "client_area_memberships" ("company_context_id","user_id") WHERE "status" = 'active'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_area_memberships_user" ON "client_area_memberships" ("tenant_id","user_id","status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_area_memberships_company" ON "client_area_memberships" ("tenant_id","workspace_id","company_context_id","status")`,
    );

    for (const table of ['user_sessions', 'user_login_events']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD COLUMN IF NOT EXISTS "surface" varchar(16) NOT NULL DEFAULT 'agency'`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "CK_${table}_surface"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" ADD CONSTRAINT "CK_${table}_surface" CHECK ("surface" IN ('agency','client_area'))`,
      );
    }
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_user_sessions_surface_tenant_user" ON "user_sessions" ("surface","tenant_id","user_id")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Without the column a Client Area session would become indistinguishable
    // from an Agency one, so it is revoked before the discriminator goes away.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'user_sessions' AND column_name = 'surface' AND table_schema = current_schema()) THEN
        UPDATE "user_sessions" SET "status" = 'expired', "revoked_at" = COALESCE("revoked_at", now()) WHERE "surface" = 'client_area';
      END IF;
    END $$`);
    await queryRunner.query(
      'DROP INDEX IF EXISTS "IDX_user_sessions_surface_tenant_user"',
    );
    for (const table of ['user_login_events', 'user_sessions']) {
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP CONSTRAINT IF EXISTS "CK_${table}_surface"`,
      );
      await queryRunner.query(
        `ALTER TABLE "${table}" DROP COLUMN IF EXISTS "surface"`,
      );
    }
    await queryRunner.query('DROP TABLE IF EXISTS "client_area_memberships"');
  }
}
