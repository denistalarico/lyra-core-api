import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateClientAreaMemberships1797000000000 } from './1797000000000-create-client-area-memberships';
import { CreateClientAreaInvitations1797100000000 } from './1797100000000-create-client-area-invitations';
import { CreateClientAreaManagement1797150000000 } from './1797150000000-create-client-area-management';
import { CreateClientAreaCrmIdentityRelationships1797300000000 } from './1797300000000-create-client-area-crm-identity-relationships';

const run = describePostgresIntegration();

run('CA1 client area memberships migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up and enforces company scope, roles, status, revocation, active uniqueness and session surface', async () => {
    const migration = new CreateClientAreaMemberships1797000000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    const tenant = randomUUID(),
      workspace = randomUUID();
    const clientX = randomUUID(),
      clientY = randomUUID();
    const contactA = randomUUID(),
      contactB = randomUUID();
    const companyA = randomUUID(),
      companyB = randomUUID();
    const person = randomUUID(),
      operator = randomUUID();

    const reject = async (operation: () => Promise<unknown>) => {
      await runner.query('SAVEPOINT expected_failure');
      await expect(operation()).rejects.toThrow();
      await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
    };
    type MembershipOverrides = Partial<{
      tenant: string;
      workspace: string;
      client: string;
      company: string;
      user: string;
      role: string;
      status: string;
      revokedAt: Date | null;
      revokedBy: string | null;
    }>;
    const insertMembership = (overrides: MembershipOverrides = {}) =>
      runner.query(
        `INSERT INTO client_area_memberships
           (tenant_id,workspace_id,agency_client_id,company_context_id,user_id,role,status,revoked_at,revoked_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9) RETURNING id`,
        [
          overrides.tenant ?? tenant,
          overrides.workspace ?? workspace,
          overrides.client ?? clientX,
          overrides.company ?? companyA,
          overrides.user ?? person,
          overrides.role ?? 'client_viewer',
          overrides.status ?? 'active',
          overrides.revokedAt === undefined ? null : overrides.revokedAt,
          overrides.revokedBy === undefined ? null : overrides.revokedBy,
        ],
      ) as Promise<Array<{ id: string }>>;
    const insertSession = (userId: string, surface?: string) =>
      surface
        ? runner.query(
            `INSERT INTO user_sessions (tenant_id,user_id,title,browser,status,surface) VALUES ($1,$2,'t','b','active',$3) RETURNING surface`,
            [tenant, userId, surface],
          )
        : runner.query(
            `INSERT INTO user_sessions (tenant_id,user_id,title,browser,status) VALUES ($1,$2,'t','b','active') RETURNING id`,
            [tenant, userId],
          );

    try {
      // CA2/CA3/CA4 all depend on this table (directly or transitively via
      // client_area_invitations); a real revert undoes them first, in
      // reverse deploy order, so `migration.down` below can drop
      // client_area_memberships even when an earlier spec in this same run
      // left the later tables committed. The transaction below is rolled
      // back, so the database keeps all of them once this spec finishes.
      await new CreateClientAreaCrmIdentityRelationships1797300000000().down(
        runner,
      );
      await new CreateClientAreaManagement1797150000000().down(runner);
      await new CreateClientAreaInvitations1797100000000().down(runner);
      await migration.up(runner);
      await migration.down(runner);

      // A session created while the column does not exist (i.e. before CA1).
      const [legacy] = (await insertSession(operator)) as Array<{ id: string }>;

      await migration.up(runner);
      await migration.down(runner);
      await migration.up(runner);
      await migration.up(runner); // idempotent re-run, as specs do

      const [legacyAfter] = (await runner.query(
        'SELECT surface FROM user_sessions WHERE id = $1',
        [legacy.id],
      )) as Array<{ surface: string }>;
      expect(legacyAfter.surface).toBe('agency');

      await runner.query(
        `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name) VALUES
         ($1,$3,$4,'organization','Empresa A'),($2,$3,$4,'organization','Empresa B')`,
        [contactA, contactB, tenant, workspace],
      );
      await runner.query(
        `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name) VALUES
         ($1,$3,$4,$5,'Conta X'),($2,$3,$4,$6,'Conta Y')`,
        [clientX, clientY, tenant, workspace, contactA, contactB],
      );
      await runner.query(
        `INSERT INTO agency_client_company_contexts (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES
         ($1,$3,$4,$5,$7,'active',true),($2,$3,$4,$6,$8,'active',true)`,
        [
          companyA,
          companyB,
          tenant,
          workspace,
          clientX,
          clientY,
          contactA,
          contactB,
        ],
      );

      // Roles: only the prefixed Client Area keys.
      for (const role of [
        'admin',
        'owner',
        'manager',
        'member',
        'client',
        '',
      ]) {
        await reject(() => insertMembership({ role }));
      }
      // Status: membership never represents an invitation.
      for (const status of ['invited', 'expired', 'suspended']) {
        await reject(() => insertMembership({ status }));
      }
      // status='revoked' ⇔ revoked_at IS NOT NULL; revoked_by only when revoked.
      await reject(() =>
        insertMembership({ status: 'revoked', revokedAt: null }),
      );
      await reject(() =>
        insertMembership({ status: 'active', revokedAt: new Date() }),
      );
      await reject(() => insertMembership({ revokedBy: operator }));

      // Composite FK: the tuple must describe the real company.
      await reject(() => insertMembership({ tenant: randomUUID() }));
      await reject(() => insertMembership({ workspace: randomUUID() }));
      await reject(() => insertMembership({ client: clientY }));
      await reject(() => insertMembership({ company: randomUUID() }));
      await reject(() => insertMembership({ company: companyB }));

      // Active uniqueness per (company, person); re-grant after revoke.
      const [first] = await insertMembership({ role: 'client_admin' });
      await reject(() => insertMembership({ role: 'client_viewer' }));
      await insertMembership({
        company: companyB,
        client: clientY,
        role: 'client_operator',
      });
      await runner.query(
        `UPDATE client_area_memberships SET status='revoked', revoked_at=now(), revoked_by_user_id=$2 WHERE id=$1`,
        [first.id, operator],
      );
      const [regrant] = await insertMembership({ role: 'client_viewer' });
      expect(regrant.id).not.toBe(first.id);
      const history = (await runner.query(
        `SELECT status FROM client_area_memberships WHERE company_context_id=$1 AND user_id=$2 ORDER BY created_at, status`,
        [companyA, person],
      )) as Array<{ status: string }>;
      expect(history.map((row) => row.status).sort()).toEqual([
        'active',
        'revoked',
      ]);

      // Company Context cannot disappear under a membership.
      await reject(() =>
        runner.query(
          'DELETE FROM agency_client_company_contexts WHERE id = $1',
          [companyA],
        ),
      );

      const activeIndex = (await runner.query(
        `SELECT indexdef FROM pg_indexes WHERE indexname = 'UQ_client_area_memberships_active'`,
      )) as Array<{ indexdef: string }>;
      expect(activeIndex[0].indexdef).toContain(
        `WHERE ((status)::text = 'active'::text)`,
      );

      // Session surface: default Agency, explicit client_area, nothing else.
      const [agencyDefault] = (await runner.query(
        `INSERT INTO user_sessions (tenant_id,user_id,title,browser,status) VALUES ($1,$2,'t','b','current') RETURNING surface`,
        [tenant, operator],
      )) as Array<{ surface: string }>;
      expect(agencyDefault.surface).toBe('agency');
      const [clientSession] = (await insertSession(
        person,
        'client_area',
      )) as Array<{ surface: string }>;
      expect(clientSession.surface).toBe('client_area');
      await reject(() => insertSession(person, 'admin'));

      const [event] = (await runner.query(
        `INSERT INTO user_login_events (tenant_id,user_id,event_type) VALUES ($1,$2,'login_success') RETURNING surface`,
        [tenant, operator],
      )) as Array<{ surface: string }>;
      expect(event.surface).toBe('agency');
      await reject(() =>
        runner.query(
          `INSERT INTO user_login_events (tenant_id,user_id,event_type,surface) VALUES ($1,$2,'login_failed','suite')`,
          [tenant, person],
        ),
      );
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
