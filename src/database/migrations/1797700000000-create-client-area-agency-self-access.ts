import type { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * PD3 — Agency self-context.
 *
 * The agency consumes its own Client Area as a second surface. This could not
 * reuse `client_area_memberships`: there `agency_client_id` and
 * `company_context_id` are `NOT NULL` and part of a composite FK to
 * `agency_client_company_contexts`, so a self row would require a fake
 * AgencyClient + Company Context + organization Contact — exactly what would
 * contaminate CRM, Finance, Profitability and every per-client report.
 *
 * Two independent axes, deliberately not collapsed into one:
 *
 *  - `client_area_settings.self_enabled` — the agency switched its own area on
 *    (one row per workspace, reuses the existing CA3 table);
 *  - `client_area_self_access` — which Agency identity may enter, with which
 *    client-side role.
 *
 * Separating them is what makes "disable the agency's self area" and "remove
 * this person's access" distinct operations with distinct session revocation.
 *
 * `client_area_self_access_events` is the audit trail. It could not reuse
 * `client_area_member_events` for the same NOT NULL reason as above.
 */
export class CreateClientAreaAgencySelfAccess1797700000000 implements MigrationInterface {
  name = 'CreateClientAreaAgencySelfAccess1797700000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    // Self-context activation lives on the agency's existing settings row:
    // it is one flag per workspace, not a new scope.
    await queryRunner.query(
      `ALTER TABLE "client_area_settings" ADD COLUMN IF NOT EXISTS "self_enabled" boolean NOT NULL DEFAULT false`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_area_self_access" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "user_id" uuid NOT NULL,
      "role" varchar(24) NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'active',
      "granted_by_user_id" uuid,
      "granted_at" timestamptz NOT NULL DEFAULT now(),
      "revoked_by_user_id" uuid,
      "revoked_at" timestamptz,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      -- No company columns at all: the self-context has no AgencyClient, no
      -- Company Context and no managed tenant, and must never acquire one.
      CONSTRAINT "CK_client_area_self_access_role"
        CHECK ("role" IN ('client_admin','client_operator','client_viewer')),
      CONSTRAINT "CK_client_area_self_access_status"
        CHECK ("status" IN ('active','revoked')),
      CONSTRAINT "CK_client_area_self_access_revocation"
        CHECK (("status" = 'revoked') = ("revoked_at" IS NOT NULL)),
      CONSTRAINT "CK_client_area_self_access_revoked_by"
        CHECK ("revoked_by_user_id" IS NULL OR "status" = 'revoked')
    )`);

    // Re-granting after a revoke creates a new row, so the unique index is
    // partial on the active status — same shape as CA1 memberships.
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_area_self_access_active"
        ON "client_area_self_access" ("tenant_id","workspace_id","user_id") WHERE "status" = 'active'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_area_self_access_user"
        ON "client_area_self_access" ("tenant_id","user_id","status")`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_area_self_access_workspace"
        ON "client_area_self_access" ("tenant_id","workspace_id","status")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_area_self_access_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "action" varchar(40) NOT NULL,
      "actor_user_id" uuid,
      "target_user_id" uuid,
      "previous_role" varchar(24),
      "new_role" varchar(24),
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_client_area_self_access_events_action"
        CHECK ("action" IN (
          'self_area_enabled','self_area_disabled',
          'self_access_granted','self_access_revoked','self_access_role_changed')),
      CONSTRAINT "CK_client_area_self_access_events_roles"
        CHECK (("previous_role" IS NULL OR "previous_role" IN ('client_admin','client_operator','client_viewer'))
           AND ("new_role" IS NULL OR "new_role" IN ('client_admin','client_operator','client_viewer')))
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_area_self_access_events_scope"
        ON "client_area_self_access_events" ("tenant_id","workspace_id","created_at")`,
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    // Client Area sessions opened through a self access must not survive as
    // indistinguishable sessions once the self-context stops existing — the
    // same reasoning CA1's down() applied to `user_sessions.surface`.
    await queryRunner.query(
      `UPDATE "user_sessions" SET "status" = 'expired', "revoked_at" = now()
        WHERE "surface" = 'client_area' AND "revoked_at" IS NULL
          AND ("tenant_id","user_id") IN (
            SELECT "tenant_id","user_id" FROM "client_area_self_access" WHERE "status" = 'active')`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "client_area_self_access_events"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "client_area_self_access"`);
    await queryRunner.query(
      `ALTER TABLE "client_area_settings" DROP COLUMN IF EXISTS "self_enabled"`,
    );
  }
}
