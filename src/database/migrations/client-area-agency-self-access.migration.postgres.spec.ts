import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateClientAreaAgencySelfAccess1797700000000 } from './1797700000000-create-client-area-agency-self-access';

const run = describePostgresIntegration();

run('PD3 agency self access migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up and enforces roles, status, revocation coherence and active uniqueness', async () => {
    const migration = new CreateClientAreaAgencySelfAccess1797700000000();
    const runner = AgencyDataSource.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();

    const tenant = randomUUID();
    const workspace = randomUUID();
    const otherWorkspace = randomUUID();
    const owner = randomUUID();
    const admin = randomUUID();
    const actor = randomUUID();

    const reject = async (operation: () => Promise<unknown>) => {
      await runner.query('SAVEPOINT expected_failure');
      await expect(operation()).rejects.toThrow();
      await runner.query('ROLLBACK TO SAVEPOINT expected_failure');
    };

    type Overrides = Partial<{
      tenant: string;
      workspace: string;
      user: string;
      role: string;
      status: string;
      revokedAt: Date | null;
      revokedBy: string | null;
    }>;

    const insertAccess = (overrides: Overrides = {}) =>
      runner.query(
        `INSERT INTO client_area_self_access
           (tenant_id,workspace_id,user_id,role,status,revoked_at,revoked_by_user_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING id`,
        [
          overrides.tenant ?? tenant,
          overrides.workspace ?? workspace,
          overrides.user ?? owner,
          overrides.role ?? 'client_admin',
          overrides.status ?? 'active',
          overrides.revokedAt ?? null,
          overrides.revokedBy ?? null,
        ],
      );

    try {
      // ---------------------------------------------------------------- up
      await migration.up(runner);

      // The self-context switch lands on the agency's existing settings row
      // and defaults to off: activation is always explicit.
      const [{ column_default: selfDefault, is_nullable: selfNullable }] =
        (await runner.query(
          `SELECT column_default, is_nullable FROM information_schema.columns
            WHERE table_name = 'client_area_settings' AND column_name = 'self_enabled'`,
        )) as Array<{ column_default: string; is_nullable: string }>;
      expect(selfDefault).toContain('false');
      expect(selfNullable).toBe('NO');

      // The table must carry NO company columns at all: that absence is the
      // invariant that keeps a fake AgencyClient/Company Context impossible.
      const companyColumns = (await runner.query(
        `SELECT column_name FROM information_schema.columns
          WHERE table_name = 'client_area_self_access'
            AND column_name IN ('agency_client_id','company_context_id','managed_tenant_id')`,
      )) as Array<{ column_name: string }>;
      expect(companyColumns).toEqual([]);

      await insertAccess();
      await insertAccess({ user: admin, role: 'client_viewer' });

      // role CHECK — Agency roles and empty values are refused.
      for (const role of ['owner', 'admin', 'manager', 'member', '']) {
        await reject(() => insertAccess({ user: randomUUID(), role }));
      }
      // status CHECK — the invitation vocabulary does not apply here.
      for (const status of ['invited', 'pending', 'expired', 'suspended', '']) {
        await reject(() =>
          insertAccess({ user: randomUUID(), status, revokedAt: null }),
        );
      }

      // revocation coherence: revoked iff revoked_at is set.
      await reject(() =>
        insertAccess({
          user: randomUUID(),
          status: 'revoked',
          revokedAt: null,
        }),
      );
      await reject(() =>
        insertAccess({
          user: randomUUID(),
          status: 'active',
          revokedAt: new Date(),
        }),
      );
      // revoked_by only on a revoked row.
      await reject(() =>
        insertAccess({
          user: randomUUID(),
          status: 'active',
          revokedBy: actor,
        }),
      );

      // Active uniqueness per (tenant, workspace, user).
      await reject(() => insertAccess());
      // Another workspace of the same tenant is a different scope.
      await insertAccess({ workspace: otherWorkspace });

      // Revoking frees the slot, and the history row is kept (re-grant
      // creates a new row rather than mutating the old one).
      await runner.query(
        `UPDATE client_area_self_access
           SET status='revoked', revoked_at=now(), revoked_by_user_id=$1
         WHERE tenant_id=$2 AND workspace_id=$3 AND user_id=$4 AND status='active'`,
        [actor, tenant, workspace, owner],
      );
      await insertAccess();
      const [{ count }] = (await runner.query(
        `SELECT count(*)::text AS count FROM client_area_self_access
          WHERE tenant_id=$1 AND workspace_id=$2 AND user_id=$3`,
        [tenant, workspace, owner],
      )) as Array<{ count: string }>;
      expect(count).toBe('2');

      // Audit event action/role CHECKs.
      const insertEvent = (action: string, newRole: string | null = null) =>
        runner.query(
          `INSERT INTO client_area_self_access_events
             (tenant_id,workspace_id,action,actor_user_id,target_user_id,new_role)
           VALUES ($1,$2,$3,$4,$5,$6)`,
          [tenant, workspace, action, actor, owner, newRole],
        );
      for (const action of [
        'self_area_enabled',
        'self_area_disabled',
        'self_access_granted',
        'self_access_revoked',
        'self_access_role_changed',
      ]) {
        await insertEvent(action);
      }
      await reject(() => insertEvent('self_access_exported'));
      await reject(() => insertEvent('self_access_granted', 'owner'));

      // -------------------------------------------------------------- down
      await migration.down(runner);
      const afterDown = (await runner.query(
        `SELECT table_name FROM information_schema.tables
          WHERE table_name IN ('client_area_self_access','client_area_self_access_events')`,
      )) as Array<{ table_name: string }>;
      expect(afterDown).toEqual([]);
      const selfColumnAfterDown = (await runner.query(
        `SELECT 1 FROM information_schema.columns
          WHERE table_name='client_area_settings' AND column_name='self_enabled'`,
      )) as Array<unknown>;
      expect(selfColumnAfterDown).toEqual([]);

      // ---------------------------------------------------------- up again
      // Idempotency: the migration must survive a re-run after a rollback,
      // which is how it will actually be applied in production.
      await migration.up(runner);
      await migration.up(runner);
      await insertAccess({ user: randomUUID() });
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
