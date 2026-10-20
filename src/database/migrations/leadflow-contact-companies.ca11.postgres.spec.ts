import { randomUUID } from 'node:crypto';
import type { QueryRunner } from 'typeorm';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { IsolateLeadflowContactsByCompany1800050000000 } from './1800050000000-isolate-leadflow-contacts-by-company';

describePostgresIntegration()(
  'CA11 contact ownership migration (Agency test only)',
  () => {
    const migration = new IsolateLeadflowContactsByCompany1800050000000();
    let runner: QueryRunner;
    let schema: string;
    const tenant = randomUUID(),
      workspace = randomUUID(),
      client = randomUUID(),
      a = randomUUID(),
      b = randomUUID();
    beforeAll(async () => {
      if (
        AgencyDataSource.options.type !== 'postgres' ||
        AgencyDataSource.options.database !== 'lyra_agency_test'
      )
        throw new Error('CA11 requires lyra_agency_test');
      if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
    });
    afterAll(async () => {
      await AgencyDataSource.destroy();
    });
    beforeEach(async () => {
      runner = AgencyDataSource.createQueryRunner();
      await runner.connect();
      schema = `ca11_${randomUUID().replaceAll('-', '')}`;
      await runner.query(`CREATE SCHEMA "${schema}"`);
      await runner.query(`SET search_path TO "${schema}",public`);
      await runner.query(
        "CREATE TABLE contacts(id uuid PRIMARY KEY,tenant_id uuid,workspace_id uuid,lifecycle_stage varchar DEFAULT 'lead',lifecycle_stages text[] NOT NULL DEFAULT '{}')",
      );
      await runner.query(
        'CREATE TABLE agency_client_company_contexts(id uuid PRIMARY KEY,tenant_id uuid,workspace_id uuid,agency_client_id uuid)',
      );
      for (const company of [a, b])
        await runner.query(
          'INSERT INTO agency_client_company_contexts VALUES($1,$2,$3,$4)',
          [company, tenant, workspace, client],
        );
      for (const table of ['inbox_conversations', 'crm_opportunities'])
        await runner.query(
          `CREATE TABLE ${table}(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),tenant_id uuid,workspace_id uuid,contact_id uuid,agency_client_id uuid,company_context_id uuid,scope_kind varchar(24))`,
        );
      await runner.query(
        'ALTER TABLE crm_opportunities ADD CONSTRAINT crm_contact_fk FOREIGN KEY(contact_id) REFERENCES contacts(id)',
      );
    });
    afterEach(async () => {
      await runner.query('SET search_path TO public');
      await runner.query(`DROP SCHEMA "${schema}" CASCADE`);
      await runner.release();
    });
    const contact = async () => {
      const id = randomUUID();
      await runner.query(
        'INSERT INTO contacts(id,tenant_id,workspace_id) VALUES($1,$2,$3)',
        [id, tenant, workspace],
      );
      return id;
    };
    const ref = (
      id: string,
      company: string | null,
      table = 'inbox_conversations',
      target = runner,
    ) =>
      target.query(
        `INSERT INTO ${table}(tenant_id,workspace_id,contact_id,agency_client_id,company_context_id,scope_kind) VALUES($1,$2,$3,$4,$5,$6)`,
        [
          tenant,
          workspace,
          id,
          company ? client : null,
          company,
          company ? 'company' : 'agency',
        ],
      );
    it('up/up/down/up preserves canonical data and backfills only unambiguous ownership', async () => {
      const safe = await contact(),
        ambiguous = await contact(),
        mixed = await contact(),
        unclassified = await contact();
      await ref(safe, a);
      await ref(safe, a, 'crm_opportunities');
      await ref(ambiguous, a);
      await ref(ambiguous, b, 'crm_opportunities');
      await ref(mixed, a);
      await ref(mixed, null, 'crm_opportunities');
      await migration.up(runner);
      await migration.up(runner);
      expect(
        await runner.query(
          'SELECT contact_id,company_context_id FROM leadflow_contact_companies',
        ),
      ).toEqual([{ contact_id: safe, company_context_id: a }]);
      await migration.down(runner);
      expect(
        ((await runner.query('SELECT id FROM contacts')) as { id: string }[])
          .map((r: { id: string }) => r.id)
          .sort(),
      ).toEqual([safe, ambiguous, mixed, unclassified].sort());
      await migration.up(runner);
      expect(
        await runner.query('SELECT contact_id FROM leadflow_contact_companies'),
      ).toEqual([{ contact_id: safe }]);
    });
    it('binds new ingestion without adapter changes, rejects foreign companies/Agency and immutable reassignment', async () => {
      await migration.up(runner);
      const id = await contact();
      await ref(id, a);
      await ref(id, a, 'crm_opportunities');
      await expect(ref(id, b)).rejects.toMatchObject({ code: '23514' });
      await expect(ref(id, null)).rejects.toMatchObject({ code: '23514' });
      await expect(
        runner.query(
          'UPDATE leadflow_contact_companies SET company_context_id=$1 WHERE contact_id=$2',
          [b, id],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      const other = await contact();
      await expect(
        runner.query(
          'INSERT INTO leadflow_contact_companies(contact_id,tenant_id,workspace_id,agency_client_id,company_context_id) VALUES($1,$2,$3,$4,$5)',
          [other, randomUUID(), workspace, client, a],
        ),
      ).rejects.toMatchObject({ code: '23514' });
      await expect(
        runner.query(
          'INSERT INTO leadflow_contact_companies(contact_id,tenant_id,workspace_id,agency_client_id,company_context_id,scope_kind) VALUES($1,$2,$3,$4,$5,$6)',
          [other, tenant, workspace, client, a, 'agency'],
        ),
      ).rejects.toMatchObject({ code: '23514' });
    });
    it('serializes concurrent first binding of the same canonical contact', async () => {
      await migration.up(runner);
      const id = await contact();
      const second = AgencyDataSource.createQueryRunner();
      await second.connect();
      try {
        await second.query(`SET search_path TO "${schema}",public`);
        await runner.startTransaction();
        await second.startTransaction();
        await runner.query("SET LOCAL lock_timeout='500ms'");
        await runner.query(
          'SELECT id FROM contacts WHERE id=$1 FOR KEY SHARE',
          [id],
        );
        await second.query(
          'SELECT id FROM contacts WHERE id=$1 FOR KEY SHARE',
          [id],
        );
        await ref(id, a);
        const competing = expect(
          ref(id, b, 'crm_opportunities', second),
        ).rejects.toMatchObject({ code: '23514' });
        await runner.commitTransaction();
        await competing;
        expect(
          await runner.query(
            'SELECT company_context_id FROM leadflow_contact_companies WHERE contact_id=$1',
            [id],
          ),
        ).toEqual([{ company_context_id: a }]);
      } finally {
        if (runner.isTransactionActive) await runner.rollbackTransaction();
        if (second.isTransactionActive) await second.rollbackTransaction();
        await second.query('SET search_path TO public');
        await second.release();
      }
    });
    it('preserves internal-user suppression across company channels without exposing an operational CRM contact', async () => {
      const id = await contact();
      await runner.query(
        "UPDATE contacts SET lifecycle_stage='internal' WHERE id=$1",
        [id],
      );
      await ref(id, a);
      await ref(id, b);
      await migration.up(runner);
      expect(
        await runner.query('SELECT contact_id FROM leadflow_contact_companies'),
      ).toEqual([]);
      await ref(id, a);
      await ref(id, b);
      await expect(ref(id, a, 'crm_opportunities')).rejects.toMatchObject({
        code: '23514',
      });
    });
  },
);
