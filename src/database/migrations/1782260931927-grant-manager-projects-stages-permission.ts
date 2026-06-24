import { MigrationInterface, QueryRunner } from 'typeorm';
import { PlatformRoleKey } from '../../modules/permissions/enums/permission.enums';

const PERMISSION_KEY = 'agency.projects.stages.manage.admin';

export class GrantManagerProjectsStagesPermission1782260931927
  implements MigrationInterface
{
  name = 'GrantManagerProjectsStagesPermission1782260931927';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const [role] = (await queryRunner.query(
      `
        SELECT id
        FROM platform_roles
        WHERE tenant_id IS NULL AND key = $1
        LIMIT 1
      `,
      [PlatformRoleKey.Manager],
    )) as Array<{ id: string }>;

    if (!role) {
      return;
    }

    await queryRunner.query(
      `
        INSERT INTO platform_role_permissions (role_id, permission_key, enabled)
        VALUES ($1, $2, true)
        ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL DO UPDATE
        SET enabled = true, updated_at = now()
      `,
      [role.id, PERMISSION_KEY],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        DELETE FROM platform_role_permissions
        WHERE permission_key = $1
          AND tenant_id IS NULL
          AND role_id IN (
            SELECT id FROM platform_roles
            WHERE tenant_id IS NULL AND key = $2
          )
      `,
      [PERMISSION_KEY, PlatformRoleKey.Manager],
    );
  }
}
