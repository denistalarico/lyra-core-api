import { randomUUID } from 'crypto';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyDataSource } from '../agency-typeorm.datasource';
import { CreateClientAreaMemberships1797000000000 } from './1797000000000-create-client-area-memberships';
import { CreateClientAreaInvitations1797100000000 } from './1797100000000-create-client-area-invitations';

const run = describePostgresIntegration();
const PERMISSION = 'agency.clients.client_area_members.manage.admin';

const hash = (seed: string) =>
  seed
    .repeat(64)
    .slice(0, 64)
    .replace(/[^0-9a-f]/g, 'a');

run('CA2 client area invitations migration against PostgreSQL', () => {
  beforeAll(async () => {
    if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();
  });
  afterAll(async () => {
    if (AgencyDataSource.isInitialized) await AgencyDataSource.destroy();
  });

  it('runs up/down/up and enforces company scope, states, token hash, pending uniqueness, audit and reset surface', async () => {
    const memberships = new CreateClientAreaMemberships1797000000000();
    const migration = new CreateClientAreaInvitations1797100000000();
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

    let tokenSeq = 0;
    const nextHash = () => {
      tokenSeq += 1;
      return tokenSeq.toString(16).padStart(64, '0');
    };
    type InvitationOverrides = Partial<{
      tenant: string;
      workspace: string;
      client: string;
      company: string;
      email: string;
      emailNormalized: string;
      role: string;
      tokenHash: string;
      status: string;
      expiresAt: Date;
      acceptedUser: string | null;
      acceptedMembership: string | null;
      acceptedAt: Date | null;
      revokedAt: Date | null;
      revokedBy: string | null;
      supersededBy: string | null;
    }>;
    const insertInvitation = (o: InvitationOverrides = {}) =>
      runner.query(
        `INSERT INTO client_area_invitations
           (tenant_id,workspace_id,agency_client_id,company_context_id,email,email_normalized,role,token_hash,
            expires_at,status,invited_by_user_id,accepted_user_id,accepted_membership_id,accepted_at,
            revoked_at,revoked_by_user_id,superseded_by_invitation_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17) RETURNING id`,
        [
          o.tenant ?? tenant,
          o.workspace ?? workspace,
          o.client ?? clientX,
          o.company ?? companyA,
          o.email ?? ' Pessoa@Cliente.com ',
          o.emailNormalized ?? 'pessoa@cliente.com',
          o.role ?? 'client_viewer',
          o.tokenHash ?? nextHash(),
          o.expiresAt ?? new Date(Date.now() + 7 * 86400_000),
          o.status ?? 'pending',
          operator,
          o.acceptedUser ?? null,
          o.acceptedMembership ?? null,
          o.acceptedAt ?? null,
          o.revokedAt ?? null,
          o.revokedBy ?? null,
          o.supersededBy ?? null,
        ],
      ) as Promise<Array<{ id: string }>>;

    try {
      await memberships.up(runner);
      await migration.up(runner);
      await migration.down(runner);

      // A reset row created without the column (i.e. before CA2).
      const [legacyReset] = (await runner.query(
        `INSERT INTO password_resets (tenant_id,user_id,token_hash,expires_at) VALUES ($1,$2,$3,now() + interval '15 minutes') RETURNING id`,
        [tenant, operator, hash('b')],
      )) as Array<{ id: string }>;

      await migration.up(runner);
      await migration.down(runner);
      await migration.up(runner);
      await migration.up(runner); // idempotent re-run, as specs do

      const [legacyAfter] = (await runner.query(
        'SELECT surface FROM password_resets WHERE id = $1',
        [legacyReset.id],
      )) as Array<{ surface: string }>;
      expect(legacyAfter.surface).toBe('agency');
      await reject(() =>
        runner.query(
          `INSERT INTO password_resets (tenant_id,user_id,token_hash,expires_at,surface) VALUES ($1,$2,$3,now(),'suite')`,
          [tenant, person, hash('c')],
        ),
      );

      // down() burns outstanding Client Area reset links before the
      // discriminator disappears.
      const [clientReset] = (await runner.query(
        `INSERT INTO password_resets (tenant_id,user_id,token_hash,expires_at,surface) VALUES ($1,$2,$3,now() + interval '30 minutes','client_area') RETURNING id`,
        [tenant, person, hash('d')],
      )) as Array<{ id: string }>;
      await migration.down(runner);
      const [burned] = (await runner.query(
        'SELECT used_at IS NOT NULL AS used FROM password_resets WHERE id = $1',
        [clientReset.id],
      )) as Array<{ used: boolean }>;
      expect(burned.used).toBe(true);
      await migration.up(runner);

      // Permission seeded for Admin (Owner is implicit), not for Manager/Member.
      const grants = (await runner.query(
        `SELECT r.key FROM platform_role_permissions rp JOIN platform_roles r ON r.id = rp.role_id
          WHERE rp.permission_key = $1 AND rp.tenant_id IS NULL AND rp.enabled`,
        [PERMISSION],
      )) as Array<{ key: string }>;
      const roles = grants.map((row) => row.key);
      expect(roles).toContain('admin');
      expect(roles).not.toContain('manager');
      expect(roles).not.toContain('member');
      const [permission] = (await runner.query(
        'SELECT risk_level FROM platform_permissions WHERE key = $1',
        [PERMISSION],
      )) as Array<{ risk_level: string }>;
      expect(permission).toBeDefined();

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

      // Roles, statuses, email normalization, token hash format, expiry.
      for (const role of ['admin', 'owner', 'manager', 'member', '']) {
        await reject(() => insertInvitation({ role }));
      }
      for (const status of ['expired', 'invited', 'active']) {
        await reject(() => insertInvitation({ status }));
      }
      await reject(() =>
        insertInvitation({ emailNormalized: 'Pessoa@Cliente.com' }),
      );
      await reject(() => insertInvitation({ tokenHash: 'plaintext-token' }));
      await reject(() => insertInvitation({ tokenHash: 'A'.repeat(64) }));
      await reject(() => insertInvitation({ expiresAt: new Date(0) }));

      // Composite FK: the tuple must describe the real company.
      await reject(() => insertInvitation({ tenant: randomUUID() }));
      await reject(() => insertInvitation({ workspace: randomUUID() }));
      await reject(() => insertInvitation({ client: clientY }));
      await reject(() => insertInvitation({ company: randomUUID() }));
      await reject(() => insertInvitation({ company: companyB }));

      // One pending per (company, normalized email); token hash unique.
      const sharedHash = nextHash();
      const [pending] = await insertInvitation({ tokenHash: sharedHash });
      await reject(() => insertInvitation({ email: 'pessoa@cliente.com' }));
      await reject(() =>
        insertInvitation({
          company: companyB,
          client: clientY,
          tokenHash: sharedHash,
        }),
      );
      await insertInvitation({ company: companyB, client: clientY });

      // Accepted fields all-or-nothing and only with status accepted.
      const [membership] = (await runner.query(
        `INSERT INTO client_area_memberships (tenant_id,workspace_id,agency_client_id,company_context_id,user_id,role)
         VALUES ($1,$2,$3,$4,$5,'client_viewer') RETURNING id`,
        [tenant, workspace, clientX, companyA, person],
      )) as Array<{ id: string }>;
      await reject(() =>
        insertInvitation({
          email: 'b@c.com',
          emailNormalized: 'b@c.com',
          status: 'accepted',
          acceptedUser: person,
          acceptedAt: new Date(),
        }),
      );
      await reject(() =>
        insertInvitation({
          email: 'b@c.com',
          emailNormalized: 'b@c.com',
          acceptedUser: person,
          acceptedMembership: membership.id,
          acceptedAt: new Date(),
        }),
      );
      await reject(() =>
        insertInvitation({
          email: 'b@c.com',
          emailNormalized: 'b@c.com',
          status: 'accepted',
          acceptedUser: person,
          acceptedMembership: randomUUID(),
          acceptedAt: new Date(),
        }),
      );
      await runner.query(
        `UPDATE client_area_invitations SET status='accepted', accepted_user_id=$2, accepted_membership_id=$3, accepted_at=now() WHERE id=$1`,
        [pending.id, person, membership.id],
      );

      // Revoked fields: status ⇔ revoked_at; revoked_by/superseded only when revoked.
      await reject(() =>
        insertInvitation({ status: 'revoked', revokedAt: null }),
      );
      await reject(() => insertInvitation({ revokedAt: new Date() }));
      await reject(() => insertInvitation({ revokedBy: operator }));
      await reject(() => insertInvitation({ supersededBy: pending.id }));
      const [replacement] = await insertInvitation();
      await insertInvitation({
        email: 'antigo@c.com',
        emailNormalized: 'antigo@c.com',
        status: 'revoked',
        revokedAt: new Date(),
        revokedBy: operator,
        supersededBy: replacement.id,
      });
      await reject(() =>
        insertInvitation({
          email: 'x@c.com',
          emailNormalized: 'x@c.com',
          status: 'revoked',
          revokedAt: new Date(),
          supersededBy: randomUUID(),
        }),
      );

      // Audit trail: actions, actor, role change consistency, FKs.
      const insertEvent = (
        action: string,
        extra: Partial<{
          actor: string | null;
          previousRole: string | null;
          newRole: string | null;
          company: string;
          invitation: string | null;
          surface: string;
        }> = {},
      ) =>
        runner.query(
          `INSERT INTO client_area_member_events
             (tenant_id,workspace_id,agency_client_id,company_context_id,action,actor_surface,actor_user_id,invitation_id,previous_role,new_role)
           VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
          [
            tenant,
            workspace,
            clientX,
            extra.company ?? companyA,
            action,
            extra.surface ?? 'agency',
            extra.actor === undefined ? operator : extra.actor,
            extra.invitation ?? null,
            extra.previousRole ?? null,
            extra.newRole ?? null,
          ],
        );
      await insertEvent('invited', { invitation: replacement.id });
      await insertEvent('invitation_acceptance_blocked', {
        actor: null,
        surface: 'client_area',
      });
      await insertEvent('role_changed', {
        previousRole: 'client_viewer',
        newRole: 'client_admin',
      });
      await reject(() => insertEvent('invited', { actor: null }));
      await reject(() => insertEvent('deleted'));
      await reject(() => insertEvent('invited', { surface: 'suite' }));
      await reject(() =>
        insertEvent('role_changed', {
          previousRole: 'client_viewer',
          newRole: 'client_viewer',
        }),
      );
      await reject(() => insertEvent('role_changed', { newRole: 'admin' }));
      await reject(() => insertEvent('invited', { company: companyB }));
      await reject(() => insertEvent('invited', { invitation: randomUUID() }));

      // Company Context cannot disappear under invitations or audit rows.
      await reject(() =>
        runner.query(
          'DELETE FROM agency_client_company_contexts WHERE id = $1',
          [companyB],
        ),
      );

      const indexes = (await runner.query(
        `SELECT indexname, indexdef FROM pg_indexes WHERE tablename IN ('client_area_invitations','client_area_member_events')`,
      )) as Array<{ indexname: string; indexdef: string }>;
      const byName = new Map(
        indexes.map((row) => [row.indexname, row.indexdef]),
      );
      expect(byName.get('UQ_client_area_invitations_pending')).toContain(
        `WHERE ((status)::text = 'pending'::text)`,
      );
      expect(byName.get('UQ_client_area_invitations_token_hash')).toContain(
        'UNIQUE',
      );
      expect(byName.has('IDX_client_area_invitations_company')).toBe(true);
      expect(byName.has('IDX_client_area_member_events_company')).toBe(true);
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
  });
});
