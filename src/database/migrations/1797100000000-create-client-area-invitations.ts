import type { MigrationInterface, QueryRunner } from 'typeorm';
import { getPermissionDefinition } from '../../modules/permissions/catalog/permission-keys.catalog';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../../modules/permissions/catalog/role-permission-matrix.catalog';
import { PLATFORM_ROLE_KEYS } from '../../modules/permissions/enums/permission.enums';

const MANAGE_PERMISSION = 'agency.clients.client_area_members.manage.admin';
const ROLES = `('client_admin','client_operator','client_viewer')`;

/**
 * CA2 — Client Area invitations & member management.
 *
 * - `client_area_invitations`: tokenized invitation of one email to one
 *   Company Context. Same composite FK as the memberships, so an invitation
 *   can never describe an impossible tenant/workspace/client/company tuple.
 *   Only the sha256 of the token is stored (unique). One `pending` row per
 *   (company, normalized email); accepted/revoked rows are history.
 * - `client_area_member_events`: append-only audit of invitation/member
 *   operations (actor, action, target, company, roles, timestamp).
 * - `password_resets.surface`: the Client Area reuses the Agency reset
 *   storage; each surface redeems only its own tokens. Existing rows are
 *   Agency by default.
 * - Seeds `agency.clients.client_area_members.manage.admin` (Admin+).
 *
 * Idempotent (`IF NOT EXISTS` / guarded constraints): postgres specs re-run
 * `up()` against an already migrated database.
 */
