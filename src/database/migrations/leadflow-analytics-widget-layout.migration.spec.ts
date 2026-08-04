import { AddLeadflowAnalyticsWidgetLayout1789000000000 } from './1789000000000-add-leadflow-analytics-widget-layout';

describe('LeadFlow analytics widget layout migration', () => {
  it('adds structured widget layout fields to persisted user views', async () => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };

    await new AddLeadflowAnalyticsWidgetLayout1789000000000().up(
      queryRunner as never,
    );

    expect(sql.join('\n')).toContain('widget_order');
    expect(sql.join('\n')).toContain('hidden_widget_ids');
    expect(sql.join('\n')).toContain("DEFAULT '[]'::jsonb");
  });
});
