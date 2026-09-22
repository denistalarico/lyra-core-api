import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateCompanyContextReconciliationAudit1795000000000 } from './1795000000000-create-company-context-reconciliation-audit';

const run = describePostgresIntegration();

run('CC2G reconciliation audit migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up and enforces the audit invariants', async () => {
    const migration = new CreateCompanyContextReconciliationAudit1795000000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const clientId = randomUUID();
    const companyContactId = randomUUID();
    const otherCompanyContactId = randomUUID();
    const companyAId = randomUUID();
    const companyBId = randomUUID();
    const actorUserId = randomUUID();
    const rowId = randomUUID();

    try {
      // up / down / up — the migration must be replayable.
      await migration.down(runner);
      await migration.up(runner);
      await migration.down(runner);
      await migration.up(runner);

      await runner.query(
        `INSERT INTO contacts (id, tenant_id, workspace_id, type, display_name)
         VALUES ($1,$2,$3,'organization','XP Saúde'),
                ($4,$2,$3,'organization','XP Previdência')`,
        [companyContactId, tenantId, workspaceId, otherCompanyContactId],
      );
      await runner.query(
        `INSERT INTO agency_clients
           (id, tenant_id, workspace_id, contact_id, display_name)
         VALUES ($1,$2,$3,$4,'Conta XP')`,
        [clientId, tenantId, workspaceId, companyContactId],
      );
      await runner.query(
        `INSERT INTO agency_client_company_contexts
           (id, tenant_id, workspace_id, agency_client_id, company_contact_id, status, is_primary)
         VALUES ($1,$2,$3,$4,$5,'active',true),
                ($6,$2,$3,$4,$7,'active',false)`,
        [
          companyAId,
          tenantId,
          workspaceId,
          clientId,
          companyContactId,
          companyBId,
          otherCompanyContactId,
        ],
      );

      const insertAudit = (
        id: string,
        overrides: Partial<{
          domainKey: string;
          rowId: string;
          reason: string;
          company: string;
          previous: string | null;
        }> = {},
      ) =>
        runner.query(
          `INSERT INTO company_context_reconciliation_audits
             (id, tenant_id, workspace_id, domain_key, row_id, agency_client_id,
              previous_company_context_id, assigned_company_context_id,
              actor_user_id, reason, evidence)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
          [
            id,
            tenantId,
            workspaceId,
            overrides.domainKey ?? 'leadflow.crm.pipeline',
            overrides.rowId ?? rowId,
            clientId,
            overrides.previous ?? null,
            overrides.company ?? companyAId,
            actorUserId,
            overrides.reason ?? 'Confirmado com o cliente.',
            JSON.stringify({ scopeEncoding: 'column' }),
          ],
        );

      // A normal assignment is recorded.
      await insertAudit(randomUUID());
      const [stored] = await runner.query(
        `SELECT domain_key, row_id, previous_company_context_id,
                assigned_company_context_id, reason, evidence, created_at
           FROM company_context_reconciliation_audits
          WHERE row_id = $1`,
        [rowId],
      );
      expect(stored.assigned_company_context_id).toBe(companyAId);
      expect(stored.previous_company_context_id).toBeNull();
      expect(stored.created_at).toBeInstanceOf(Date);

      /**
       * A rejected statement aborts the surrounding transaction, so each
       * expected failure runs inside its own savepoint and is rolled back to
       * it. Without this the first assertion would poison every statement
       * after it.
       */
      const expectRejected = async (attempt: () => Promise<unknown>) => {
        await runner.query('SAVEPOINT expected_failure');
        await expect(attempt()).rejects.toThrow();
        await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
      };

      // An empty reason is rejected: the audit is worthless without one.
      await expectRejected(() =>
        insertAudit(randomUUID(), { rowId: randomUUID(), reason: '   ' }),
      );

      // One winner per row: a second initial assignment of the same row is
      // refused by the partial unique index, so a lost race cannot silently
      // produce two competing "first" assignments.
      await expectRejected(() =>
        insertAudit(randomUUID(), { company: companyBId }),
      );

      // The same row id in a different domain is a different record.
      await insertAudit(randomUUID(), { domainKey: 'leadflow.agent' });

      // History is preserved: deleting the assigned company context is
      // refused while an audit row references it.
      await expectRejected(() =>
        runner.query(
          `DELETE FROM agency_client_company_contexts WHERE id = $1`,
          [companyAId],
        ),
      );

      // A reassignment (previous set) is representable and does not collide
      // with the initial-assignment uniqueness.
      await insertAudit(randomUUID(), {
        previous: companyAId,
        company: companyBId,
      });

      const [{ count }] = await runner.query(
        `SELECT count(*)::int AS count
           FROM company_context_reconciliation_audits
          WHERE tenant_id = $1`,
        [tenantId],
      );
      expect(count).toBe(3);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
