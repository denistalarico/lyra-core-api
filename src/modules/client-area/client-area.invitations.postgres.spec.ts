import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomBytes, randomUUID } from 'crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { ManagedContextDirectoryService } from '../../common/context/managed-context-directory.service';
import { OperationalContextResolver } from '../../common/context/operational-context.resolver';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { CreateClientAreaMemberships1797000000000 } from '../../database/migrations/1797000000000-create-client-area-memberships';
import { CreateClientAreaInvitations1797100000000 } from '../../database/migrations/1797100000000-create-client-area-invitations';
import { CreateClientAreaCrmIdentityRelationships1797300000000 } from '../../database/migrations/1797300000000-create-client-area-crm-identity-relationships';
import { assertSafePostgresTarget } from '../../testing/postgres-integration-guard';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyAuthModule } from '../agency/agency-auth.module';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import {
  AgencyClientAccessEntity,
  AgencyClientProductAccessEntity,
  PlatformPermissionAuditEventEntity,
  PlatformRoleEntity,
  PlatformRolePermissionEntity,
  PlatformUserPermissionEntity,
} from '../permissions/entities';
import { PermissionsGuard } from '../permissions/guards/permissions.guard';
import { PermissionScopeEvaluatorService } from '../permissions/services/permission-scope-evaluator.service';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import { PlatformContextService } from '../platform/platform-context.service';
import { ClientAreaMembersAgencyController } from './agency/client-area-members.agency.controller';
import { ClientAreaModule } from './client-area.module';
import { ClientAreaRateLimitService } from './services/client-area-rate-limit.service';

// Same contract as otplib v13 (async, resolves `{ valid }`).
jest.mock('otplib', () => ({
  verify: jest.fn(({ token }: { token: string }) =>
    Promise.resolve({ valid: token === '424242' }),
  ),
}));

const run = describePostgresIntegration();

type Body = {
  code?: string;
  accessToken?: string;
  refreshToken?: string;
  requiresTwoFactor?: boolean;
  twoFactorToken?: string;
  method?: string;
  accepted?: boolean;
  delivery?: string;
  existingAccount?: boolean;
  user?: { id: string; email: string; displayName: string };
  invitation?: {
    invitationId?: string;
    email?: string;
    role?: string;
    status?: string;
    companyDisplayName?: string;
    accountStatus?: string;
    roleLabel?: string;
  };
  members?: Array<{
    membershipId: string;
    userId: string;
    email: string | null;
    role: string;
    status: string;
  }>;
  invitations?: Array<{
    invitationId: string;
    email: string;
    expired: boolean;
  }>;
  companies?: Array<{ companyContextId: string; role: string }>;
  member?: { membershipId: string; role: string; status: string };
};
const bodyOf = (response: { body: unknown }) => response.body as Body;

const PASSWORD = 'Senha-forte-CA2!';
const NEW_PASSWORD = 'Outra-senha-CA2-segura';
const TOTP_CODE = '424242';
const AGENCY_SECRET = 'agency-access-secret-ca2-matrix-00000000';
const CLIENT_SECRET = 'client-area-secret-ca2-matrix-1111111111';

const sendEmail = jest.fn<Promise<void>, [unknown]>(() => Promise.resolve());

@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail } }],
  exports: [EmailService],
})
class FakeEmailModule {}

type SentEmail = { to: string; html: string; text: string; subject: string };

