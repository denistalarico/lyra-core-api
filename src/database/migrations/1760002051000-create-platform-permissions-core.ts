import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PLATFORM_ROLE_KEYS,
  PlatformRoleKey,
} from '../../modules/permissions/enums/permission.enums';
import { PERMISSION_DEFINITIONS } from '../../modules/permissions/catalog/permission-keys.catalog';
import {
  DEFAULT_ROLE_DESCRIPTIONS,
  DEFAULT_ROLE_PERMISSION_MATRIX,
} from '../../modules/permissions/catalog/role-permission-matrix.catalog';

const ROLE_NAMES: Record<PlatformRoleKey, string> = {
  [PlatformRoleKey.Owner]: 'Owner',
  [PlatformRoleKey.Admin]: 'Admin',
  [PlatformRoleKey.Manager]: 'Manager',
  [PlatformRoleKey.Member]: 'Member',
};

export class CreatePlatformPermissionsCore1760002051000 implements MigrationInterface {
  name = 'CreatePlatformPermissionsCore1760002051000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`CREATE EXTENSION IF NOT EXISTS "pgcrypto"`);

    // 12.1 platform_roles
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_roles (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid,
        key varchar(40) NOT NULL,
        name varchar(120) NOT NULL,
        description text,
        role_type varchar(20) NOT NULL DEFAULT 'global',
        is_system boolean NOT NULL DEFAULT false,
        is_default boolean NOT NULL DEFAULT false,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_roles_system_key
      ON platform_roles (key)
      WHERE tenant_id IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_roles_tenant_key
      ON platform_roles (tenant_id, key)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_roles_tenant_key
      ON platform_roles (tenant_id, key)
      WHERE tenant_id IS NOT NULL
    `);

    // 12.2 platform_permissions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        key varchar(160) NOT NULL UNIQUE,
        product_key varchar(30) NOT NULL,
        module_key varchar(60) NOT NULL,
        resource_key varchar(120) NOT NULL,
        action_key varchar(60) NOT NULL,
        scope_key varchar(60),
        description text,
        risk_level varchar(20) NOT NULL DEFAULT 'low',
        is_dangerous boolean NOT NULL DEFAULT false,
        is_system boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_permissions_product_module
      ON platform_permissions (product_key, module_key)
    `);

