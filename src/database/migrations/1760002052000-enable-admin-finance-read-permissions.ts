import { MigrationInterface, QueryRunner } from 'typeorm';

const ADMIN_FINANCE_READ_PERMISSIONS = [
  'agency.finance.summary.view.finance_or_owner',
  'agency.finance.transactions.view.finance_or_owner',
  'agency.finance.reports.view.finance_or_owner',
];

export class EnableAdminFinanceReadPermissions1760002052000
  implements MigrationInterface
{
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        INSERT INTO platform_role_permissions (role_id, permission_key, enabled)
        SELECT role.id, permission_key, true
        FROM platform_roles role
        CROSS JOIN unnest($1::varchar[]) AS permission_key
        WHERE role.key = 'admin'
          AND role.tenant_id IS NULL
        ON CONFLICT (role_id, permission_key) WHERE tenant_id IS NULL
        DO UPDATE SET enabled = true
      `,
      [ADMIN_FINANCE_READ_PERMISSIONS],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
        DELETE FROM platform_role_permissions role_permission
        USING platform_roles role
        WHERE role_permission.role_id = role.id
          AND role.key = 'admin'
          AND role.tenant_id IS NULL
          AND role_permission.tenant_id IS NULL
          AND role_permission.permission_key = ANY($1::varchar[])
      `,
      [ADMIN_FINANCE_READ_PERMISSIONS],
    );
  }
}
