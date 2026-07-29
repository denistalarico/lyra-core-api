import type { QueryRunner } from 'typeorm';
import { FanoutLeadflowAnalyticsConsumer1787800000000 } from './1787800000000-fanout-leadflow-analytics-consumer';
import { CreateLeadflowCsatResponses1787900000000 } from './1787900000000-create-leadflow-csat-responses';

function runner() {
  const queries: string[] = [];
  const queryRunner = {
    query: jest.fn().mockImplementation((sql: string) => {
      queries.push(sql);
      return Promise.resolve();
    }),
  } as unknown as QueryRunner;
  return { queryRunner, queries };
}

describe('Phase 7A Analytics foundation migrations', () => {
  it('adds Analytics without dropping the Automations or Lead Score fan-out', async () => {
    const { queryRunner, queries } = runner();

    await new FanoutLeadflowAnalyticsConsumer1787800000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain("'leadflow.automations'");
    expect(sql).toContain("'leadflow.analytics'");
    expect(sql).toContain("'leadflow.crm.lead_score'");
    expect(sql).not.toMatch(/INSERT\s+INTO[\s\S]+SELECT/i);
  });

  it('restores the previous two-consumer fan-out on rollback', async () => {
    const { queryRunner, queries } = runner();

    await new FanoutLeadflowAnalyticsConsumer1787800000000().down(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain("'leadflow.automations'");
    expect(sql).toContain("'leadflow.crm.lead_score'");
    expect(sql).not.toContain("'leadflow.analytics'");
  });

  it('creates a tenant-scoped CSAT cycle with explicit no-response state and 1-5 score', async () => {
    const { queryRunner, queries } = runner();

    await new CreateLeadflowCsatResponses1787900000000().up(queryRunner);

    const sql = queries.join('\n');
    expect(sql).toContain('"leadflow_csat_responses"');
    expect(sql).toContain("'pending', 'responded', 'expired'");
    expect(sql).toContain('"score" >= 1 AND "score" <= 5');
    expect(sql).toContain('"tenant_id", "workspace_id", "idempotency_key"');
  });
});
