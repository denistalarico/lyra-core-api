import type { MigrationInterface, QueryRunner } from 'typeorm';
import { getPermissionDefinition } from '../../modules/permissions/catalog/permission-keys.catalog';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../../modules/permissions/catalog/role-permission-matrix.catalog';
import { PLATFORM_ROLE_KEYS } from '../../modules/permissions/enums/permission.enums';

const BOOST_PERMISSION = 'social.ads.boost.execute.admin_or_explicit';

/** C7: confirmed, idempotent Planner Boost execution audit. */
export class CreateSocialBoostRequests1793700000000 implements MigrationInterface {
  name = 'CreateSocialBoostRequests1793700000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "social_ad_action_policies"
        ADD COLUMN IF NOT EXISTS "allow_boost" boolean NOT NULL DEFAULT false
    `);
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS "social_boost_requests" (
        "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        "tenant_id" uuid NOT NULL,
        "workspace_id" uuid NOT NULL,
        "agency_client_id" uuid,
        "connection_id" uuid NOT NULL,
        "publication_id" uuid NOT NULL,
        "content_item_id" uuid NOT NULL,
        "boost_template_id" uuid NOT NULL,
        "status" varchar(30) NOT NULL,
        "request_id" uuid NOT NULL,
        "confirmation_request_id" uuid,
        "template_snapshot" jsonb NOT NULL,
        "publication_snapshot" jsonb NOT NULL,
        "provider_result" jsonb,
        "expires_at" timestamptz NOT NULL,
        "proposed_by_id" uuid,
        "confirmed_by_id" uuid,
        "error_code" varchar(120),
        "executed_at" timestamptz,
        "created_at" timestamptz NOT NULL DEFAULT now(),
        "updated_at" timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT "UQ_social_boost_requests_request_id" UNIQUE ("request_id"),
        CONSTRAINT "UQ_social_boost_requests_confirmation_request_id"
          UNIQUE ("confirmation_request_id"),
        CONSTRAINT "FK_social_boost_requests_connection"
          FOREIGN KEY ("connection_id") REFERENCES "social_ad_account_connections" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_social_boost_requests_publication"
          FOREIGN KEY ("publication_id") REFERENCES "social_publications" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_social_boost_requests_content_item"
          FOREIGN KEY ("content_item_id") REFERENCES "social_content_items" ("id") ON DELETE RESTRICT,
        CONSTRAINT "FK_social_boost_requests_template"
          FOREIGN KEY ("boost_template_id") REFERENCES "social_boost_templates" ("id") ON DELETE RESTRICT,
        CONSTRAINT "CK_social_boost_requests_status"
          CHECK ("status" IN ('pending_confirmation', 'executing', 'created_paused', 'blocked', 'failed', 'expired'))
      )
    `);
    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_social_boost_requests_scope"
        ON "social_boost_requests"
        ("tenant_id", "workspace_id", "agency_client_id", "publication_id")
    `);
    const permission = getPermissionDefinition(BOOST_PERMISSION);
    if (!permission)
      throw new Error(`Missing permission definition: ${BOOST_PERMISSION}`);
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
        permission.key,
        permission.productKey,
        permission.moduleKey,
        permission.resourceKey,
        permission.actionKey,
        permission.scopeKey,
        permission.riskLevel,
        permission.isDangerous,
      ],
    );
    for (const roleKey of PLATFORM_ROLE_KEYS) {
      if (!DEFAULT_ROLE_PERMISSION_MATRIX[roleKey].includes(BOOST_PERMISSION))
        continue;
      await queryRunner.query(
        `INSERT INTO platform_role_permissions (role_id, permission_key, enabled)
         SELECT id, $1, true FROM platform_roles
          WHERE tenant_id IS NULL AND key = $2
         ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL
         DO UPDATE SET enabled=true, updated_at=now()`,
        [BOOST_PERMISSION, roleKey],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM platform_role_permissions
        WHERE permission_key = $1 AND tenant_id IS NULL`,
      [BOOST_PERMISSION],
    );
    await queryRunner.query(`DELETE FROM platform_permissions WHERE key = $1`, [
      BOOST_PERMISSION,
    ]);
    await queryRunner.query(`DROP TABLE IF EXISTS "social_boost_requests"`);
    await queryRunner.query(`
      ALTER TABLE "social_ad_action_policies"
        DROP COLUMN IF EXISTS "allow_boost"
    `);
  }
}