    // 12.3 platform_role_permissions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_role_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid,
        role_id uuid NOT NULL REFERENCES platform_roles(id) ON DELETE CASCADE,
        permission_key varchar(160) NOT NULL REFERENCES platform_permissions(key) ON DELETE CASCADE,
        enabled boolean NOT NULL DEFAULT true,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_role_permissions_system
      ON platform_role_permissions (role_id, permission_key)
      WHERE tenant_id IS NULL
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_role_permissions_tenant_role
      ON platform_role_permissions (tenant_id, role_id)
    `);

    await queryRunner.query(`
      CREATE UNIQUE INDEX IF NOT EXISTS uq_platform_role_permissions_tenant
      ON platform_role_permissions (tenant_id, role_id, permission_key)
      WHERE tenant_id IS NOT NULL
    `);

    // 12.4 platform_user_permissions
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_user_permissions (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid,
        user_id uuid NOT NULL,
        permission_key varchar(160) NOT NULL,
        enabled boolean NOT NULL DEFAULT true,
        scope_type varchar(30),
        scope_id uuid,
        reason text,
        expires_at timestamptz,
        created_by_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_user_permissions_tenant_user
      ON platform_user_permissions (tenant_id, user_id)
    `);

    // 12.5 agency_client_access
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_client_access (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        client_id uuid NOT NULL,
        managed_tenant_id uuid,
        user_id uuid NOT NULL,
        role_key varchar(20) NOT NULL,
        access_level varchar(20) NOT NULL DEFAULT 'basic',
        created_by_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_agency_client_access_client_user UNIQUE (tenant_id, client_id, user_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_client_access_tenant_client
      ON agency_client_access (tenant_id, client_id)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_client_access_tenant_user
      ON agency_client_access (tenant_id, user_id)
    `);

    // 12.6 agency_client_product_access
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS agency_client_product_access (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid NOT NULL,
        client_id uuid NOT NULL,
        managed_tenant_id uuid,
        product_key varchar(20) NOT NULL,
        user_id uuid NOT NULL,
        role_key varchar(20) NOT NULL,
        scope_key varchar(30),
        created_by_id uuid,
        created_at timestamptz NOT NULL DEFAULT now(),
        updated_at timestamptz NOT NULL DEFAULT now(),
        CONSTRAINT uq_agency_client_product_access UNIQUE (tenant_id, client_id, product_key, user_id)
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_client_product_access_tenant_client_product
      ON agency_client_product_access (tenant_id, client_id, product_key)
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_agency_client_product_access_tenant_user
      ON agency_client_product_access (tenant_id, user_id)
    `);

    // 12.7 platform_permission_audit_events
    await queryRunner.query(`
      CREATE TABLE IF NOT EXISTS platform_permission_audit_events (
        id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
        tenant_id uuid NOT NULL,
        workspace_id uuid,
        actor_user_id uuid,
        target_user_id uuid,
        action varchar(60) NOT NULL,
        permission_key varchar(160),
        resource_type varchar(80),
        resource_id uuid,
        risk_level varchar(20),
        metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
        created_at timestamptz NOT NULL DEFAULT now()
      )
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS idx_platform_permission_audit_tenant_created
      ON platform_permission_audit_events (tenant_id, created_at)
    `);

    await this.seedDefaults(queryRunner);
  }

  private async seedDefaults(queryRunner: QueryRunner): Promise<void> {
    // Seed system roles (tenant_id IS NULL) and capture their ids.
    const roleIdByKey = new Map<PlatformRoleKey, string>();

    for (const roleKey of PLATFORM_ROLE_KEYS) {
      const result = await queryRunner.query(
        `
          INSERT INTO platform_roles (key, name, description, role_type, is_system, is_default)
          VALUES ($1, $2, $3, 'global', true, true)
          ON CONFLICT (key) WHERE tenant_id IS NULL DO UPDATE SET name = EXCLUDED.name
          RETURNING id
        `,
        [roleKey, ROLE_NAMES[roleKey], DEFAULT_ROLE_DESCRIPTIONS[roleKey]],
      );

      roleIdByKey.set(roleKey, result[0].id);
    }

    // Seed permission catalog.
    for (const definition of PERMISSION_DEFINITIONS) {
      await queryRunner.query(
        `
          INSERT INTO platform_permissions (
            key, product_key, module_key, resource_key, action_key, scope_key,
            risk_level, is_dangerous, is_system
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
          ON CONFLICT (key) DO NOTHING
        `,
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
    }

    // Seed default role -> permission matrix (system rows, tenant_id IS NULL).
    for (const roleKey of PLATFORM_ROLE_KEYS) {
      const roleId = roleIdByKey.get(roleKey);
      const permissionKeys = DEFAULT_ROLE_PERMISSION_MATRIX[roleKey];

      for (const permissionKey of permissionKeys) {
        await queryRunner.query(
          `
            INSERT INTO platform_role_permissions (role_id, permission_key, enabled)
            VALUES ($1, $2, true)
            ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL DO NOTHING
          `,
          [roleId, permissionKey],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DROP TABLE IF EXISTS platform_permission_audit_events`,
    );
    await queryRunner.query(
      `DROP TABLE IF EXISTS agency_client_product_access`,
    );
    await queryRunner.query(`DROP TABLE IF EXISTS agency_client_access`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_user_permissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_role_permissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_permissions`);
    await queryRunner.query(`DROP TABLE IF EXISTS platform_roles`);
  }
}
