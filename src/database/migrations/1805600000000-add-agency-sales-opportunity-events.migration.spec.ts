import { AddAgencySalesOpportunityEvents1805600000000 } from './1805600000000-add-agency-sales-opportunity-events';

describe('AddAgencySalesOpportunityEvents1805600000000 migration (AG-EVT)', () => {
  const run = async (direction: 'up' | 'down') => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };
    await new AddAgencySalesOpportunityEvents1805600000000()[direction](
      queryRunner as never,
    );
    return sql.join('\n');
  };

  it('dedups by idempotency key only when one is given', async () => {
    expect(await run('up')).toMatch(
      /UNIQUE INDEX IF NOT EXISTS "uq_agency_sales_opportunity_events_idempotency"[\s\S]*WHERE "idempotency_key" IS NOT NULL/,
    );
  });

  it('indexes the scope feed and the opportunity history', async () => {
    const joined = await run('up');
    expect(joined).toContain(
      '("tenant_id", "workspace_id", "occurred_at", "id")',
    );
    expect(joined).toContain('("opportunity_id", "occurred_at")');
  });

  it('stays apart from the LeadFlow CRM and keeps lead PII out', async () => {
    const joined = await run('up');
    expect(joined).not.toContain('crm_opportunity_events');
    expect(joined).not.toMatch(/"(title|description|contact_id|email|phone)"/);
  });

  it('is re-runnable and down drops the table', async () => {
    const joined = await run('up');
    expect(joined.match(/CREATE TABLE (?!IF NOT EXISTS)/g)).toBeNull();
    expect(
      joined.match(/CREATE (UNIQUE )?INDEX (?!IF NOT EXISTS)/g),
    ).toBeNull();
    expect(await run('down')).toContain(
      'DROP TABLE IF EXISTS "agency_sales_opportunity_events"',
    );
  });
});
