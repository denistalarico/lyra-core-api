import { MigrationInterface, QueryRunner } from 'typeorm';
import {
  PLATFORM_ROLE_KEYS,
  PlatformRoleKey,
} from '../../modules/permissions/enums/permission.enums';
import { getPermissionDefinition } from '../../modules/permissions/catalog/permission-keys.catalog';
import { DEFAULT_ROLE_PERMISSION_MATRIX } from '../../modules/permissions/catalog/role-permission-matrix.catalog';

const CLIENT_LIFECYCLE_PERMISSION_KEYS = [
  'agency.clients.lifecycle.view.assigned',
  'agency.clients.lifecycle.manage.assigned',
  'agency.clients.lifecycle.settings.manage.admin',
];

export class AddClientLifecyclePermissions1760002059000
  implements MigrationInterface
{
  name = 'AddClientLifecyclePermissions1760002059000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const permissionKey of CLIENT_LIFECYCLE_PERMISSION_KEYS) {
      const definition = getPermissionDefinition(permissionKey);

      if (!definition) {
        throw new Error(`Missing permission definition: ${permissionKey}`);
      }

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
            is_dangerous = EXCLUDED.is_dangerous,
            is_system = true,
            updated_at = now()
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

    for (const roleKey of PLATFORM_ROLE_KEYS) {
      const [role] = (await queryRunner.query(
        `
          SELECT id
          FROM platform_roles
          WHERE tenant_id IS NULL AND key = $1
          LIMIT 1
        `,
        [roleKey],
      )) as Array<{ id: string }>;

      if (!role) {
        continue;
      }

      for (const permissionKey of DEFAULT_ROLE_PERMISSION_MATRIX[roleKey]) {
        if (!CLIENT_LIFECYCLE_PERMISSION_KEYS.includes(permissionKey)) {
          continue;
        }

        await queryRunner.query(
          `
            INSERT INTO platform_role_permissions (role_id, permission_key, enabled)
            VALUES ($1, $2, true)
            ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL DO UPDATE
            SET enabled = true, updated_at = now()
          `,
          [role.id, permissionKey],
        );
      }
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const roleKey of Object.values(PlatformRoleKey)) {
      await queryRunner.query(
        `
          DELETE FROM platform_role_permissions
          WHERE permission_key = ANY($1)
            AND tenant_id IS NULL
            AND role_id IN (
              SELECT id FROM platform_roles
              WHERE tenant_id IS NULL AND key = $2
            )
        `,
        [CLIENT_LIFECYCLE_PERMISSION_KEYS, roleKey],
      );
    }

    await queryRunner.query(
      `DELETE FROM platform_permissions WHERE key = ANY($1)`,
      [CLIENT_LIFECYCLE_PERMISSION_KEYS],
    );
  }
}
