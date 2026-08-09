import { AddLeadflowAnalyticsViewPreferences1789200000000 } from './1789200000000-add-leadflow-analytics-view-preferences';

describe('LeadFlow analytics view preferences migration', () => {
  it('adds summary and chart preferences and backfills existing views', async () => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };

    await new AddLeadflowAnalyticsViewPreferences1789200000000().up(
      queryRunner as never,
    );

    const statements = sql.join('\n');
    expect(statements).toContain('summary_types');
    expect(statements).toContain('chart_modes');
    expect(statements).toContain("WHEN 'messages' THEN");
    expect(statements).toContain("DEFAULT '{}'::jsonb");
  });
});
