import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateLeadflowAutomationGlobalConfigVersions1788700000000 } from './1788700000000-create-leadflow-automation-global-config-versions';

describe('CreateLeadflowAutomationGlobalConfigVersions1788700000000', () => {
  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateLeadflowAutomationGlobalConfigVersions1788700000000,
    );
  });

  it('creates append-only settings-scoped versions and their constraints', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration =
      new CreateLeadflowAutomationGlobalConfigVersions1788700000000();

    await migration.up({ query } as never);

    const sql = query.mock.calls
      .map(([statement]) => String(statement))
      .join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_automation_global_config_versions"',
    );
    expect(sql).toContain('FK_lf_automation_global_config_settings');
    expect(sql).toContain('IDX_lf_automation_global_config_settings_version');
  });
});
