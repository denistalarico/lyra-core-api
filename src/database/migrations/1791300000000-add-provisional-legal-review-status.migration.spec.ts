import { AddProvisionalLegalReviewStatus1791300000000 } from './1791300000000-add-provisional-legal-review-status';

/**
 * I6.2: `legal_review_status` grows a fourth value without a wider migration.
 *
 * The whole point of this migration is narrow — one CHECK constraint,
 * replaced by another that adds exactly one value — so the spec asserts
 * exactly that and nothing broader: no other table touched, `approved`'s
 * original three values still present, and `down()` restores the original
 * constraint so a rollback is genuinely possible when nothing has used
 * `provisional` yet.
 */
describe('AddProvisionalLegalReviewStatus1791300000000 migration', () => {
  const runUp = async () => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };

    await new AddProvisionalLegalReviewStatus1791300000000().up(
      queryRunner as never,
    );

    return sql.join('\n');
  };

  const runDown = async () => {
    const sql: string[] = [];
    const queryRunner = {
      query: jest.fn((statement: string) => {
        sql.push(statement);
        return Promise.resolve();
      }),
    };

    await new AddProvisionalLegalReviewStatus1791300000000().down(
      queryRunner as never,
    );

    return sql.join('\n');
  };

  it('widens the CHECK to include provisional alongside the original three values', async () => {
    const joined = await runUp();

    expect(joined).toContain(
      "CHECK (\"legal_review_status\" IN ('pending', 'provisional', 'approved', 'rejected'))",
    );
    expect(joined).toContain(
      'DROP CONSTRAINT "CK_lf_telemetry_notice_legal_review"',
    );
  });

  /** `approved`'s original meaning is untouched — no other column or table appears. */
  it('touches only the one constraint on the one table', async () => {
    const joined = await runUp();

    expect(joined).toContain('leadflow_telemetry_consent_notices');
    for (const untouched of [
      'leadflow_telemetry_consents',
      'leadflow_telemetry_identity_links',
      'leadflow_product_telemetry_daily',
      'leadflow_telemetry_audit_events',
      'k_anonymity_threshold',
      'retention_days',
    ]) {
      expect(joined).not.toContain(untouched);
    }
  });

  it('is reversible back to the original three-value constraint', async () => {
    const joined = await runDown();

    expect(joined).toContain(
      "CHECK (\"legal_review_status\" IN ('pending', 'approved', 'rejected'))",
    );
    expect(joined).not.toContain('provisional');
  });
});