run(
  'CA2 Client Area invitations & member management (PostgreSQL, real guards)',
  () => {
    let app: INestApplication;
    let db: DataSource;
    let rateLimit: ClientAreaRateLimitService;
    const savedEnv = { ...process.env };

    const runId = randomUUID().slice(0, 8);
    const email = (label: string) => `${label}.${runId}@ca2-spec.example.com`;

    const T = randomUUID(),
      W = randomUUID(),
      T2 = randomUUID(),
      W2 = randomUUID();
    const orgA = randomUUID(),
      orgA2 = randomUUID(),
      orgB = randomUUID(),
      orgC = randomUUID();
    const X = randomUUID(),
      Y = randomUUID(),
      Z = randomUUID();
    const A = randomUUID(),
      A2 = randomUUID(),
      B = randomUUID(),
      C = randomUUID();
    const OWNER = randomUUID(),
      ADMIN = randomUUID(),
      MANAGER = randomUUID(),
      MEMBER = randomUUID(),
      ADMIN2 = randomUUID();
    const EXIST = randomUUID(),
      EXIST2FA = randomUUID(),
      DUP1 = randomUUID(),
      DUP2 = randomUUID();

    const agency: Record<string, string> = {};

    const http = () => request(app.getHttpServer());
    const base = (client: string, company: string) =>
      `/agency/clients/${client}/companies/${company}/client-area`;
    const asAgency = (token: string) => ({
      get: (path: string) =>
        http().get(path).set('Authorization', `Bearer ${token}`),
      post: (path: string, body: object = {}) =>
        http().post(path).set('Authorization', `Bearer ${token}`).send(body),
      patch: (path: string, body: object = {}) =>
        http().patch(path).set('Authorization', `Bearer ${token}`).send(body),
    });
    const admin = () => asAgency(agency.admin);
    const preview = (token: string) =>
      http().post('/client-area/invitations/preview').send({ token });
    const accept = (body: object) =>
      http().post('/client-area/invitations/accept').send(body);
    const clientLogin = (address: string, password = PASSWORD) =>
      http().post('/client-area/auth/login').send({ email: address, password });
    const clientGet = (path: string, token: string) =>
      http().get(path).set('Authorization', `Bearer ${token}`);

    const sent = (): SentEmail[] =>
      sendEmail.mock.calls.map(([input]) => input as SentEmail);
    function lastTokenFor(address: string, kind: 'invitation' | 'reset') {
      const pattern =
        kind === 'invitation'
          ? /\/client-area\/invitations\/([0-9a-f]{64})/
          : /\/client-area\/reset-password\?token=([0-9a-f]{64})/;
      const matches = sent()
        .filter((mail) => mail.to === address)
        .map((mail) => pattern.exec(mail.text ?? '') ?? pattern.exec(mail.html))
        .filter((match): match is RegExpExecArray => Boolean(match));
      const last = matches.at(-1);
      if (!last) throw new Error(`no ${kind} email for ${address}`);
      return last[1];
    }

    // CA4 requires the invited email to resolve to exactly one eligible CRM
    // person for the target company before an invitation can even be
    // created. These fixtures predate CA4, so every email used to create a
    // NEW invitation during the run needs a person `contacts` row, a matching
    // `contact_methods` row, and an active `contact_company_links` row to the
    // target company's organization contact. `companyOrg` maps each company
    // context constant used in this file to its organization contact and
    // tenant/workspace (company C lives under tenant T2/W2, everything else
    // under T/W).
    const companyOrg: Record<
      string,
      { organizationContactId: string; tenantId: string; workspaceId: string }
    > = {
      [A]: { organizationContactId: orgA, tenantId: T, workspaceId: W },
      [A2]: { organizationContactId: orgA2, tenantId: T, workspaceId: W },
      [B]: { organizationContactId: orgB, tenantId: T, workspaceId: W },
      [C]: { organizationContactId: orgC, tenantId: T2, workspaceId: W2 },
    };
    // Memoized by `${tenantId}:${normalizedEmail}` so repeated invites of the
    // same email within a tenant reuse one CRM person (this matters for the
    // "two invitations, one identity" tests), while the same email under a
    // different tenant (the "same email at another agency" test) still gets
    // its own person.
    const crmPersonByKey = new Map<string, string>();
    async function ensureCrmPerson(address: string, company: string) {
      const target = companyOrg[company];
      if (!target) {
        throw new Error(`ensureCrmPerson: unknown company context ${company}`);
      }
      const normalized = address.trim().toLowerCase();
      const key = `${target.tenantId}:${normalized}`;
      let contactId = crmPersonByKey.get(key);
      if (!contactId) {
        contactId = randomUUID();
        await db.query(
          `INSERT INTO contacts (id, tenant_id, workspace_id, type, display_name)
           VALUES ($1, $2, $3, 'person', $4)`,
          [
            contactId,
            target.tenantId,
            target.workspaceId,
            `Contato ${normalized}`,
          ],
        );
        await db.query(
          `INSERT INTO contact_methods (id, tenant_id, workspace_id, contact_id, type, value, is_primary)
           VALUES (gen_random_uuid(), $1, $2, $3, 'email', $4, true)`,
          [target.tenantId, target.workspaceId, contactId, address.trim()],
        );
        crmPersonByKey.set(key, contactId);
      }
      await db.query(
        `INSERT INTO contact_company_links
           (id, tenant_id, workspace_id, person_contact_id, company_contact_id, status, is_primary, linked_at)
         VALUES (gen_random_uuid(), $1, $2, $3, $4, 'active', false, now())
         ON CONFLICT (person_contact_id, company_contact_id) DO NOTHING`,
        [
          target.tenantId,
          target.workspaceId,
          contactId,
          target.organizationContactId,
        ],
      );
      return contactId;
    }

    async function invite(
      address: string,
      role = 'client_viewer',
      company = A,
      client = X,
    ) {
      await ensureCrmPerson(address, company);
      const response = await admin()
        .post(`${base(client, company)}/invitations`, { email: address, role })
        .expect(201);
      return {
        invitationId: bodyOf(response).invitation!.invitationId!,
        token: lastTokenFor(address.trim(), 'invitation'),
        body: bodyOf(response),
      };
    }
    const signup = (token: string, extra: object = {}) =>
      accept({
        token,
        mode: 'signup',
        displayName: 'Pessoa Convidada',
        password: PASSWORD,
        passwordConfirmation: PASSWORD,
        ...extra,
      });
    const events = (where: string, params: unknown[]) =>
      db.query<
        Array<{
          action: string;
          actor_user_id: string | null;
          actor_surface: string;
          previous_role: string | null;
          new_role: string | null;
          target_email: string | null;
          metadata: Record<string, unknown>;
        }>
      >(
        `SELECT action, actor_user_id, actor_surface, previous_role, new_role, target_email, metadata
         FROM client_area_member_events WHERE ${where} ORDER BY created_at`,
        params,
      );

    beforeAll(async () => {
      process.env.JWT_ACCESS_SECRET = AGENCY_SECRET;
      process.env.JWT_CLIENT_AREA_ACCESS_SECRET = CLIENT_SECRET;
      process.env.CLIENT_AREA_ENABLED = 'true';
      process.env.CLIENT_AREA_FRONTEND_URL = 'https://agency.example.test';
      delete process.env.JWT_2FA_SECRET;

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
          TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
          TypeOrmModule.forFeature(
            [
              PlatformRoleEntity,
              PlatformRolePermissionEntity,
              PlatformUserPermissionEntity,
              AgencyClientAccessEntity,
              AgencyClientProductAccessEntity,
              PlatformPermissionAuditEventEntity,
            ],
            'agency',
          ),
          PassportModule,
          AgencyAuthModule,
          ClientAreaModule,
        ],
        controllers: [ClientAreaMembersAgencyController],
        providers: [
          JwtStrategy,
          // The real guard and the real role-permission lookup (rows seeded by
          // the CA2 migration). The scope evaluator and context resolvers are
          // stubbed: an `.admin` key never reaches resource scoping and this
          // route reads no managed-context header.
          PermissionsGuard,
          PlatformPermissionService,
          {
            provide: PermissionScopeEvaluatorService,
            useValue: { assertScope: () => Promise.resolve() },
          },
          { provide: PlatformContextService, useValue: {} },
          { provide: ManagedContextDirectoryService, useValue: {} },
          {
            provide: OperationalContextResolver,
            useValue: { resolve: () => Promise.resolve(null) },
          },
        ],
      })
        .overrideModule(EmailModule)
        .useModule(FakeEmailModule)
        .compile();

      app = moduleRef.createNestApplication();
      app.useGlobalPipes(
        new ValidationPipe({
          whitelist: true,
          transform: true,
          forbidNonWhitelisted: true,
        }),
      );
      await app.init();

      db = moduleRef.get<DataSource>(getDataSourceToken('agency'));
      rateLimit = moduleRef.get(ClientAreaRateLimitService);
      const crypto = moduleRef.get(SettingsCryptoService, { strict: false });

      const runner = db.createQueryRunner();
      await runner.connect();
      try {
        await new CreateClientAreaMemberships1797000000000().up(runner);
        await new CreateClientAreaInvitations1797100000000().up(runner);
        await new CreateClientAreaCrmIdentityRelationships1797300000000().up(
          runner,
        );
      } finally {
        await runner.release();
      }

      const passwordHash = await argon2.hash(PASSWORD);
      await db.query(
        `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name) VALUES
        ($1,$5,$6,'organization','Empresa A <b>'),($2,$5,$6,'organization','Empresa A2'),
        ($3,$5,$6,'organization','Empresa B'),($4,$7,$8,'organization','Empresa C')`,
        [orgA, orgA2, orgB, orgC, T, W, T2, W2],
      );
      await db.query(
        `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name) VALUES
        ($1,$4,$5,$7,'Rotulo X'),($2,$4,$5,$8,'Rotulo Y'),($3,$6,$9,$10,'Conta Z')`,
        [X, Y, Z, T, W, T2, orgA, orgB, W2, orgC],
      );
      await db.query(
        `INSERT INTO agency_client_company_contexts (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES
        ($1,$5,$6,$7,$9,'active',true),($2,$5,$6,$7,$10,'active',false),
        ($3,$5,$6,$8,$11,'active',true),($4,$12,$13,$14,$15,'active',true)`,
        [A, A2, B, C, T, W, X, Y, orgA, orgA2, orgB, T2, W2, Z, orgC],
      );
      // Pre-existing gate (CA3), independent of CA4/CRM: `assertAgencyEnabled`,
      // `hasIdentityAvailableCompany` and `assertIdentityAgencyEnabled` all
      // require an enabled tenant-level row plus an enabled per-company row
      // before any membership grants access. Mirrors the seeding pattern in
      // client-area.security-matrix.postgres.spec.ts.
      await db.query(
        `INSERT INTO client_area_settings (tenant_id,workspace_id,enabled) VALUES
        ($1,$2,true),($3,$4,true)`,
        [T, W, T2, W2],
      );
      await db.query(
        `INSERT INTO client_area_company_settings (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,approvals_enabled) VALUES
        ($1,$2,$3,$5,true,true),($1,$2,$3,$6,true,true),
        ($1,$2,$4,$7,true,true),($8,$9,$10,$11,true,true)`,
        [T, W, X, Y, A, A2, B, T2, W2, Z, C],
      );

      const identities: Array<[string, string, string, boolean]> = [
        [T, OWNER, email('owner'), false],
        [T, ADMIN, email('admin'), false],
        [T, MANAGER, email('manager'), false],
        [T, MEMBER, email('member'), false],
        [T2, ADMIN2, email('admin2'), false],
        [T, EXIST, email('exist'), false],
        [T, EXIST2FA, email('exist2fa'), true],
        [T, DUP1, email('dup'), false],
        [T, DUP2, email('dup'), false],
      ];
      for (const [tenant, user, address, twoFactor] of identities) {
        await db.query(
          `INSERT INTO user_security_settings
           (tenant_id,user_id,current_email,password_hash,two_factor_enabled,two_factor_method,two_factor_secret_encrypted,login_alerts_enabled)
         VALUES ($1,$2,$3,$4,$5,'authenticator',$6,false)`,
          [
            tenant,
            user,
            address,
            passwordHash,
            twoFactor,
            twoFactor ? crypto.encrypt('TOTPSECRET') : null,
          ],
        );
      }
      const seats: Array<[string, string, string, string, string]> = [
        [T, W, OWNER, email('owner'), 'owner'],
        [T, W, ADMIN, email('admin'), 'admin'],
        [T, W, MANAGER, email('manager'), 'manager'],
        [T, W, MEMBER, email('member'), 'member'],
        [T2, W2, ADMIN2, email('admin2'), 'admin'],
      ];
      for (const [tenant, workspace, user, address, role] of seats) {
        await db.query(
          `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES ($1,$2,$3,'Operador',$4,$5,'active')`,
          [tenant, workspace, user, address, role],
        );
      }
      // A pending Agency seat (no identity yet) for an email.
      await db.query(
        `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES ($1,$2,NULL,'Futuro operador',$3,'member','invited')`,
        [T, W, email('seat')],
      );

      for (const [key, address] of [
        ['owner', email('owner')],
        ['admin', email('admin')],
        ['manager', email('manager')],
        ['member', email('member')],
        ['admin2', email('admin2')],
      ]) {
        const response = await http()
          .post('/agency/auth/login')
          .send({ email: address, password: PASSWORD })
          .expect(201);
        agency[key] = bodyOf(response).accessToken!;
      }

      // Existing Client Area people, members of B (granted by the Agency).
      for (const user of [EXIST, EXIST2FA]) {
        await db.query(
          `INSERT INTO client_area_memberships (tenant_id,workspace_id,agency_client_id,company_context_id,user_id,role,granted_by_user_id)
         VALUES ($1,$2,$3,$4,$5,'client_viewer',$6)`,
          [T, W, Y, B, user, ADMIN],
        );
      }

      // CA4: every Client Area identity needs a linked CRM person. Seed one
      // for each of the two pre-existing members (EXIST, EXIST2FA), both
      // eligible for company B (matching their existing membership above).
      for (const [user, address] of [
        [EXIST, email('exist')],
        [EXIST2FA, email('exist2fa')],
      ] as const) {
        const personContactId = randomUUID();
        await db.query(
          `INSERT INTO contacts (id, tenant_id, workspace_id, type, display_name)
           VALUES ($1, $2, $3, 'person', $4)`,
          [personContactId, T, W, `Contato ${address}`],
        );
        await db.query(
          `INSERT INTO contact_methods (id, tenant_id, workspace_id, contact_id, type, value, is_primary)
           VALUES (gen_random_uuid(), $1, $2, $3, 'email', $4, true)`,
          [T, W, personContactId, address],
        );
        await db.query(
          `INSERT INTO contact_company_links
             (id, tenant_id, workspace_id, person_contact_id, company_contact_id, status, is_primary, linked_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'active', false, now())`,
          [T, W, personContactId, orgB],
        );
        await db.query(
          `INSERT INTO client_area_identity_contacts
             (id, tenant_id, workspace_id, user_id, contact_id, status, linked_at)
           VALUES (gen_random_uuid(), $1, $2, $3, $4, 'active', now())`,
          [T, W, user, personContactId],
        );
        // Register with ensureCrmPerson's memo so later invites of this same
        // email (e.g. to company A/A2) reuse this contact and only add a new
        // contact_company_links row, instead of creating a second person.
        crmPersonByKey.set(
          `${T}:${address.trim().toLowerCase()}`,
          personContactId,
        );
      }
    }, 90_000);

    beforeEach(() => {
      rateLimit.reset();
      process.env.CLIENT_AREA_ENABLED = 'true';
    });

    afterAll(async () => {
      try {
        if (db?.isInitialized) {
          assertSafePostgresTarget();
          const tenants = [T, T2];
          for (const table of [
            'client_area_member_events',
            'client_area_invitations',
            'client_area_memberships',
            'password_resets',
            'user_sessions',
            'user_login_events',
            'auth_email_2fa_codes',
            'user_trusted_devices',
            'user_security_settings',
            'user_profile',
            'workspace_users',
            'platform_permission_audit_events',
            // CA4 CRM identity bridge — must be deleted before `contacts`
            // (FK ... REFERENCES contacts ON DELETE RESTRICT).
            'client_area_identity_contacts',
            'contact_company_links',
            'contact_methods',
            // CA3 settings gates — `client_area_company_settings` FKs to
            // `agency_client_company_contexts` (RESTRICT), delete first.
            'client_area_company_settings',
            'client_area_settings',
            'agency_client_company_contexts',
            'agency_clients',
            'contacts',
          ]) {
            await db.query(
              `DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`,
              [tenants],
            );
          }
        }
      } finally {
        await app?.close();
        process.env = { ...savedEnv };
      }
    });

    describe('invitation matrix (CA2 §59)', () => {
      it('#1 new identity: invite → preview → signup creates identity + profile + membership, no workspace_users, session issued', async () => {
        const address = email('novo');
        const { invitationId, token, body } = await invite(
          `  ${address.toUpperCase()} `.trim(),
          'client_operator',
        );
        expect(body.delivery).toBe('sent');
        expect(body.existingAccount).toBe(false);

        // Only the hash is stored; the email carries the Client Area link.
        const [row] = await db.query<
          Array<{ token_hash: string; email: string; email_normalized: string }>
        >(
          'SELECT token_hash, email, email_normalized FROM client_area_invitations WHERE id = $1',
          [invitationId],
        );
        expect(row.token_hash).not.toBe(token);
        expect(row.token_hash).toMatch(/^[0-9a-f]{64}$/);
        expect(row.email).toBe(address.toUpperCase());
        expect(row.email_normalized).toBe(address);
        const mail = sent().at(-1)!;
        expect(mail.html).toContain(
          `https://agency.example.test/client-area/invitations/${token}`,
        );
        expect(mail.html).not.toMatch(/https:\/\/agency\.example\.test\/login/);
        expect(mail.html).toContain('Empresa A &lt;b&gt;');
        expect(mail.html).not.toContain('Empresa A <b>');

        const previewed = await preview(token).expect(200);
        expect(bodyOf(previewed).invitation).toEqual({
          companyDisplayName: 'Empresa A <b>',
          email: address.toUpperCase(),
          role: 'client_operator',
          roleLabel: 'Operador',
          expiresAt: expect.any(String) as unknown,
          accountStatus: 'new',
        });
        for (const internal of [T, W, X, A, ADMIN]) {
          expect(JSON.stringify(previewed.body)).not.toContain(internal);
        }

        const accepted = await signup(token).expect(200);
        expect(bodyOf(accepted).accepted).toBe(true);
        const user = bodyOf(accepted).user!;
        expect(user.email).toBe(address);
        expect(user.displayName).toBe('Pessoa Convidada');

        const companies = await clientGet(
          '/client-area/companies',
          bodyOf(accepted).accessToken!,
        ).expect(200);
        expect(bodyOf(companies).companies).toEqual([
          {
            companyContextId: A,
            displayName: 'Empresa A <b>',
            role: 'client_operator',
          },
        ]);

        const seats = await db.query<Array<unknown>>(
          'SELECT 1 FROM workspace_users WHERE tenant_id = $1 AND user_id = $2',
          [T, user.id],
        );
        expect(seats).toHaveLength(0);
        const [invitation] = await db.query<
          Array<{
            status: string;
            accepted_user_id: string;
            accepted_membership_id: string;
          }>
        >(
          'SELECT status, accepted_user_id, accepted_membership_id FROM client_area_invitations WHERE id = $1',
          [invitationId],
        );
        expect(invitation.status).toBe('accepted');
        expect(invitation.accepted_user_id).toBe(user.id);
        const [membership] = await db.query<
          Array<{ id: string; role: string; granted_by_user_id: string }>
        >(
          'SELECT id, role, granted_by_user_id FROM client_area_memberships WHERE user_id = $1',
          [user.id],
        );
        expect(membership).toMatchObject({
          id: invitation.accepted_membership_id,
          role: 'client_operator',
          granted_by_user_id: ADMIN,
        });
        const trail = await events('invitation_id = $1', [invitationId]);
        expect(
          trail.map((event) => [event.action, event.actor_user_id]),
        ).toEqual([
          ['invited', ADMIN],
          ['invitation_accepted', user.id],
        ]);
        expect(trail[1].actor_surface).toBe('client_area');

        // #6 replay of an accepted token.
        const replay = await signup(token).expect(404);
        expect(bodyOf(replay).code).toBe('client_area_invitation_invalid');
        await preview(token).expect(404);
      });

      it('#2/#8/#52 existing identity: must log in (wrong password 401), then one identity holds two memberships', async () => {
        const { token, body } = await invite(email('exist'), 'client_admin');
        expect(body.existingAccount).toBe(true);
        const previewed = await preview(token).expect(200);
        expect(bodyOf(previewed).invitation!.accountStatus).toBe('existing');

        const wrongMode = await signup(token).expect(409);
        expect(bodyOf(wrongMode).code).toBe(
          'client_area_invitation_requires_login',
        );
        const wrong = await accept({
          token,
          mode: 'login',
          password: 'errada-123456',
        }).expect(401);
        expect(bodyOf(wrong).code).toBe('client_area_invalid_credentials');

        const done = await accept({
          token,
          mode: 'login',
          password: PASSWORD,
        }).expect(200);
        expect(bodyOf(done).user!.id).toBe(EXIST);
        const companies = await clientGet(
          '/client-area/companies',
          bodyOf(done).accessToken!,
        ).expect(200);
        expect(
          bodyOf(companies)
            .companies!.map((company) => company.companyContextId)
            .sort(),
        ).toEqual([A, B].sort());
        const identities = await db.query<Array<unknown>>(
          'SELECT 1 FROM user_security_settings WHERE tenant_id = $1 AND LOWER(current_email) = $2',
          [T, email('exist')],
        );
        expect(identities).toHaveLength(1);
      });

      it('#3 Agency operators (active seat or pending seat) cannot be invited; becoming one after the invite blocks acceptance (audited)', async () => {
        for (const address of [email('manager'), email('seat')]) {
          await ensureCrmPerson(address, A);
          const response = await admin()
            .post(`${base(X, A)}/invitations`, {
              email: address,
              role: 'client_viewer',
            })
            .expect(409);
          expect(bodyOf(response).code).toBe(
            'client_area_identity_is_agency_operator',
          );
        }

        const address = email('vira-operador');
        const { token, invitationId } = await invite(address);
        await db.query(
          `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES ($1,$2,NULL,'Novo',$3,'member','invited')`,
          [T, W, address],
        );
        try {
          const response = await signup(token).expect(409);
          expect(bodyOf(response).code).toBe(
            'client_area_identity_is_agency_operator',
          );
          const trail = await events('invitation_id = $1', [invitationId]);
          expect(trail.at(-1)).toMatchObject({
            action: 'invitation_acceptance_blocked',
            actor_user_id: null,
            metadata: { reason: 'agency_operator' },
          });
          const created = await db.query<Array<unknown>>(
            'SELECT 1 FROM user_security_settings WHERE tenant_id = $1 AND current_email = $2',
            [T, address],
          );
          expect(created).toHaveLength(0);
        } finally {
          await db.query(
            'DELETE FROM workspace_users WHERE tenant_id = $1 AND email = $2',
            [T, address],
          );
        }
      });

      it('#4/#5/#7 expired, revoked and unknown tokens fail with one generic answer', async () => {
        const expired = await invite(email('expira'));
        await db.query(
          `UPDATE client_area_invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1`,
          [expired.invitationId],
        );
        for (const call of [
          () => preview(expired.token),
          () => signup(expired.token),
        ]) {
          const response = await call().expect(404);
          expect(bodyOf(response).code).toBe('client_area_invitation_invalid');
        }

        const revoked = await invite(email('revogado'));
        await admin()
          .post(`${base(X, A)}/invitations/${revoked.invitationId}/revoke`)
          .expect(200);
        const afterRevoke = await signup(revoked.token).expect(404);
        expect(bodyOf(afterRevoke).code).toBe('client_area_invitation_invalid');

        const unknown = await preview(randomBytes(32).toString('hex')).expect(
          404,
        );
        expect(bodyOf(unknown).code).toBe('client_area_invitation_invalid');
        await preview('not-a-token').expect(400);
      });

      it('#9 existing identity with 2FA proves it; the challenge token is no bearer and is bound to its invitation', async () => {
        const { token } = await invite(email('exist2fa'), 'client_viewer');
        const other = await invite(email('exist2fa'), 'client_viewer', A2);

        const challenge = await accept({
          token,
          mode: 'login',
          password: PASSWORD,
        }).expect(200);
        expect(bodyOf(challenge)).toMatchObject({
          requiresTwoFactor: true,
          method: 'authenticator',
        });
        expect(bodyOf(challenge).accessToken).toBeUndefined();
        const twoFactorToken = bodyOf(challenge).twoFactorToken!;

        await clientGet('/client-area/me', twoFactorToken).expect(401);
        await asAgency(twoFactorToken).get('/agency/auth/me').expect(401);
        // Bound to the invitation it was issued for.
        await accept({
          token: other.token,
          mode: 'login',
          twoFactorToken,
          code: TOTP_CODE,
        }).expect(401);
        await accept({
          token,
          mode: 'login',
          twoFactorToken,
          code: '000000',
        }).expect(401);

        const memberships = await db.query<Array<unknown>>(
          `SELECT 1 FROM client_area_memberships WHERE user_id = $1 AND company_context_id = $2`,
          [EXIST2FA, A],
        );
        expect(memberships).toHaveLength(0);

        const done = await accept({
          token,
          mode: 'login',
          twoFactorToken,
          code: TOTP_CODE,
        }).expect(200);
        expect(bodyOf(done).user!.id).toBe(EXIST2FA);
      });

      it('#10 two identities with the invited email fail closed at invite and at acceptance (audited)', async () => {
        // Exactly one CRM person for email('dup')/company A, so the request
        // reaches assertInvitable and fails on account ambiguity (the two
        // user_security_settings rows below), not on CRM ineligibility.
        await ensureCrmPerson(email('dup'), A);
        const refused = await admin()
          .post(`${base(X, A)}/invitations`, {
            email: email('dup'),
            role: 'client_viewer',
          })
          .expect(409);
        expect(bodyOf(refused).code).toBe('client_area_account_ambiguous');

        const address = email('duplica-depois');
        const { token, invitationId } = await invite(address);
        const ghosts = [randomUUID(), randomUUID()];
        for (const user of ghosts) {
          await db.query(
            `INSERT INTO user_security_settings (tenant_id,user_id,current_email,login_alerts_enabled) VALUES ($1,$2,$3,false)`,
            [T, user, address],
          );
        }
        try {
          const response = await accept({
            token,
            mode: 'login',
            password: PASSWORD,
          }).expect(409);
          expect(bodyOf(response).code).toBe('client_area_account_ambiguous');
          const [blocked] = await events(
            `invitation_id = $1 AND action = 'invitation_acceptance_blocked'`,
            [invitationId],
          );
          expect(blocked.metadata).toEqual({ reason: 'account_ambiguous' });
        } finally {
          await db.query(
            'DELETE FROM user_security_settings WHERE tenant_id = $1 AND user_id = ANY($2::uuid[])',
            [T, ghosts],
          );
        }
      });

      it('#11 concurrent accepts of one token: exactly one wins, one identity, one membership', async () => {
        const address = email('corrida');
        const { token, invitationId } = await invite(address);

        const results = await Promise.all([signup(token), signup(token)]);
        const statuses = results.map((result) => result.status).sort();
        expect(statuses[0]).toBe(200);
        expect(statuses[1]).toBeGreaterThanOrEqual(400);

        const identities = await db.query<Array<{ user_id: string }>>(
          'SELECT user_id FROM user_security_settings WHERE tenant_id = $1 AND current_email = $2',
          [T, address],
        );
        expect(identities).toHaveLength(1);
        const memberships = await db.query<Array<unknown>>(
          `SELECT 1 FROM client_area_memberships WHERE user_id = $1 AND status = 'active'`,
          [identities[0].user_id],
        );
        expect(memberships).toHaveLength(1);
        const accepted = await events(
          `invitation_id = $1 AND action = 'invitation_accepted'`,
          [invitationId],
        );
        expect(accepted).toHaveLength(1);
      });

      it('two invitations of one new email to two companies, accepted at once, never create two identities', async () => {
        const address = email('duas-empresas');
        const first = await invite(address, 'client_viewer', A);
        const second = await invite(address, 'client_viewer', B, Y);

        const results = await Promise.all([
          signup(first.token),
          signup(second.token),
        ]);
        expect(results.map((result) => result.status).sort()).toEqual([
          200, 409,
        ]);
        const loser = results.find((result) => result.status === 409)!;
        expect(bodyOf(loser).code).toBe(
          'client_area_invitation_requires_login',
        );
        const identities = await db.query<Array<unknown>>(
          'SELECT 1 FROM user_security_settings WHERE tenant_id = $1 AND current_email = $2',
          [T, address],
        );
        expect(identities).toHaveLength(1);
      });

      it('#12/#13 company or Agency Client archived after the invite → invitation invalid', async () => {
        const { token } = await invite(email('arquivo'), 'client_viewer', A2);
        await db.query(
          `UPDATE agency_client_company_contexts SET status = 'archived', archived_at = now() WHERE id = $1`,
          [A2],
        );
        try {
          await preview(token).expect(404);
          await signup(token).expect(404);
        } finally {
          await db.query(
            `UPDATE agency_client_company_contexts SET status = 'active', archived_at = NULL WHERE id = $1`,
            [A2],
          );
        }
        await db.query(
          `UPDATE agency_clients SET archived_at = now() WHERE id = $1`,
          [X],
        );
        try {
          await preview(token).expect(404);
          await signup(token).expect(404);
        } finally {
          await db.query(
            `UPDATE agency_clients SET archived_at = NULL WHERE id = $1`,
            [X],
          );
        }
        await preview(token).expect(200);
      });

      it('#14/#15 role, company and email in the acceptance body are refused and never honored', async () => {
        const address = email('adultera');
        const { token } = await invite(address, 'client_viewer');
        for (const tampered of [
          { role: 'client_admin' },
          { companyContextId: B },
          { email: email('outra') },
          { tenantId: T2 },
        ]) {
          await signup(token, tampered).expect(400);
        }
        const done = await signup(token).expect(200);
        const context = await clientGet(
          `/client-area/companies/${A}/context`,
          bodyOf(done).accessToken!,
        ).expect(200);
        expect(
          (context.body as { context: { role: string } }).context.role,
        ).toBe('client_viewer');
        await clientGet(
          `/client-area/companies/${B}/context`,
          bodyOf(done).accessToken!,
        ).expect(404);
        expect(bodyOf(done).user!.email).toBe(address);
      });

      it('#16 a pending invitation authorizes nothing (no login, no directory entry, no context)', async () => {
        const address = email('pendente');
        await invite(address);
        await clientLogin(address).expect(401);

        await invite(email('exist'), 'client_viewer', A2);
        const session = await clientLogin(email('exist')).expect(200);
        const companies = await clientGet(
          '/client-area/companies',
          bodyOf(session).accessToken!,
        ).expect(200);
        expect(
          bodyOf(companies).companies!.map((entry) => entry.companyContextId),
        ).not.toContain(A2);
        await clientGet(
          `/client-area/companies/${A2}/context`,
          bodyOf(session).accessToken!,
        ).expect(404);
      });

      it('#17 inviting someone who is already a member answers membership_exists', async () => {
        const response = await admin()
          .post(`${base(Y, B)}/invitations`, {
            email: email('exist'),
            role: 'client_viewer',
          })
          .expect(409);
        expect(bodyOf(response).code).toBe('client_area_membership_exists');
      });

      it('#18/#55 revoked member re-invited: new membership row, the old one stays revoked', async () => {
        const address = email('volta');
        const first = await invite(address);
        const joined = await signup(first.token).expect(200);
        const userId = bodyOf(joined).user!.id;
        const list = await admin()
          .get(`${base(X, A)}/members`)
          .expect(200);
        const membership = bodyOf(list).members!.find(
          (member) => member.userId === userId,
        )!;
        await admin()
          .post(`${base(X, A)}/members/${membership.membershipId}/revoke`)
          .expect(200);
        await clientGet('/client-area/me', bodyOf(joined).accessToken!).expect(
          401,
        );

        const again = await invite(address, 'client_admin');
        expect(again.body.existingAccount).toBe(true);
        await accept({
          token: again.token,
          mode: 'login',
          password: PASSWORD,
        }).expect(200);
        const rows = await db.query<Array<{ status: string; role: string }>>(
          `SELECT status, role FROM client_area_memberships WHERE user_id = $1 AND company_context_id = $2 ORDER BY created_at`,
          [userId, A],
        );
        expect(rows).toEqual([
          { status: 'revoked', role: 'client_viewer' },
          { status: 'active', role: 'client_admin' },
        ]);
      });

      it('#53 the same email invited by another agency gets its own tenant-scoped identity', async () => {
        const address = email('duas-agencias');
        const first = await invite(address);
        await signup(first.token).expect(200);

        await ensureCrmPerson(address, C);
        const other = await asAgency(agency.admin2)
          .post(`${base(Z, C)}/invitations`, {
            email: address,
            role: 'client_viewer',
          })
          .expect(201);
        expect(bodyOf(other).existingAccount).toBe(false);
        const token = lastTokenFor(address, 'invitation');
        await signup(token, {
          password: NEW_PASSWORD,
          passwordConfirmation: NEW_PASSWORD,
        }).expect(200);

        const identities = await db.query<Array<{ tenant_id: string }>>(
          'SELECT tenant_id FROM user_security_settings WHERE current_email = $1 ORDER BY tenant_id',
          [address],
        );
        expect(identities.map((row) => row.tenant_id).sort()).toEqual(
          [T, T2].sort(),
        );
        // Distinct passwords → each login resolves to its own tenant.
        const inT2 = await clientLogin(address, NEW_PASSWORD).expect(200);
        const companies = await clientGet(
          '/client-area/companies',
          bodyOf(inT2).accessToken!,
        ).expect(200);
        expect(
          bodyOf(companies).companies!.map((entry) => entry.companyContextId),
        ).toEqual([C]);
      });

      it('signup enforces the password policy and a display name', async () => {
        const address = email('politica');
        const { token } = await invite(address);
        for (const extra of [
          { password: 'curta', passwordConfirmation: 'curta' },
          { password: PASSWORD, passwordConfirmation: `${PASSWORD}x` },
          { password: address, passwordConfirmation: address },
        ]) {
          const response = await signup(token, extra).expect(400);
          expect(bodyOf(response).code).toBe('client_area_password_policy');
        }
        await signup(token, { displayName: 'x' }).expect(400);
        await signup(token).expect(200);
      });
    });

    describe('Agency management matrix (CA2 §60)', () => {
      it('only Admin/Owner hold the permission; Manager, Member, Client Area tokens and anonymous callers are refused', async () => {
        await asAgency(agency.owner)
          .get(`${base(X, A)}/members`)
          .expect(200);
        await admin()
          .get(`${base(X, A)}/members`)
          .expect(200);
        for (const token of [agency.manager, agency.member]) {
          await asAgency(token)
            .get(`${base(X, A)}/members`)
            .expect(403);
          await asAgency(token)
            .post(`${base(X, A)}/invitations`, {
              email: email('negado'),
              role: 'client_viewer',
            })
            .expect(403);
        }
        const client = await clientLogin(email('exist')).expect(200);
        await asAgency(bodyOf(client).accessToken!)
          .get(`${base(X, A)}/members`)
          .expect(401);
        await http()
          .get(`${base(X, A)}/members`)
          .expect(401);
      });

      it('company A routes cannot touch B; the same Agency Client does not widen; other tenants see nothing', async () => {
        const bList = await admin()
          .get(`${base(Y, B)}/members`)
          .expect(200);
        const bMember = bodyOf(bList).members!.find(
          (member) => member.userId === EXIST2FA,
        )!;
        const bInvite = await invite(email('so-b'), 'client_viewer', B, Y);

        // B's membership/invitation through A's (or A2's) path → 404, untouched.
        for (const company of [A, A2]) {
          await admin()
            .post(`${base(X, company)}/members/${bMember.membershipId}/revoke`)
            .expect(404);
          await admin()
            .patch(`${base(X, company)}/members/${bMember.membershipId}/role`, {
              role: 'client_admin',
            })
            .expect(404);
          await admin()
            .post(
              `${base(X, company)}/invitations/${bInvite.invitationId}/revoke`,
            )
            .expect(404);
          await admin()
            .post(
              `${base(X, company)}/invitations/${bInvite.invitationId}/resend`,
            )
            .expect(404);
        }
        // A client/company pair that does not belong together → 404.
        await admin()
          .get(`${base(Y, A)}/members`)
          .expect(404);
        // A's listing never shows B's or A2's people.
        const aList = await admin()
          .get(`${base(X, A)}/members`)
          .expect(200);
        expect(
          bodyOf(aList).members!.map((member) => member.membershipId),
        ).not.toContain(bMember.membershipId);
        // Another agency's admin cannot address this tenant's company at all.
        await asAgency(agency.admin2)
          .get(`${base(X, A)}/members`)
          .expect(404);

        const [still] = await db.query<Array<{ status: string; role: string }>>(
          'SELECT status, role FROM client_area_memberships WHERE id = $1',
          [bMember.membershipId],
        );
        expect(still).toEqual({ status: 'active', role: 'client_viewer' });
        await preview(bInvite.token).expect(200);
      });

      it('role change: only Client Area roles, audited before/after, same role is a no-op', async () => {
        const { token } = await invite(email('papel'));
        const joined = await signup(token).expect(200);
        const userId = bodyOf(joined).user!.id;
        const list = await admin()
          .get(`${base(X, A)}/members`)
          .expect(200);
        const { membershipId } = bodyOf(list).members!.find(
          (member) => member.userId === userId,
        )!;

        for (const role of ['admin', 'owner', 'member', '']) {
          await admin()
            .patch(`${base(X, A)}/members/${membershipId}/role`, { role })
            .expect(400);
        }
        const changed = await admin()
          .patch(`${base(X, A)}/members/${membershipId}/role`, {
            role: 'client_admin',
          })
          .expect(200);
        expect(bodyOf(changed).member).toMatchObject({ role: 'client_admin' });
        await admin()
          .patch(`${base(X, A)}/members/${membershipId}/role`, {
            role: 'client_admin',
          })
          .expect(200);

        const trail = await events(
          `membership_id = $1 AND action = 'role_changed'`,
          [membershipId],
        );
        expect(trail).toEqual([
          expect.objectContaining({
            actor_user_id: ADMIN,
            actor_surface: 'agency',
            previous_role: 'client_viewer',
            new_role: 'client_admin',
          }),
        ]);
        // The new role applies on the next request of the running session.
        const context = await clientGet(
          `/client-area/companies/${A}/context`,
          bodyOf(joined).accessToken!,
        ).expect(200);
        expect(
          (context.body as { context: { role: string } }).context.role,
        ).toBe('client_admin');
      });

      it('revoke: last membership ends the session; a second revoke is 404 and writes no second audit row', async () => {
        const { token } = await invite(email('remove'));
        const joined = await signup(token).expect(200);
        const userId = bodyOf(joined).user!.id;
        const list = await admin()
          .get(`${base(X, A)}/members`)
          .expect(200);
        const { membershipId } = bodyOf(list).members!.find(
          (member) => member.userId === userId,
        )!;

        await admin()
          .post(`${base(X, A)}/members/${membershipId}/revoke`)
          .expect(200);
        const again = await admin()
          .post(`${base(X, A)}/members/${membershipId}/revoke`)
          .expect(404);
        expect(bodyOf(again).code).toBe('client_area_membership_not_found');

        await clientGet('/client-area/me', bodyOf(joined).accessToken!).expect(
          401,
        );
        await http()
          .post('/client-area/auth/refresh')
          .send({ refreshToken: bodyOf(joined).refreshToken })
          .expect(401);
        const trail = await events(
          `membership_id = $1 AND action = 'membership_revoked'`,
          [membershipId],
        );
        expect(trail).toHaveLength(1);
        expect(trail[0].actor_user_id).toBe(ADMIN);
        // History stays visible to the Agency.
        const after = await admin()
          .get(`${base(X, A)}/members`)
          .expect(200);
        expect(
          bodyOf(after).members!.find(
            (member) => member.membershipId === membershipId,
          )?.status,
        ).toBe('revoked');
      });

      it('resend issues a new token, kills the old one and keeps the chain; a live pending blocks a new invite, an expired one is replaced', async () => {
        const address = email('reenvio');
        const first = await invite(address);
        const conflict = await admin()
          .post(`${base(X, A)}/invitations`, {
            email: address,
            role: 'client_admin',
          })
          .expect(409);
        expect(bodyOf(conflict).code).toBe('client_area_invitation_pending');

        const resent = await admin()
          .post(`${base(X, A)}/invitations/${first.invitationId}/resend`)
          .expect(200);
        const newId = bodyOf(resent).invitation!.invitationId!;
        const newToken = lastTokenFor(address, 'invitation');
        expect(newToken).not.toBe(first.token);
        await preview(first.token).expect(404);
        await preview(newToken).expect(200);
        const [old] = await db.query<
          Array<{ status: string; superseded_by_invitation_id: string }>
        >(
          'SELECT status, superseded_by_invitation_id FROM client_area_invitations WHERE id = $1',
          [first.invitationId],
        );
        expect(old).toEqual({
          status: 'revoked',
          superseded_by_invitation_id: newId,
        });
        const [resentEvent] = await events(
          `invitation_id = $1 AND action = 'invitation_resent'`,
          [newId],
        );
        expect(resentEvent.metadata).toEqual({
          previousInvitationId: first.invitationId,
        });

        await db.query(
          `UPDATE client_area_invitations SET created_at = now() - interval '8 days', expires_at = now() - interval '1 day' WHERE id = $1`,
          [newId],
        );
        const listed = await admin()
          .get(`${base(X, A)}/members`)
          .expect(200);
        expect(
          bodyOf(listed).invitations!.find(
            (entry) => entry.invitationId === newId,
          )?.expired,
        ).toBe(true);
        await invite(address, 'client_admin');
        const [replaced] = await db.query<Array<{ status: string }>>(
          'SELECT status FROM client_area_invitations WHERE id = $1',
          [newId],
        );
        expect(replaced.status).toBe('revoked');
      });

      it('feature gate off: no new invitation or resend; revoking still works', async () => {
        const pending = await invite(email('gate'));
        process.env.CLIENT_AREA_ENABLED = 'false';
        const refused = await admin()
          .post(`${base(X, A)}/invitations`, {
            email: email('gate2'),
            role: 'client_viewer',
          })
          .expect(404);
        expect(bodyOf(refused).code).toBe('client_area_disabled');
        await admin()
          .post(`${base(X, A)}/invitations/${pending.invitationId}/resend`)
          .expect(404);
        await preview(pending.token).expect(404);
        await signup(pending.token).expect(404);
        await admin()
          .post(`${base(X, A)}/invitations/${pending.invitationId}/revoke`)
          .expect(200);
        const listed = await admin()
          .get(`${base(X, A)}/members`)
          .expect(200);
        expect(
          (listed.body as { clientAreaEnabled: boolean }).clientAreaEnabled,
        ).toBe(false);
      });

      it('a failed email keeps the invitation and says so', async () => {
        sendEmail.mockRejectedValueOnce(new Error('smtp down'));
        await ensureCrmPerson(email('smtp'), A);
        const response = await admin()
          .post(`${base(X, A)}/invitations`, {
            email: email('smtp'),
            role: 'client_viewer',
          })
          .expect(201);
        expect(bodyOf(response).delivery).toBe('failed');
        const rows = await db.query<Array<unknown>>(
          `SELECT 1 FROM client_area_invitations WHERE email_normalized = $1 AND status = 'pending'`,
          [email('smtp')],
        );
        expect(rows).toHaveLength(1);
      });
    });

    describe('password reset (CA2 §35–38)', () => {
      it('only eligible identities get a Client Area link; the answer never changes', async () => {
        const before = sendEmail.mock.calls.length;
        for (const address of [
          email('admin'),
          email('ninguem'),
          email('dup'),
        ]) {
          const response = await http()
            .post('/client-area/auth/forgot-password')
            .send({ email: address })
            .expect(200);
          expect(response.body).toEqual({ success: true });
        }
        expect(sendEmail.mock.calls.length).toBe(before);

        await http()
          .post('/client-area/auth/forgot-password')
          .send({ email: email('exist') })
          .expect(200);
        const mail = sent().at(-1)!;
        expect(mail.to).toBe(email('exist'));
        expect(mail.html).toContain(
          'https://agency.example.test/client-area/reset-password?token=',
        );
      });

      it('reset: policy, single use, previous link burned, Client Area sessions revoked, surfaces never cross', async () => {
        const address = email('reset');
        const { token } = await invite(address);
        const joined = await signup(token).expect(200);

        await http()
          .post('/client-area/auth/forgot-password')
          .send({ email: address })
          .expect(200);
        const firstLink = lastTokenFor(address, 'reset');
        await http()
          .post('/client-area/auth/forgot-password')
          .send({ email: address })
          .expect(200);
        const link = lastTokenFor(address, 'reset');
        expect(link).not.toBe(firstLink);

        // A Client Area link is useless on the Agency endpoint.
        await http()
          .post('/agency/auth/reset-password')
          .send({ token: link, password: NEW_PASSWORD })
          .expect(401);

        const burned = await http()
          .post('/client-area/auth/reset-password')
          .send({
            token: firstLink,
            password: NEW_PASSWORD,
            passwordConfirmation: NEW_PASSWORD,
          })
          .expect(401);
        expect(bodyOf(burned).code).toBe('client_area_reset_token_invalid');
        const weak = await http()
          .post('/client-area/auth/reset-password')
          .send({
            token: link,
            password: 'curta',
            passwordConfirmation: 'curta',
          })
          .expect(400);
        expect(bodyOf(weak).code).toBe('client_area_password_policy');

        await http()
          .post('/client-area/auth/reset-password')
          .send({
            token: link,
            password: NEW_PASSWORD,
            passwordConfirmation: NEW_PASSWORD,
          })
          .expect(200);
        await clientGet('/client-area/me', bodyOf(joined).accessToken!).expect(
          401,
        );
        await http()
          .post('/client-area/auth/refresh')
          .send({ refreshToken: bodyOf(joined).refreshToken })
          .expect(401);
        await http()
          .post('/client-area/auth/reset-password')
          .send({
            token: link,
            password: PASSWORD,
            passwordConfirmation: PASSWORD,
          })
          .expect(401);
        await clientLogin(address).expect(401);
        await clientLogin(address, NEW_PASSWORD).expect(200);

        // An Agency reset link is useless on the Client Area endpoint.
        await http()
          .post('/agency/auth/forgot-password')
          .send({ email: email('member') })
          .expect(201);
        const agencyLink = /reset-password\?token=([0-9a-f]{64})/.exec(
          sent().at(-1)!.html,
        )![1];
        await http()
          .post('/client-area/auth/reset-password')
          .send({
            token: agencyLink,
            password: NEW_PASSWORD,
            passwordConfirmation: NEW_PASSWORD,
          })
          .expect(401);
      });

      it('an expired link fails', async () => {
        await http()
          .post('/client-area/auth/forgot-password')
          .send({ email: email('exist') })
          .expect(200);
        const link = lastTokenFor(email('exist'), 'reset');
        await db.query(
          `UPDATE password_resets SET expires_at = now() - interval '1 minute' WHERE tenant_id = $1 AND user_id = $2 AND surface = 'client_area' AND used_at IS NULL`,
          [T, EXIST],
        );
        await http()
          .post('/client-area/auth/reset-password')
          .send({
            token: link,
            password: NEW_PASSWORD,
            passwordConfirmation: NEW_PASSWORD,
          })
          .expect(401);
      });
    });

    describe('rate limits (CA2 §32–34)', () => {
      it('login is limited per IP+account whether or not the account exists; X-Forwarded-For does not mint new buckets', async () => {
        for (const address of [email('nao-existe'), email('exist')]) {
          rateLimit.reset();
          for (let attempt = 0; attempt < 10; attempt += 1) {
            await http()
              .post('/client-area/auth/login')
              .set('X-Real-IP', '203.0.113.7')
              .set('X-Forwarded-For', `198.51.100.${attempt}`)
              .send({ email: address, password: 'errada-123456' })
              .expect(401);
          }
          const limited = await http()
            .post('/client-area/auth/login')
            .set('X-Real-IP', '203.0.113.7')
            .set('X-Forwarded-For', '198.51.100.250')
            .send({ email: address, password: PASSWORD })
            .expect(429);
          expect(bodyOf(limited).code).toBe('client_area_rate_limited');
        }
        // Another origin is not locked out by this one.
        await http()
          .post('/client-area/auth/login')
          .set('X-Real-IP', '203.0.113.8')
          .send({ email: email('exist'), password: PASSWORD })
          .expect(200);
      });

      it('token guessing on the invitation endpoints is throttled', async () => {
        for (let attempt = 0; attempt < 30; attempt += 1) {
          await http()
            .post('/client-area/invitations/preview')
            .set('X-Real-IP', '203.0.113.9')
            .send({ token: randomBytes(32).toString('hex') })
            .expect(404);
        }
        await http()
          .post('/client-area/invitations/preview')
          .set('X-Real-IP', '203.0.113.9')
          .send({ token: randomBytes(32).toString('hex') })
          .expect(429);

        for (let attempt = 0; attempt < 10; attempt += 1) {
          await http()
            .post('/client-area/invitations/accept')
            .set('X-Real-IP', '203.0.113.10')
            .send({ token: randomBytes(32).toString('hex'), mode: 'signup' })
            .expect(404);
        }
        await http()
          .post('/client-area/invitations/accept')
          .set('X-Real-IP', '203.0.113.10')
          .send({ token: randomBytes(32).toString('hex'), mode: 'signup' })
          .expect(429);
      });

      it('forgot-password is limited per email and reset per IP', async () => {
        for (let attempt = 0; attempt < 5; attempt += 1) {
          await http()
            .post('/client-area/auth/forgot-password')
            .set('X-Real-IP', `203.0.113.${20 + attempt}`)
            .send({ email: email('spam') })
            .expect(200);
        }
        await http()
          .post('/client-area/auth/forgot-password')
          .set('X-Real-IP', '203.0.113.99')
          .send({ email: email('spam') })
          .expect(429);

        for (let attempt = 0; attempt < 10; attempt += 1) {
          await http()
            .post('/client-area/auth/reset-password')
            .set('X-Real-IP', '203.0.113.30')
            .send({
              token: randomBytes(32).toString('hex'),
              password: NEW_PASSWORD,
              passwordConfirmation: NEW_PASSWORD,
            })
            .expect(401);
        }
        await http()
          .post('/client-area/auth/reset-password')
          .set('X-Real-IP', '203.0.113.30')
          .send({
            token: randomBytes(32).toString('hex'),
            password: NEW_PASSWORD,
            passwordConfirmation: NEW_PASSWORD,
          })
          .expect(429);
      });
    });
  },
);
