import { AgencyDataSource } from '../agency-typeorm.datasource';
import { getPermissionDefinition } from '../../modules/permissions/catalog/permission-keys.catalog';
import { AddLeadflowBriefingPermissions1788600000000 } from './1788600000000-add-leadflow-briefing-permissions';
import { LEADFLOW_BRIEFING_ALL_PERMISSION_KEYS } from '../../modules/leadflow-briefing/leadflow-briefing.permissions';

describe('AddLeadflowBriefingPermissions1788600000000', () => {
  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      AddLeadflowBriefingPermissions1788600000000,
    );
  });

  it('every seeded key resolves to a catalog definition', () => {
    for (const key of LEADFLOW_BRIEFING_ALL_PERMISSION_KEYS) {
      expect(getPermissionDefinition(key)).toBeDefined();
    }
    expect(LEADFLOW_BRIEFING_ALL_PERMISSION_KEYS).toHaveLength(5);
  });

  it('seeds platform_permissions and platform_role_permissions for every known role', async () => {
    const query = jest.fn().mockResolvedValue([{ id: 'role-id' }]);
    const migration = new AddLeadflowBriefingPermissions1788600000000();

    await migration.up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('INSERT INTO platform_permissions');
    expect(sql).toContain('INSERT INTO platform_role_permissions');
  });

  it('deletes seeded keys on down()', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new AddLeadflowBriefingPermissions1788600000000();

    await migration.down({ query } as never);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');
    expect(sql).toContain('DELETE FROM platform_role_permissions');
    expect(sql).toContain('DELETE FROM platform_permissions WHERE key = ANY($1)');
  });
});
