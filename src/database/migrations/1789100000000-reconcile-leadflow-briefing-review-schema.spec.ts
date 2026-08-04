import { ReconcileLeadflowBriefingReviewSchema1789100000000 } from './1789100000000-reconcile-leadflow-briefing-review-schema';

describe('ReconcileLeadflowBriefingReviewSchema1789100000000', () => {
  it('repairs all tables required by the review and apply endpoints', async () => {
    const queries: string[] = [];
    const migration = new ReconcileLeadflowBriefingReviewSchema1789100000000();

    await migration.up({
      query: jest.fn((sql: string) => {
        queries.push(sql);
        return Promise.resolve(undefined);
      }),
    } as never);

    const sql = queries.join('\n');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_briefing_suggestions"',
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_briefing_context_snapshots"',
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_briefing_suggestion_applications"',
    );
  });

  it('keeps down forward-only so it cannot remove pre-existing production tables', async () => {
    const migration = new ReconcileLeadflowBriefingReviewSchema1789100000000();
    await expect(migration.down()).resolves.toBeUndefined();
  });
});
