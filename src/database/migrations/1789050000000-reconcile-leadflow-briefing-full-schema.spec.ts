import { ReconcileLeadflowBriefingFullSchema1789050000000 } from './1789050000000-reconcile-leadflow-briefing-full-schema';

describe('ReconcileLeadflowBriefingFullSchema1789050000000', () => {
  it('replays every Briefing table in foreign-key-safe order', async () => {
    const queries: string[] = [];
    const migration = new ReconcileLeadflowBriefingFullSchema1789050000000();

    await migration.up({
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve(undefined);
      }),
    } as never);

    const sql = queries.join('\n');
    const tables = [
      'leadflow_briefing_sources',
      'leadflow_briefing_source_versions',
      'leadflow_briefing_extraction_jobs',
      'leadflow_briefing_suggestions',
      'leadflow_briefing_context_snapshots',
      'leadflow_briefing_suggestion_applications',
    ];

    for (const table of tables) {
      expect(sql).toContain(`CREATE TABLE IF NOT EXISTS "${table}"`);
    }

    expect(sql.indexOf('"leadflow_briefing_sources"')).toBeLessThan(
      sql.indexOf('"leadflow_briefing_source_versions"'),
    );
    expect(sql.indexOf('"leadflow_briefing_source_versions"')).toBeLessThan(
      sql.indexOf('"leadflow_briefing_extraction_jobs"'),
    );
    expect(sql.indexOf('"leadflow_briefing_extraction_jobs"')).toBeLessThan(
      sql.indexOf('"leadflow_briefing_suggestions"'),
    );
  });

  it('is forward-only and never drops shared production tables', async () => {
    const migration = new ReconcileLeadflowBriefingFullSchema1789050000000();
    await expect(migration.down()).resolves.toBeUndefined();
  });
});
