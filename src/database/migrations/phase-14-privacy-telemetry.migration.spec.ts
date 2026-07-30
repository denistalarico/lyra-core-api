import { CreateLeadflowPrivacyTelemetry1788200000000 } from './1788200000000-create-leadflow-privacy-telemetry';

describe('Phase 14 privacy telemetry migration', () => {
  it('separates scoped identities from pseudonymous product facts', async () => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };

    await new CreateLeadflowPrivacyTelemetry1788200000000().up(
      queryRunner as never,
    );
    const joined = sql.join('\n');
    const factTable = joined.slice(
      joined.indexOf(
        'CREATE TABLE IF NOT EXISTS "leadflow_product_telemetry_daily"',
      ),
      joined.indexOf(
        'CREATE UNIQUE INDEX IF NOT EXISTS "UQ_lf_product_telemetry_daily_fact"',
      ),
    );

    expect(joined).toContain('leadflow_telemetry_consent_notices');
    expect(joined).toContain('leadflow_telemetry_consents');
    expect(joined).toContain('leadflow_telemetry_identity_links');
    expect(joined).toContain('leadflow_product_telemetry_daily');
    expect(joined).toContain('leadflow_telemetry_audit_events');
    expect(joined).toContain('k_anonymity_threshold');
    expect(joined).toContain('legal_review_status');
    expect(joined).toContain('platform_permissions');
    expect(factTable).toContain('scope_pseudonym');
    expect(factTable).not.toContain('tenant_id');
    expect(factTable).not.toContain('workspace_id');
    expect(factTable).not.toContain('agency_client_id');
    expect(joined).not.toContain('message_content');
    expect(joined).not.toContain('contact_id');
  });
});
