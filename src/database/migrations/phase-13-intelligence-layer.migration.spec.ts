import { CreateLeadflowIntelligenceLayer1788100000000 } from './1788100000000-create-leadflow-intelligence-layer';

describe('Phase 13 intelligence migration', () => {
  it('creates an auditable recommendation, decision, version and result model', async () => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };

    await new CreateLeadflowIntelligenceLayer1788100000000().up(
      queryRunner as never,
    );
    const joined = sql.join('\n');

    expect(joined).toContain('leadflow_intelligence_recommendations');
    expect(joined).toContain('leadflow_intelligence_decisions');
    expect(joined).toContain('leadflow_intelligence_config_versions');
    expect(joined).toContain('leadflow_intelligence_results');
    expect(joined).toContain('applied_version_id');
    expect(joined).toContain('rollback_of_version_id');
    expect(joined).toContain('confidence');
    expect(joined).toContain('platform_permissions');
    expect(joined).toContain('platform_role_permissions');
    expect(queryRunner.query).toHaveBeenCalledWith(
      expect.stringContaining('INSERT INTO platform_permissions'),
      expect.arrayContaining([
        'leadflow.analytics.recommendations.manage.admin',
      ]),
    );
    expect(joined).not.toContain('message_content');
  });
});
