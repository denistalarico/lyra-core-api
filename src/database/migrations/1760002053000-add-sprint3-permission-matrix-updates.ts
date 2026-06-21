import { MigrationInterface, QueryRunner } from 'typeorm';

const PERMISSIONS_TO_REMOVE_FROM_MEMBER = [
  'agency.clients.profile.view.basic.assigned',
  'agency.contracts.view.assigned',
];

const TEAM_STRUCTURE_PERMISSIONS = [
  {
    key: 'agency.team.structure.manage.admin',
    productKey: 'agency',
    moduleKey: 'team',
    resourceKey: 'structure',
    actionKey: 'manage',
    scopeKey: 'admin',
    riskLevel: 'high',
    isDangerous: false,
    roles: ['admin', 'owner'],
  },
  {
    key: 'agency.team.structure.delete.owner_only',
    productKey: 'agency',
    moduleKey: 'team',
    resourceKey: 'structure',
    actionKey: 'delete',
    scopeKey: 'owner_only',
    riskLevel: 'critical',
    isDangerous: true,
    roles: ['owner'],
  },
];

export class AddSprint3PermissionMatrixUpdates1760002053000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permission of TEAM_STRUCTURE_PERMISSIONS) {
      await queryRunner.query(
        `
          INSERT INTO platform_permissions (
            key, product_key, module_key, resource_key, action_key, scope_key,
            risk_level, is_dangerous, is_system
          )
          VALUES ($1, $2, $3, $4, $5, $6, $7, $8, true)
          ON CONFLICT (key) DO UPDATE SET
            product_key = EXCLUDED.product_key,
            module_key = EXCLUDED.module_key,
            resource_key = EXCLUDED.resource_key,
            action_key = EXCLUDED.action_key,
            scope_key = EXCLUDED.scope_key,
            risk_level = EXCLUDED.risk_level,
            is_dangerous = EXCLUDED.is_dangerous
        `,
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

      await queryRunner.query(
        `
          INSERT INTO platform_role_permissions (role_id, permission_key, enabled)
          SELECT role.id, $1, true
          FROM platform_roles role
          WHERE role.key = ANY($2::varchar[])
            AND role.tenant_id IS NULL
          ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL
          DO UPDATE SET enabled = true
        `,
        [permission.key, permission.roles],
      );
    }

    await queryRunner.query(
      `
        DELETE FROM platform_role_permissions role_permission
        USING platform_roles role
        WHERE role_permission.role_id = role.id
          AND role.key = 'member'
          AND role.tenant_id IS NULL
          AND role_permission.tenant_id IS NULL
          AND role_permission.permission_key = ANY($1::varchar[])
      `,
      [PERMISSIONS_TO_REMOVE_FROM_MEMBER],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        INSERT INTO platform_role_permissions (role_id, permission_key, enabled)
        SELECT role.id, permission_key, true
        FROM platform_roles role
        CROSS JOIN unnest($1::varchar[]) AS permission_key
        WHERE role.key = 'member'
          AND role.tenant_id IS NULL
        ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL
        DO UPDATE SET enabled = true
      `,
      [PERMISSIONS_TO_REMOVE_FROM_MEMBER],
    );

    await queryRunner.query(
      `
        DELETE FROM platform_role_permissions
        WHERE tenant_id IS NULL
          AND permission_key = ANY($1::varchar[])
      `,
      [TEAM_STRUCTURE_PERMISSIONS.map((permission) => permission.key)],
    );

    await queryRunner.query(
      `
        DELETE FROM platform_permissions
        WHERE key = ANY($1::varchar[])
      `,
      [TEAM_STRUCTURE_PERMISSIONS.map((permission) => permission.key)],
    );
  }
}
