import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { describePostgresIntegration } from '../../testing/postgres-integration';

const run = describePostgresIntegration();

/**
 * The one thing a unit spec cannot prove about migration 1791300000000: that
 * the CHECK constraint really exists in `lyra_agency_test` and really accepts
 * `'provisional'` while still rejecting a value outside the set. Everything
 * else about the migration — that it touches only this one constraint — is
 * proven in the unit spec beside it.
 */
run('provisional legal_review_status against PostgreSQL', () => {
  const noticeIds = new Set<string>();

  const insertNotice = (status: string) => {
    const id = randomUUID();
    noticeIds.add(id);
    return AgencyDataSource.query(
      `INSERT INTO leadflow_telemetry_consent_notices
         (id, purpose_key, version, locale, title, body, content_hash,
          categories, retention_days, k_anonymity_threshold,
          legal_review_status, status, effective_at)
       VALUES ($1, $2, $3, 'pt-BR', 'Título', 'Corpo', $4,
               '[]'::jsonb, 90, 5, $5, 'active', now())`,
      [
        id,
        `i6_2_check_test_${id.slice(0, 8)}`,
        Math.floor(Math.random() * 1_000_000),
        'a'.repeat(64),
        status,
      ],
    );
  };

  afterAll(async () => {
    if (noticeIds.size) {
      await AgencyDataSource.query(
        `DELETE FROM leadflow_telemetry_consent_notices WHERE id = ANY($1::uuid[])`,
        [[...noticeIds]],
      );
    }
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  it('accepts provisional', async () => {
    await expect(insertNotice('provisional')).resolves.toBeDefined();
  });

  it('still accepts the original three values', async () => {
    await expect(insertNotice('pending')).resolves.toBeDefined();
    await expect(insertNotice('approved')).resolves.toBeDefined();
    await expect(insertNotice('rejected')).resolves.toBeDefined();
  });

  it('rejects a value outside the four-member set', async () => {
    await expect(insertNotice('legally_reviewed')).rejects.toThrow();
  });
});
