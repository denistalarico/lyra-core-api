import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateLeadflowBriefingProvenance1788500000000 } from './1788500000000-create-leadflow-briefing-provenance';

describe('CreateLeadflowBriefingProvenance1788500000000', () => {
  it('is registered in the agency datasource', () => {
    expect(AgencyDataSource.options.migrations).toContain(
      CreateLeadflowBriefingProvenance1788500000000,
    );
  });

  it('creates the six briefing tables with their state-machine and idempotency constraints', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new CreateLeadflowBriefingProvenance1788500000000();

    await migration.up({ query } as never);

    const sql = query.mock.calls.map(([statement]) => String(statement)).join('\n');

    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "leadflow_briefing_sources"');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_briefing_source_versions"',
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_briefing_extraction_jobs"',
    );
    expect(sql).toContain('CREATE TABLE IF NOT EXISTS "leadflow_briefing_suggestions"');
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_briefing_context_snapshots"',
    );
    expect(sql).toContain(
      'CREATE TABLE IF NOT EXISTS "leadflow_briefing_suggestion_applications"',
    );

    // source version idempotency: one row per (source, version_number); byte-identical re-upload is a no-op
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_source_versions_number"',
    );
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_source_versions_checksum"',
    );
    expect(sql).toContain('WHERE "checksum" IS NOT NULL');

    // job idempotency: full unique (not partial) — a job identity is permanent
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_jobs_idempotency"\n      ON "leadflow_briefing_extraction_jobs" ("tenant_id", "workspace_id", "idempotency_key")',
    );
    expect(sql).toContain(
      "CK_lf_briefing_jobs_status\" CHECK (\n          \"status\" IN ('queued', 'processing', 'succeeded', 'failed', 'cancelled', 'dead_letter')",
    );

    // suggestion: one per (job, field), state machine statuses
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_suggestions_job_field"',
    );
    expect(sql).toContain(
      "CK_lf_briefing_suggestions_status\" CHECK (\n          \"status\" IN ('pending', 'applied', 'rejected', 'superseded')",
    );

    // publication history: partial unique per settings+published_version
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_snapshots_published_version"',
    );
    expect(sql).toContain("WHERE \"snapshot_kind\" = 'published'");

    // application: at most once per suggestion, ever
    expect(sql).toContain(
      'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_briefing_applications_suggestion"',
    );
  });

  it('drops the tables in reverse FK-dependency order', async () => {
    const query = jest.fn().mockResolvedValue(undefined);
    const migration = new CreateLeadflowBriefingProvenance1788500000000();

    await migration.down({ query } as never);

    const calls = query.mock.calls.map(([statement]) => String(statement));
    const applicationsIndex = calls.findIndex((sql) =>
      sql.includes('DROP TABLE IF EXISTS "leadflow_briefing_suggestion_applications"'),
    );
    const sourcesIndex = calls.findIndex((sql) =>
      sql.includes('DROP TABLE IF EXISTS "leadflow_briefing_sources"'),
    );
    expect(applicationsIndex).toBeGreaterThanOrEqual(0);
    expect(sourcesIndex).toBeGreaterThan(applicationsIndex);
  });
});
