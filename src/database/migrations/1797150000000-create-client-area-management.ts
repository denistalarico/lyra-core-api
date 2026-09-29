import type { MigrationInterface, QueryRunner } from 'typeorm';
import { getPermissionDefinition } from '../../modules/permissions/catalog/permission-keys.catalog';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../../modules/permissions/catalog/role-permission-matrix.catalog';
import { PLATFORM_ROLE_KEYS } from '../../modules/permissions/enums/permission.enums';

const PERMISSION = 'agency.client_area.manage.admin';

/** CA3: configuration has its own tables rather than overloading generic apps JSON. */
export class CreateClientAreaManagement1797150000000 implements MigrationInterface {
  name = 'CreateClientAreaManagement1797150000000';

  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_area_settings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL, "enabled" boolean NOT NULL DEFAULT false,
      "branding_mode" varchar(16) NOT NULL DEFAULT 'agency', "display_name" varchar(120),
      "logo_light_url" text, "logo_dark_url" text, "mark_light_url" text, "mark_dark_url" text,
      "favicon_url" text, "primary_color" varchar(7), "secondary_color" varchar(7),
      "login_layout" varchar(16) NOT NULL DEFAULT 'centered', "login_heading" varchar(160),
      "login_supporting_text" varchar(500), "login_background_color" varchar(7),
      "default_role" varchar(24) NOT NULL DEFAULT 'client_viewer',
      "approvals_default_enabled" boolean NOT NULL DEFAULT false,
      "domain_mode" varchar(16) NOT NULL DEFAULT 'default', "custom_domain" varchar(253),
      "domain_verification_status" varchar(24) NOT NULL DEFAULT 'not_configured',
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_client_area_settings_tenant_workspace" UNIQUE ("tenant_id","workspace_id"),
      CONSTRAINT "CK_client_area_settings_branding" CHECK ("branding_mode" IN ('agency','custom')),
      CONSTRAINT "CK_client_area_settings_layout" CHECK ("login_layout" IN ('centered','split')),
      CONSTRAINT "CK_client_area_settings_role" CHECK ("default_role" IN ('client_admin','client_operator','client_viewer')),
      CONSTRAINT "CK_client_area_settings_domain_mode" CHECK ("domain_mode" IN ('default','custom')),
      CONSTRAINT "CK_client_area_settings_domain_status" CHECK ("domain_verification_status" IN ('not_configured','pending','verified','failed')),
      CONSTRAINT "CK_client_area_settings_colors" CHECK (("primary_color" IS NULL OR "primary_color" ~ '^#[0-9A-Fa-f]{6}$') AND ("secondary_color" IS NULL OR "secondary_color" ~ '^#[0-9A-Fa-f]{6}$') AND ("login_background_color" IS NULL OR "login_background_color" ~ '^#[0-9A-Fa-f]{6}$')),
      CONSTRAINT "CK_client_area_settings_domain" CHECK (("domain_mode" = 'default' AND "custom_domain" IS NULL AND "domain_verification_status" = 'not_configured') OR ("domain_mode" = 'custom' AND "custom_domain" IS NOT NULL))
    )`);
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_area_company_settings" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL,
      "workspace_id" uuid NOT NULL, "agency_client_id" uuid NOT NULL, "company_context_id" uuid NOT NULL,
      "enabled" boolean NOT NULL DEFAULT false, "approvals_enabled" boolean NOT NULL DEFAULT false,
      "default_role" varchar(24) NOT NULL DEFAULT 'client_viewer',
      "created_at" timestamptz NOT NULL DEFAULT now(), "updated_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "UQ_client_area_company_settings_company" UNIQUE ("company_context_id"),
      CONSTRAINT "CK_client_area_company_settings_role" CHECK ("default_role" IN ('client_admin','client_operator','client_viewer')),
      CONSTRAINT "FK_client_area_company_settings_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id") REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_area_company_settings_scope" ON "client_area_company_settings" ("tenant_id","workspace_id","agency_client_id")`,
    );
    await queryRunner.query(`CREATE TABLE IF NOT EXISTS "client_area_preview_events" (
      "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(), "tenant_id" uuid NOT NULL, "workspace_id" uuid NOT NULL,
      "agency_client_id" uuid NOT NULL, "company_context_id" uuid NOT NULL, "agency_actor_user_id" uuid NOT NULL,
      "target_membership_id" uuid NOT NULL, "action" varchar(24) NOT NULL, "created_at" timestamptz NOT NULL DEFAULT now(),
      CONSTRAINT "CK_client_area_preview_events_action" CHECK ("action" IN ('preview_started','preview_ended')),
      CONSTRAINT "FK_client_area_preview_events_company" FOREIGN KEY ("company_context_id","tenant_id","workspace_id","agency_client_id") REFERENCES "agency_client_company_contexts" ("id","tenant_id","workspace_id","agency_client_id") ON DELETE RESTRICT,
      CONSTRAINT "FK_client_area_preview_events_membership" FOREIGN KEY ("target_membership_id") REFERENCES "client_area_memberships" ("id") ON DELETE RESTRICT
    )`);
    await queryRunner.query(
      `CREATE INDEX IF NOT EXISTS "IDX_client_area_preview_events_scope" ON "client_area_preview_events" ("tenant_id","company_context_id","created_at")`,
    );
    await this.seedPermission(queryRunner);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM platform_role_permissions WHERE permission_key = $1 AND tenant_id IS NULL`,
      [PERMISSION],
    );
    await queryRunner.query(`DELETE FROM platform_permissions WHERE key = $1`, [
      PERMISSION,
    ]);
    await queryRunner.query(
      `DROP TABLE IF EXISTS "client_area_preview_events"`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS "client_area_company_settings"`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS "client_area_settings"`);
  }

  private async seedPermission(queryRunner: QueryRunner) {
    const definition = getPermissionDefinition(PERMISSION);
    if (!definition)
      throw new Error(`Missing permission definition: ${PERMISSION}`);
    await queryRunner.query(
      `INSERT INTO platform_permissions (key, product_key, module_key, resource_key, action_key, scope_key, risk_level, is_dangerous, is_system) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,true) ON CONFLICT (key) DO UPDATE SET product_key=EXCLUDED.product_key,module_key=EXCLUDED.module_key,resource_key=EXCLUDED.resource_key,action_key=EXCLUDED.action_key,scope_key=EXCLUDED.scope_key,risk_level=EXCLUDED.risk_level,is_dangerous=EXCLUDED.is_dangerous,is_system=true,updated_at=now()`,
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
    for (const roleKey of PLATFORM_ROLE_KEYS)
      if (DEFAULT_ROLE_PERMISSION_MATRIX[roleKey].includes(PERMISSION))
        await queryRunner.query(
          `INSERT INTO platform_role_permissions (role_id, permission_key, enabled) SELECT id,$1,true FROM platform_roles WHERE tenant_id IS NULL AND key=$2 ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL DO UPDATE SET enabled=true,updated_at=now()`,
          [PERMISSION, roleKey],
        );
  }
}
