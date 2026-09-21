import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateAgencyClientCompanyContexts1794400000000 } from './1794400000000-create-agency-client-company-contexts';

const run = describePostgresIntegration();

run('CC1 company context migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up, backfills only organization contacts and enforces invariants', async () => {
    const migration = new CreateAgencyClientCompanyContexts1794400000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const otherWorkspaceId = randomUUID();
    const companyId = randomUUID();
    const personId = randomUUID();
    const otherCompanyId = randomUUID();
    const organizationClientId = randomUUID();
    const personClientId = randomUUID();
    const emptyClientId = randomUUID();

    try {
      await migration.down(runner);
      await runner.query(
        `INSERT INTO contacts (id, tenant_id, workspace_id, type, display_name)
         VALUES ($1,$2,$3,'organization','Empresa segura'),
                ($4,$2,$3,'person','Pessoa'),
                ($5,$2,$6,'organization','Outra workspace')`,
        [
          companyId,
          tenantId,
          workspaceId,
          personId,
          otherCompanyId,
          otherWorkspaceId,
        ],
      );
      await runner.query(
        `INSERT INTO agency_clients
          (id, tenant_id, workspace_id, contact_id, display_name)
         VALUES ($1,$2,$3,$4,'Conta PJ'),
                ($5,$2,$3,$6,'Conta PF'),
                ($7,$2,$3,NULL,'Conta sem contato')`,
        [
          organizationClientId,
          tenantId,
          workspaceId,
          companyId,
          personClientId,
          personId,
          emptyClientId,
        ],
      );

      await migration.up(runner);

      const contexts = (await runner.query(
        `SELECT agency_client_id, company_contact_id, status, is_primary
         FROM agency_client_company_contexts
         WHERE tenant_id = $1 ORDER BY agency_client_id`,
        [tenantId],
      )) as Array<Record<string, unknown>>;
      expect(contexts).toEqual([
        expect.objectContaining({
          agency_client_id: organizationClientId,
          company_contact_id: companyId,
          status: 'active',
          is_primary: true,
        }),
      ]);

      const constraints = (await runner.query(
        `SELECT conname, contype
         FROM pg_constraint
         WHERE conrelid = 'agency_client_company_contexts'::regclass`,
      )) as Array<{ conname: string; contype: string }>;
      expect(constraints).toEqual(
        expect.arrayContaining([
          {
            conname: 'UQ_agency_client_company_contexts_client_company',
            contype: 'u',
          },
          { conname: 'FK_agency_client_company_contexts_client', contype: 'f' },
          {
            conname: 'FK_agency_client_company_contexts_company',
            contype: 'f',
          },
          { conname: 'CK_agency_client_company_contexts_status', contype: 'c' },
        ]),
      );
      const indexes = (await runner.query(
        `SELECT indexname, indexdef FROM pg_indexes
         WHERE tablename IN ('agency_client_company_contexts', 'contact_company_links')`,
      )) as Array<{ indexname: string; indexdef: string }>;
      expect(
        indexes.find(
          (index) =>
            index.indexname ===
            'UQ_agency_client_company_contexts_active_primary',
        )?.indexdef,
      ).toContain('WHERE ((is_primary = true)');
      expect(
        indexes.find(
          (index) =>
            index.indexname === 'uq_contact_company_links_active_primary',
        )?.indexdef,
      ).toContain('UNIQUE');

      await expectConstraintViolation(runner, () =>
        runner.query(
          `INSERT INTO agency_client_company_contexts
            (tenant_id, workspace_id, agency_client_id, company_contact_id)
           VALUES ($1,$2,$3,$4)`,
          [tenantId, workspaceId, personClientId, personId],
        ),
      );
      await expectConstraintViolation(runner, () =>
        runner.query(
          `INSERT INTO agency_client_company_contexts
            (tenant_id, workspace_id, agency_client_id, company_contact_id)
           VALUES ($1,$2,$3,$4)`,
          [tenantId, workspaceId, personClientId, otherCompanyId],
        ),
      );
      await expectConstraintViolation(runner, () =>
        runner.query(
          `INSERT INTO contact_company_links
            (tenant_id, workspace_id, person_contact_id, company_contact_id)
           VALUES ($1,$2,$3,$4)`,
          [tenantId, workspaceId, personId, personId],
        ),
      );
      await runner.query(
        `INSERT INTO contact_company_links
          (tenant_id, workspace_id, person_contact_id, company_contact_id, is_primary)
         VALUES ($1,$2,$3,$4,true)`,
        [tenantId, workspaceId, personId, companyId],
      );
      await expectConstraintViolation(runner, () =>
        runner.query(`UPDATE contacts SET type='person' WHERE id=$1`, [
          companyId,
        ]),
      );
      await expectConstraintViolation(runner, () =>
        runner.query(`UPDATE contacts SET type='organization' WHERE id=$1`, [
          personId,
        ]),
      );

      await migration.down(runner);
      const afterDown = (await runner.query(
        `SELECT to_regclass('public.agency_client_company_contexts') AS context_table,
                EXISTS (
                  SELECT 1 FROM information_schema.columns
                  WHERE table_name='contact_company_links' AND column_name='role'
                ) AS link_role`,
      )) as Array<{ context_table: string | null; link_role: boolean }>;
      expect(afterDown[0]).toEqual({ context_table: null, link_role: false });

      await migration.up(runner);
      const afterSecondUp = (await runner.query(
        `SELECT count(*)::int AS count
         FROM agency_client_company_contexts WHERE tenant_id=$1`,
        [tenantId],
      )) as Array<{ count: number }>;
      expect(afterSecondUp[0]?.count).toBe(1);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});

async function expectConstraintViolation(
  runner: ReturnType<typeof AgencyDataSource.createQueryRunner>,
  operation: () => Promise<unknown>,
) {
  const savepoint = `cc1_${randomUUID().replace(/-/g, '')}`;
  await runner.query(`SAVEPOINT ${savepoint}`);
  let rejected = false;
  try {
    await operation();
  } catch {
    rejected = true;
  } finally {
    await runner.query(`ROLLBACK TO SAVEPOINT ${savepoint}`);
    await runner.query(`RELEASE SAVEPOINT ${savepoint}`);
  }
  expect(rejected).toBe(true);
}
