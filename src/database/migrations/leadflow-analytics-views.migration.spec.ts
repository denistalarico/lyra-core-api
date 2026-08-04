import { CreateLeadflowAnalyticsViews1788900000000 } from './1788900000000-create-leadflow-analytics-views';

describe('LeadFlow analytics views migration', () => {
  it('creates a versioned, user-scoped view store with a null-safe context key', async () => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };

    await new CreateLeadflowAnalyticsViews1788900000000().up(
      queryRunner as never,
    );

    const joined = sql.join('\n');
    expect(joined).toContain('leadflow_analytics_views');
    expect(joined).toContain('schema_version');
    expect(joined).toContain('user_id');
    expect(joined).toContain('agency_client_id');
    expect(joined).toContain('COALESCE("agency_client_id"');
    expect(joined).toContain('LOWER("name")');
    expect(joined).toContain('period_from');
  });
});