export class CreateClientAreaInvitations1797100000000 implements MigrationInterface {
  name = 'CreateClientAreaInvitations1797100000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_area_invitations" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid NOT NULL,
      "company_context_id" uuid NOT NULL,
      "email" varchar(160) NOT NULL,
      "email_normalized" varchar(160) NOT NULL,
      "role" varchar(24) NOT NULL,
      "token_hash" varchar(64) NOT NULL,
      "expires_at" timestamptz NOT NULL,
      "status" varchar(16) NOT NULL DEFAULT 'pending',
      "invited_by_user_id" uuid NOT NULL,
      "accepted_user_id" uuid,
      "accepted_membership_id" uuid,
      "accepted_at" timestamptz,
      "revoked_by_user_id" uuid,
      "revoked_at" timestamptz,
      "superseded_by_invitation_id" uuid,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_client_area_invitations_role" CHECK ("role" IN ${ROLES}),
      CONSTRAINT "CK_client_area_invitations_status" CHECK ("status" IN ('pending','accepted','revoked')),
      CONSTRAINT "CK_client_area_invitations_email" CHECK ("email_normalized" = lower(btrim("email")) AND length("email_normalized") >= 3),
      CONSTRAINT "CK_client_area_invitations_token_hash" CHECK ("token_hash" ~ '^[0-9a-f]{64}$'),
      CONSTRAINT "CK_client_area_invitations_expiry" CHECK ("expires_at" > "created_at"),
      CONSTRAINT "CK_client_area_invitations_accepted" CHECK (
        ("status" = 'accepted' AND "accepted_at" IS NOT NULL AND "accepted_user_id" IS NOT NULL AND "accepted_membership_id" IS NOT NULL)
        OR ("status" <> 'accepted' AND "accepted_at" IS NULL AND "accepted_user_id" IS NULL AND "accepted_membership_id" IS NULL)
      ),
      CONSTRAINT "CK_client_area_invitations_revoked" CHECK (
        ("status" = 'revoked') = ("revoked_at" IS NOT NULL)
        AND ("revoked_by_user_id" IS NULL OR "status" = 'revoked')
        AND ("superseded_by_invitation_id" IS NULL OR "status" = 'revoked')
      ),
      CONSTRAINT "FK_client_area_invitations_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id")
        REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT,
      CONSTRAINT "FK_client_area_invitations_membership" FOREIGN KEY ("accepted_membership_id")
        REFERENCES "client_area_memberships" ("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_client_area_invitations_superseded_by" FOREIGN KEY ("superseded_by_invitation_id")
        REFERENCES "client_area_invitations" ("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_area_invitations_token_hash" ON "client_area_invitations" ("token_hash")`,
    );
    await queryRunner.query(
      `CREATE UNIQUE INDEX IF NOT EXISTS "UQ_client_area_invitations_pending" ON "client_area_invitations" ("company_context_id","email_normalized") WHERE "status" = 'pending'`,
    );
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_area_invitations_company" ON "client_area_invitations" ("tenant_id","workspace_id","company_context_id","status")`,
    );

    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_area_member_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid NOT NULL,
      "company_context_id" uuid NOT NULL,
      "action" varchar(40) NOT NULL,
      "actor_surface" varchar(16) NOT NULL,
      "actor_user_id" uuid,
      "invitation_id" uuid,
      "membership_id" uuid,
      "target_user_id" uuid,
      "target_email" varchar(160),
      "previous_role" varchar(24),
      "new_role" varchar(24),
      "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
      "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_client_area_member_events_action" CHECK ("action" IN ('invited','invitation_resent','invitation_revoked','invitation_accepted','invitation_acceptance_blocked','role_changed','membership_revoked')),
      CONSTRAINT "CK_client_area_member_events_actor_surface" CHECK ("actor_surface" IN ('agency','client_area')),
      CONSTRAINT "CK_client_area_member_events_actor" CHECK ("actor_user_id" IS NOT NULL OR "action" = 'invitation_acceptance_blocked'),
      CONSTRAINT "CK_client_area_member_events_roles" CHECK (("previous_role" IS NULL OR "previous_role" IN ${ROLES}) AND ("new_role" IS NULL OR "new_role" IN ${ROLES})),
      CONSTRAINT "CK_client_area_member_events_role_change" CHECK ("action" <> 'role_changed' OR ("previous_role" IS NOT NULL AND "new_role" IS NOT NULL AND "previous_role" <> "new_role")),
      CONSTRAINT "FK_client_area_member_events_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id")
        REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT,
      CONSTRAINT "FK_client_area_member_events_invitation" FOREIGN KEY ("invitation_id")
        REFERENCES "client_area_invitations" ("id") ON DELETE RESTRICT,
      CONSTRAINT "FK_client_area_member_events_membership" FOREIGN KEY ("membership_id")
        REFERENCES "client_area_memberships" ("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_area_member_events_company" ON "client_area_member_events" ("tenant_id","company_context_id","created_at")`,
    );

    await queryRunner.query(
      `ALTER TABLE "password_resets" ADD COLUMN IF NOT EXISTS "surface" varchar(16) NOT NULL DEFAULT 'agency'`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" DROP CONSTRAINT IF EXISTS "CK_password_resets_surface"`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" ADD CONSTRAINT "CK_password_resets_surface" CHECK ("surface" IN ('agency','client_area'))`,
    );

    await this.seedPermission(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM platform_role_permissions WHERE permission_key = $1 AND tenant_id IS NULL`,
      [MANAGE_PERMISSION],
    );
    await queryRunner.query(`DELETE FROM platform_permissions WHERE key = $1`, [
      MANAGE_PERMISSION,
    ]);

    // Without the column a Client Area reset link would become redeemable on
    // the Agency endpoint, so outstanding ones are burned first.
    await queryRunner.query(`DO $$ BEGIN
      IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'password_resets' AND column_name = 'surface' AND table_schema = current_schema()) THEN
        UPDATE "password_resets" SET "used_at" = COALESCE("used_at", now()) WHERE "surface" = 'client_area';
      END IF;
    END $$`);
    await queryRunner.query(
      `ALTER TABLE "password_resets" DROP CONSTRAINT IF EXISTS "CK_password_resets_surface"`,
    );
    await queryRunner.query(
      `ALTER TABLE "password_resets" DROP COLUMN IF EXISTS "surface"`,
    );

    await queryRunner.query('DROP TABLE IF EXISTS "client_area_member_events"');
    await queryRunner.query('DROP TABLE IF EXISTS "client_area_invitations"');
  }

  private async seedPermission(queryRunner: QueryRunner) {
    const definition = getPermissionDefinition(MANAGE_PERMISSION);

    if (!definition) {
      throw new Error(`Missing permission definition: ${MANAGE_PERMISSION}`);
    }

    await queryRunner.query(
      `INSERT INTO platform_permissions
         (key, product_key, module_key, resource_key, action_key, scope_key,
          risk_level, is_dangerous, is_system)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true)
       ON CONFLICT (key) DO UPDATE SET
         product_key=EXCLUDED.product_key, module_key=EXCLUDED.module_key,
         resource_key=EXCLUDED.resource_key, action_key=EXCLUDED.action_key,
         scope_key=EXCLUDED.scope_key, risk_level=EXCLUDED.risk_level,
         is_dangerous=EXCLUDED.is_dangerous, is_system=true, updated_at=now()`,
      [
        definition.key,
        definition.productKey,
        definition.moduleKey,
        definition.resourceKey,
        definition.actionKey,
        definition.scopeKey,
        definition.riskLevel,
        definition.isDangerous,
      ],
    );

    for (const roleKey of PLATFORM_ROLE_KEYS) {
      if (
        !DEFAULT_ROLE_PERMISSION_MATRIX[roleKey].includes(MANAGE_PERMISSION)
      ) {
        continue;
      }

      await queryRunner.query(
        `INSERT INTO platform_role_permissions (role_id, permission_key, enabled)
         SELECT id, $1, true FROM platform_roles
          WHERE tenant_id IS NULL AND key = $2
         ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL
         DO UPDATE SET enabled=true, updated_at=now()`,
        [MANAGE_PERMISSION, roleKey],
      );
    }
  }
}
