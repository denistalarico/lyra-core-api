import {
  Controller,
  Get,
  Module,
  NotFoundException,
  Param,
  UseGuards,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import {
  getDataSourceToken,
  InjectDataSource,
  TypeOrmModule,
} from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { SettingsCryptoService } from '../../common/crypto/settings-crypto.service';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { CreateClientAreaMemberships1797000000000 } from '../../database/migrations/1797000000000-create-client-area-memberships';
import { CreateClientAreaInvitations1797100000000 } from '../../database/migrations/1797100000000-create-client-area-invitations';
import { CreateClientAreaManagement1797150000000 } from '../../database/migrations/1797150000000-create-client-area-management';
import { AddCompanyBrandIdentityFoundation1797160000000 } from '../../database/migrations/1797160000000-add-company-brand-identity-foundation';
import { CreateClientAreaCrmIdentityRelationships1797300000000 } from '../../database/migrations/1797300000000-create-client-area-crm-identity-relationships';
import { assertSafePostgresTarget } from '../../testing/postgres-integration-guard';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyAuthModule } from '../agency/agency-auth.module';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import {
  ClientAreaContextData,
  RequireClientAreaModule,
  RequireClientAreaPermission,
} from './client-area.decorators';
import { ClientAreaModule } from './client-area.module';
import { toCompanyAwareScope } from './client-area-scope';
import type { ClientAreaContext } from './client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaMembershipGuard,
} from './guards/client-area.guards';
import { ClientAreaMembershipService } from './services/client-area-membership.service';
import { ClientAreaRateLimitService } from './services/client-area-rate-limit.service';
import { TenantContextAuthority } from '../../common/context/tenant-context-authority.service';

// Same contract as otplib v13 (async, resolves `{ valid }`).
jest.mock('otplib', () => ({
  verify: jest.fn(({ token }: { token: string }) =>
    Promise.resolve({ valid: token === '424242' }),
  ),
}));

const run = describePostgresIntegration();

/** The fields these tests read from Client Area/Agency JSON responses. */
type ResponseBody = {
  accessToken: string;
  refreshToken: string;
  tempToken: string;
  code: string;
  user: unknown;
  scope: unknown;
  companies: Array<{ companyContextId: string }>;
  context: { companyContextId: string; modules: unknown };
};
const bodyOf = (response: { body: unknown }) => response.body as ResponseBody;

const PASSWORD = 'Senha-forte-CA1!';
const TOTP_CODE = '424242';
const AGENCY_SECRET = 'agency-access-secret-ca1-matrix-00000000';
const CLIENT_SECRET = 'client-area-secret-ca1-matrix-1111111111';

@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class FakeEmailModule {}

/**
 * Test-only company-bound routes: CA1 exposes no business module, so these
 * stand in for AP3 to exercise module/permission gating and "a resource id
 * never authorizes" through the real guards.
 */
@Controller('client-area/companies/:companyContextId/probe')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaMembershipGuard,
)
class ClientAreaProbeController {
  constructor(@InjectDataSource('agency') private readonly db: DataSource) {}

  @Get('decide')
  @RequireClientAreaModule('approvals')
  @RequireClientAreaPermission('client_area.approvals.decide')
  decide(@ClientAreaContextData() context: ClientAreaContext) {
    return { scope: toCompanyAwareScope(context) };
  }

  @Get('approvals/:approvalId')
  @RequireClientAreaModule('approvals')
  @RequireClientAreaPermission('client_area.approvals.view')
  async approval(
    @ClientAreaContextData() context: ClientAreaContext,
    @Param('approvalId') approvalId: string,
  ) {
    const scope = toCompanyAwareScope(context);
    const rows = await this.db.query<Array<{ id: string }>>(
      `SELECT id FROM social_approval_requests
        WHERE id = $1 AND tenant_id = $2 AND workspace_id = $3 AND agency_client_id = $4 AND company_context_id = $5`,
      [
        approvalId,
        scope.tenantId,
        scope.workspaceId,
        scope.agencyClientId,
        scope.companyContextId,
      ],
    );
    if (rows.length === 0) throw new NotFoundException();
    return { id: rows[0].id };
  }
}

run('CA1 Client Area security matrix (PostgreSQL, real guards)', () => {
  let app: INestApplication;
  let db: DataSource;
  let memberships: ClientAreaMembershipService;
  const savedEnv = { ...process.env };

  const runId = randomUUID().slice(0, 8);
  const email = (label: string) => `${label}.${runId}@ca1-spec.example.com`;

  // Tenant T / workspace W — CA0 fixture. T2 exists only for multi-tenant cases.
  const T = randomUUID(),
    W = randomUUID(),
    T2 = randomUUID(),
    W2 = randomUUID();
  const MX = randomUUID(),
    MY = randomUUID(),
    MZ = randomUUID();
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
  const U1 = randomUUID(),
    U2 = randomUUID(),
    U3 = randomUUID(),
    U4 = randomUUID();
  const U5 = randomUUID(),
    U6 = randomUUID(),
    OP = randomUUID();
  const DUP1 = randomUUID(),
    DUP2 = randomUUID(),
    MT1 = randomUUID(),
    MT2 = randomUUID();
  const SOLO = randomUUID(),
    SOLO_OTHER = randomUUID();
  const approvalB = randomUUID();
  let membershipU4 = '';
  let membershipU3B = '';

  const http = () => request(app.getHttpServer());
  const login = (address: string, password = PASSWORD) =>
    http().post('/client-area/auth/login').send({ email: address, password });
  const authed = (path: string, token: string) =>
    http().get(path).set('Authorization', `Bearer ${token}`);
  async function tokensFor(address: string) {
    const response = await login(address).expect(200);
    return response.body as { accessToken: string; refreshToken: string };
  }
  const companiesOf = async (token: string) =>
    bodyOf(
      await authed('/client-area/companies', token).expect(200),
    ).companies.map((company) => company.companyContextId);

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = AGENCY_SECRET;
    process.env.JWT_CLIENT_AREA_ACCESS_SECRET = CLIENT_SECRET;
    process.env.CLIENT_AREA_ENABLED = 'true';
    delete process.env.JWT_2FA_SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
        PassportModule,
        AgencyAuthModule,
        ClientAreaModule,
      ],
      controllers: [ClientAreaProbeController],
      providers: [JwtStrategy, TenantContextAuthority],
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
    memberships = moduleRef.get(ClientAreaMembershipService);
    const crypto = moduleRef.get(SettingsCryptoService, { strict: false });

    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await new CreateClientAreaMemberships1797000000000().up(runner);
      // CA2: revocations by an Agency actor now write audit rows.
      await new CreateClientAreaInvitations1797100000000().up(runner);
      // CA3: `client_area_settings`/`client_area_company_settings` back the
      // activation formula (`assertAgencyEnabled`/`hasIdentityAvailableCompany`)
      // every login and company-bound request already depends on.
      await new CreateClientAreaManagement1797150000000().up(runner);
      // CA3 sibling: the context/branding projection reads these columns.
      await new AddCompanyBrandIdentityFoundation1797160000000().up(runner);
      // CA4: the CRM identity chain is part of the runtime authorization
      // formula (CA4.1) — every membership exercised through a real
      // company-bound route needs an eligible CRM person behind it.
      await new CreateClientAreaCrmIdentityRelationships1797300000000().up(
        runner,
      );
    } finally {
      await runner.release();
    }

    const passwordHash = await argon2.hash(PASSWORD);
    await db.query(
      `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name,legal_name) VALUES
        ($1,$5,$6,'organization','Empresa A','Empresa A Ltda'),
        ($2,$5,$6,'organization','Empresa A2',NULL),
        ($3,$5,$6,'organization','Empresa B',NULL),
        ($4,$7,$8,'organization','Empresa C',NULL)`,
      [orgA, orgA2, orgB, orgC, T, W, T2, W2],
    );
    await db.query(
      `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name,managed_tenant_id) VALUES
        ($1,$4,$5,$7,'Rotulo interno X',$9),($2,$4,$5,$8,'Rotulo interno Y',$10),($3,$6,$11,$12,'Conta Z',$13)`,
      [X, Y, Z, T, W, T2, orgA, orgB, MX, MY, W2, orgC, MZ],
    );
    await db.query(
      `INSERT INTO agency_client_company_contexts (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES
        ($1,$5,$6,$7,$9,'active',true),($2,$5,$6,$7,$10,'active',false),
        ($3,$5,$6,$8,$11,'active',true),($4,$12,$13,$14,$15,'active',true)`,
      [A, A2, B, C, T, W, X, Y, orgA, orgA2, orgB, T2, W2, Z, orgC],
    );
    // CA3: the activation formula (`assertAgencyEnabled` at login,
    // `hasIdentityAvailableCompany`, `resolveCompanyModules`) requires an
    // enabled tenant-level row and an enabled per-company row before any
    // membership can be used.
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
    await db.query(
      `INSERT INTO tenant_product_entitlements (tenant_id,product_key,status,source) VALUES
        ($1,'social','active','manual'),($2,'social','active','manual'),($3,'social','active','manual')`,
      [MX, MY, MZ],
    );

    const identities: Array<
      [string, string, string, Partial<{ twoFactor: boolean }>]
    > = [
      [T, U1, email('u1'), {}],
      [T, U2, email('u2'), {}],
      [T, U3, email('u3'), {}],
      [T, U4, email('u4'), {}],
      [T, U5, email('u5'), { twoFactor: true }],
      [T, U6, email('u6'), {}],
      [T, OP, email('op'), {}],
      [T, DUP1, email('dup'), {}],
      [T, DUP2, email('dup'), {}],
      [T, MT1, email('multi'), {}],
      [T2, MT2, email('multi'), {}],
      [T, SOLO, email('solo'), {}],
      [T2, SOLO_OTHER, email('solo'), {}],
    ];
    for (const [tenant, user, address, options] of identities) {
      await db.query(
        `INSERT INTO user_security_settings
           (tenant_id,user_id,current_email,password_hash,two_factor_enabled,two_factor_method,two_factor_secret_encrypted,login_alerts_enabled)
         VALUES ($1,$2,$3,$4,$5,'authenticator',$6,false)`,
        [
          tenant,
          user,
          address,
          passwordHash,
          Boolean(options.twoFactor),
          options.twoFactor ? crypto.encrypt('TOTPSECRET') : null,
        ],
      );
    }
    await db.query(
      `INSERT INTO user_profile (tenant_id,user_id,display_name,email) VALUES ($1,$2,'Joana Cliente',$3)`,
      [T, U1, email('u1')],
    );
    await db.query(
      `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES ($1,$2,$3,'Operador',$4,'owner','active')`,
      [T, W, OP, email('op')],
    );

    const grant = (
      tenantId: string,
      companyContextId: string,
      userId: string,
      role: string,
    ) =>
      memberships.grant({
        tenantId,
        companyContextId,
        userId,
        role,
        grantedByUserId: tenantId === T ? OP : null,
      });
    await grant(T, A, U1, 'client_viewer');
    await grant(T, B, U2, 'client_operator');
    await grant(T, A, U3, 'client_admin');
    membershipU3B = (await grant(T, B, U3, 'client_viewer')).id;
    membershipU4 = (await grant(T, A, U4, 'client_viewer')).id;
    await grant(T, A, U5, 'client_viewer');
    await grant(T, A, DUP1, 'client_viewer');
    await grant(T, A, DUP2, 'client_viewer');
    await grant(T, A, MT1, 'client_viewer');
    await grant(T2, C, MT2, 'client_viewer');
    await grant(T, A, SOLO, 'client_viewer');

    // CA4.1 — every membership above that is actually exercised through a
    // company-bound route (guard/directory/preview) needs a live CRM chain
    // behind it: an active person Contact, linked to the company's
    // organization Contact. `grant()` itself never required this (it is
    // still the sole source of authorization); only the runtime formula
    // re-checks it on every request.
    const crmLink = async (
      tenantId: string,
      workspaceId: string,
      userId: string,
      address: string,
      organizationContactId: string,
    ) => {
      const [{ id: personContactId }] = await db.query<Array<{ id: string }>>(
        `INSERT INTO contacts (tenant_id,workspace_id,type,display_name)
         VALUES ($1,$2,'person',$3) RETURNING id`,
        [tenantId, workspaceId, address],
      );
      await db.query(
        `INSERT INTO contact_methods (tenant_id,workspace_id,contact_id,type,value,is_primary)
         VALUES ($1,$2,$3,'email',$4,true)`,
        [tenantId, workspaceId, personContactId, address],
      );
      await db.query(
        `INSERT INTO contact_company_links
           (tenant_id,workspace_id,person_contact_id,company_contact_id,status,linked_at,is_primary)
         VALUES ($1,$2,$3,$4,'active',now(),false)`,
        [tenantId, workspaceId, personContactId, organizationContactId],
      );
      await db.query(
        `INSERT INTO client_area_identity_contacts
           (tenant_id,workspace_id,user_id,contact_id,status,linked_at)
         VALUES ($1,$2,$3,$4,'active',now())`,
        [tenantId, workspaceId, userId, personContactId],
      );
      return personContactId;
    };
    // U1: only company A (org orgA). U2: only company B (orgB). U3: both A
    // and B — one identity, two eligible companies. U4/U5: company A only.
    await crmLink(T, W, U1, email('u1'), orgA);
    await crmLink(T, W, U2, email('u2'), orgB);
    const orgFor: Record<string, string> = { [A]: orgA, [B]: orgB };
    const u3ContactId = await crmLink(T, W, U3, email('u3'), orgFor[A]);
    await db.query(
      `INSERT INTO contact_company_links
         (tenant_id,workspace_id,person_contact_id,company_contact_id,status,linked_at,is_primary)
       VALUES ($1,$2,$3,$4,'active',now(),false)`,
      [T, W, u3ContactId, orgFor[B]],
    );
    await crmLink(T, W, U4, email('u4'), orgA);
    await crmLink(T, W, U5, email('u5'), orgA);

    await db.query(
      `INSERT INTO social_approval_requests (id,tenant_id,workspace_id,agency_client_id,company_context_id,subject_type,subject_id,subject_revision_id,source_module,display_type,title,subject_version_label,status,current_stage,requested_by_user_id)
       VALUES ($1,$2,$3,$4,$5,'creative_version',$6,$7,'creative_studio','creative','Peça B','v1','awaiting_client','client',$8)`,
      [approvalB, T, W, Y, B, randomUUID(), randomUUID(), OP],
    );
  }, 60_000);

  // CA2 rate limits are per process; each case starts with fresh counters.
  beforeEach(() => app.get(ClientAreaRateLimitService).reset());

  afterAll(async () => {
    try {
      if (db?.isInitialized) {
        assertSafePostgresTarget();
        const tenants = [T, T2];
        for (const table of [
          'client_area_member_events',
          'client_area_invitations',
          'client_area_identity_contacts',
          'contact_company_links',
          'contact_methods',
          'client_area_memberships',
          'client_area_company_settings',
          'client_area_settings',
          'social_approval_requests',
          'user_sessions',
          'user_login_events',
          'auth_email_2fa_codes',
          'user_trusted_devices',
          'user_security_settings',
          'user_profile',
          'workspace_users',
          'agency_client_company_contexts',
          'agency_clients',
          'contacts',
        ]) {
          await db.query(
            `DELETE FROM ${table} WHERE tenant_id = ANY($1::uuid[])`,
            [tenants],
          );
        }
        await db.query(
          `DELETE FROM tenant_product_entitlements WHERE tenant_id = ANY($1::uuid[])`,
          [[MX, MY, MZ]],
        );
      }
    } finally {
      await app?.close();
      process.env = { ...savedEnv };
    }
  });

  describe('authentication', () => {
    it('logs a client in with its own session surface and a typed token', async () => {
      const response = await login(email('u1')).expect(200);
      expect(bodyOf(response).user).toEqual({
        id: U1,
        email: email('u1'),
        displayName: 'Joana Cliente',
      });
      const [session] = await db.query<
        Array<{ surface: string; status: string }>
      >(
        `SELECT surface, status FROM user_sessions WHERE tenant_id = $1 AND user_id = $2 ORDER BY created_at DESC LIMIT 1`,
        [T, U1],
      );
      expect(session).toEqual({ surface: 'client_area', status: 'active' });
      const payload = JSON.parse(
        Buffer.from(
          bodyOf(response).accessToken.split('.')[1],
          'base64url',
        ).toString(),
      ) as Record<string, unknown>;
      expect(payload).toMatchObject({
        sub: U1,
        tenantId: T,
        typ: 'client_area',
      });
      expect(payload).not.toHaveProperty('role');
      expect(payload).not.toHaveProperty('workspaceId');
      expect(payload).not.toHaveProperty('companyContextId');

      const me = await authed(
        '/client-area/me',
        bodyOf(response).accessToken,
      ).expect(200);
      // Kept exhaustive on purpose: this is the assertion that proves the
      // projection carries nothing extra (no tenant/workspace/client ids).
      // PD3 added `hasAgencySelfContext`, and `false` is the correct value —
      // U1 is an external client person, never an Agency operator.
      expect(me.body).toEqual({
        user: { id: U1, email: email('u1'), displayName: 'Joana Cliente' },
        activeMembershipCount: 1,
        hasAgencySelfContext: false,
      });
    });

    it('wrong password → 401 with a client_area login_failed event (not Agency)', async () => {
      const response = await login(email('u1'), 'errada-123').expect(401);
      expect(bodyOf(response).code).toBe('client_area_invalid_credentials');
      const events = await db.query<Array<{ surface: string }>>(
        `SELECT surface FROM user_login_events WHERE tenant_id = $1 AND user_id = $2 AND event_type = 'login_failed'`,
        [T, U1],
      );
      expect(events.map((event) => event.surface)).toEqual(['client_area']);
    });

    it('identity without membership → 401', async () => {
      await login(email('u6')).expect(401);
    });

    it('Agency workspace user → 401 on client login', async () => {
      await login(email('op')).expect(401);
    });

    it('two eligible identities with the same email in one tenant → 409 ambiguous (only after a correct password)', async () => {
      const response = await login(email('dup')).expect(409);
      expect(bodyOf(response).code).toBe('client_area_account_ambiguous');
      await login(email('dup'), 'errada-123').expect(401);
    });

    it('same email/password with memberships in two tenants → 409 ambiguous', async () => {
      const response = await login(email('multi')).expect(409);
      expect(bodyOf(response).code).toBe('client_area_account_ambiguous');
    });

    it('same email in another tenant WITHOUT membership does not create ambiguity', async () => {
      await login(email('solo')).expect(200);
    });

    it('email is matched case-insensitively', async () => {
      await login(email('u1').toUpperCase()).expect(200);
    });

    it('2FA identity: challenge token is not an access token; wrong code 401; right code logs in', async () => {
      const challenge = await login(email('u5')).expect(200);
      expect(challenge.body).toMatchObject({
        requiresTwoFactor: true,
        method: 'authenticator',
      });
      expect(bodyOf(challenge).accessToken).toBeUndefined();
      await authed('/client-area/me', bodyOf(challenge).tempToken).expect(401);
      await http()
        .post('/client-area/auth/2fa/login')
        .send({ token: bodyOf(challenge).tempToken, code: '000000' })
        .expect(401);
      const done = await http()
        .post('/client-area/auth/2fa/login')
        .send({ token: bodyOf(challenge).tempToken, code: TOTP_CODE })
        .expect(200);
      await authed('/client-area/me', bodyOf(done).accessToken).expect(200);
    });

    it('refresh rotates the refresh token; the previous one stops working', async () => {
      const first = await tokensFor(email('u1'));
      const refreshed = await http()
        .post('/client-area/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(200);
      expect(bodyOf(refreshed).refreshToken).not.toBe(first.refreshToken);
      await http()
        .post('/client-area/auth/refresh')
        .send({ refreshToken: first.refreshToken })
        .expect(401);
      await authed('/client-area/me', bodyOf(refreshed).accessToken).expect(
        200,
      );
    });

    it('logout revokes the session: refresh and the still-signed access token both fail', async () => {
      const session = await tokensFor(email('u1'));
      await http()
        .post('/client-area/auth/logout')
        .send({ refreshToken: session.refreshToken })
        .expect(200);
      await http()
        .post('/client-area/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await authed('/client-area/me', session.accessToken).expect(401);
    });
  });

  describe('CA0 §AF matrix', () => {
    it('#1 U1 lists only A (display name from the organization, never the Agency label)', async () => {
      const { accessToken } = await tokensFor(email('u1'));
      const response = await authed(
        '/client-area/companies',
        accessToken,
      ).expect(200);
      expect(bodyOf(response).companies).toEqual([
        {
          companyContextId: A,
          displayName: 'Empresa A',
          role: 'client_viewer',
        },
      ]);
      expect(JSON.stringify(response.body)).not.toContain('Rotulo interno');
    });

    it('#2/#5 U1 cannot reach B nor A2 (same tenant, same Agency Client) — generic 404', async () => {
      const { accessToken } = await tokensFor(email('u1'));
      for (const company of [B, A2, C, randomUUID(), 'not-a-uuid']) {
        const response = await authed(
          `/client-area/companies/${company}/context`,
          accessToken,
        ).expect(404);
        expect(bodyOf(response).code).toBe('client_area_company_not_found');
      }
    });

    it('#3 U2 cannot reach A', async () => {
      const { accessToken } = await tokensFor(email('u2'));
      await authed(`/client-area/companies/${A}/context`, accessToken).expect(
        404,
      );
      expect(await companiesOf(accessToken)).toEqual([B]);
    });

    it('#4 U3 alternates A↔B with the right context each request', async () => {
      const { accessToken } = await tokensFor(email('u3'));
      expect((await companiesOf(accessToken)).sort()).toEqual([A, B].sort());
      const contextA = await authed(
        `/client-area/companies/${A}/context`,
        accessToken,
      ).expect(200);
      // PD2 §22 — same class of stale assertion as #11, diagnosed here: this
      // exhaustive `toEqual` predates CCOM1, which legitimately added the
      // `conversations` module and its two permissions to the projection. The
      // behaviour under test (U3 alternating A↔B with the right context) was
      // never broken; the expectation simply did not know about the new
      // module. Kept exhaustive on purpose, because this case is also what
      // proves the projection carries nothing extra.
      expect(bodyOf(contextA).context).toEqual({
        companyContextId: A,
        displayName: 'Empresa A',
        role: 'client_admin',
        permissions: [
          'client_area.approvals.comment',
          'client_area.approvals.decide',
          'client_area.approvals.view',
          'client_area.conversations.send',
          'client_area.conversations.view',
          // PD4 — the role preset is shared by both kinds of context, so an
          // external client's projection lists this key too. It grants
          // nothing here: the only route that reads it also requires
          // `ClientAreaSelfContextGuard`, which answers 404 for anyone
          // without active self access. Asserted rather than filtered,
          // because hiding it per context would mean the projection no longer
          // reports the preset the server actually resolved.
          'client_area.self.overview.view',
        ],
        modules: { approvals: true, conversations: false },
        branding: {
          displayName: 'Lyra',
          logoLightUrl: null,
          logoDarkUrl: null,
          markLightUrl: null,
          markDarkUrl: null,
          faviconUrl: null,
          primaryColor: null,
          secondaryColor: null,
          login: {
            layout: 'centered',
            heading: null,
            supportingText: null,
            backgroundColor: null,
          },
        },
      });
      const contextB = await authed(
        `/client-area/companies/${B}/context`,
        accessToken,
      ).expect(200);
      expect(bodyOf(contextB).context).toMatchObject({
        companyContextId: B,
        role: 'client_viewer',
      });
      // Projection carries no internal ids.
      for (const internal of [T, W, X, Y, MX, MY]) {
        expect(JSON.stringify(contextA.body)).not.toContain(internal);
      }
    });

    it('#6 an approval of B requested through A’s path is 404; through B it resolves', async () => {
      const { accessToken } = await tokensFor(email('u3'));
      await authed(
        `/client-area/companies/${A}/probe/approvals/${approvalB}`,
        accessToken,
      ).expect(404);
      await authed(
        `/client-area/companies/${B}/probe/approvals/${approvalB}`,
        accessToken,
      ).expect(200);
    });

    it('#7 company ids forged in headers are ignored', async () => {
      const { accessToken } = await tokensFor(email('u1'));
      const response = await authed(
        `/client-area/companies/${A}/context`,
        accessToken,
      )
        .set('x-lyra-company-context-id', B)
        .set('x-lyra-client-context-id', Y)
        .set('x-tenant-id', T2)
        .set('x-user-id', U2)
        .expect(200);
      expect(bodyOf(response).context.companyContextId).toBe(A);
      const list = await authed('/client-area/companies', accessToken)
        .set('x-lyra-company-context-id', B)
        .expect(200);
      expect(
        bodyOf(list).companies.map(
          (company: { companyContextId: string }) => company.companyContextId,
        ),
      ).toEqual([A]);
    });

    it('#8 / §57 U4 loses the last membership: the still-valid access token fails on the next request', async () => {
      const session = await tokensFor(email('u4'));
      await authed('/client-area/me', session.accessToken).expect(200);
      await memberships.revoke({
        tenantId: T,
        membershipId: membershipU4,
        revokedByUserId: OP,
      });
      await authed('/client-area/me', session.accessToken).expect(401);
      await http()
        .post('/client-area/auth/refresh')
        .send({ refreshToken: session.refreshToken })
        .expect(401);
      await login(email('u4')).expect(401);
      const [row] = await db.query<
        Array<{ status: string; revoked: boolean; revoked_by_user_id: string }>
      >(
        `SELECT status, revoked_at IS NOT NULL AS revoked, revoked_by_user_id FROM client_area_memberships WHERE id = $1`,
        [membershipU4],
      );
      expect(row).toEqual({
        status: 'revoked',
        revoked: true,
        revoked_by_user_id: OP,
      });
    });

    it('#8b revoking one of several memberships blocks that company at once and keeps the session', async () => {
      const session = await tokensFor(email('u3'));
      await authed(
        `/client-area/companies/${B}/context`,
        session.accessToken,
      ).expect(200);
      await memberships.revoke({
        tenantId: T,
        membershipId: membershipU3B,
        revokedByUserId: OP,
      });
      await authed(
        `/client-area/companies/${B}/context`,
        session.accessToken,
      ).expect(404);
      await authed(
        `/client-area/companies/${A}/context`,
        session.accessToken,
      ).expect(200);
      expect(await companiesOf(session.accessToken)).toEqual([A]);
      membershipU3B = (
        await memberships.grant({
          tenantId: T,
          companyContextId: B,
          userId: U3,
          role: 'client_viewer',
          grantedByUserId: OP,
        })
      ).id;
      await authed(
        `/client-area/companies/${B}/context`,
        session.accessToken,
      ).expect(200);
    });

    it('#9 Company A inactive or its organization archived → disappears and fails', async () => {
      const { accessToken } = await tokensFor(email('u1'));
      await db.query(
        `UPDATE agency_client_company_contexts SET status = 'inactive' WHERE id = $1`,
        [A],
      );
      try {
        expect(await companiesOf(accessToken)).toEqual([]);
        await authed(`/client-area/companies/${A}/context`, accessToken).expect(
          404,
        );
      } finally {
        await db.query(
          `UPDATE agency_client_company_contexts SET status = 'active' WHERE id = $1`,
          [A],
        );
      }
      await db.query(`UPDATE contacts SET status = 'archived' WHERE id = $1`, [
        orgA,
      ]);
      try {
        expect(await companiesOf(accessToken)).toEqual([]);
        await authed(`/client-area/companies/${A}/context`, accessToken).expect(
          404,
        );
      } finally {
        await db.query(`UPDATE contacts SET status = 'active' WHERE id = $1`, [
          orgA,
        ]);
      }
      await authed(`/client-area/companies/${A}/context`, accessToken).expect(
        200,
      );
    });

    it('#10 Agency Client X archived → A fails, B (client Y) still works', async () => {
      const { accessToken } = await tokensFor(email('u3'));
      await db.query(
        `UPDATE agency_clients SET archived_at = now() WHERE id = $1`,
        [X],
      );
      try {
        await authed(`/client-area/companies/${A}/context`, accessToken).expect(
          404,
        );
        await authed(`/client-area/companies/${B}/context`, accessToken).expect(
          200,
        );
        expect(await companiesOf(accessToken)).toEqual([B]);
      } finally {
        await db.query(
          `UPDATE agency_clients SET archived_at = NULL WHERE id = $1`,
          [X],
        );
      }
    });

    it('#11 Social entitlement of the managed tenant expired → modules.approvals=false and approvals routes 403', async () => {
      const { accessToken } = await tokensFor(email('u3'));
      await db.query(
        `UPDATE tenant_product_entitlements SET ends_at = now() - interval '1 day' WHERE tenant_id = $1`,
        [MX],
      );
      try {
        const context = await authed(
          `/client-area/companies/${A}/context`,
          accessToken,
        ).expect(200);
        // PD2 §22 — stale assertion, not a product change: CCOM1 added
        // `conversations` beside `approvals`, so a whole-object `toEqual` with
        // one key started failing while the behaviour under test (an expired
        // Social entitlement closes approvals) stayed correct. Asserting the
        // approvals contract keeps the test about its own subject and lets a
        // later module be added without reopening it.
        expect(bodyOf(context).context.modules).toMatchObject({
          approvals: false,
        });
        const probe = await authed(
          `/client-area/companies/${A}/probe/decide`,
          accessToken,
        ).expect(403);
        expect(bodyOf(probe).code).toBe('client_area_module_unavailable');
      } finally {
        await db.query(
          `UPDATE tenant_product_entitlements SET ends_at = NULL WHERE tenant_id = $1`,
          [MX],
        );
      }
      await authed(
        `/client-area/companies/${A}/probe/decide`,
        accessToken,
      ).expect(200);
    });

    it('#12 Client Area token on an Agency route (JwtAuthGuard) → 401', async () => {
      const { accessToken } = await tokensFor(email('u1'));
      await authed('/agency/auth/me', accessToken).expect(401);
    });

    it('#13 Agency token on Client Area routes → 401', async () => {
      const agency = await http()
        .post('/agency/auth/login')
        .send({ email: email('op'), password: PASSWORD })
        .expect(201);
      await authed('/agency/auth/me', bodyOf(agency).accessToken).expect(200);
      await authed('/client-area/me', bodyOf(agency).accessToken).expect(401);
      await authed(
        `/client-area/companies/${A}/context`,
        bodyOf(agency).accessToken,
      ).expect(401);
    });

    it('#14 a client identity cannot log into the Agency', async () => {
      await http()
        .post('/agency/auth/login')
        .send({ email: email('u1'), password: PASSWORD })
        .expect(401);
    });

    it('#15 refresh tokens do not cross surfaces (and Agency logout cannot end a client session)', async () => {
      const client = await tokensFor(email('u1'));
      const agency = await http()
        .post('/agency/auth/login')
        .send({ email: email('op'), password: PASSWORD })
        .expect(201);

      await http()
        .post('/agency/auth/refresh')
        .send({ refreshToken: client.refreshToken })
        .expect(401);
      await http()
        .post('/client-area/auth/refresh')
        .send({ refreshToken: bodyOf(agency).refreshToken })
        .expect(401);

      await http()
        .post('/agency/auth/logout')
        .send({ refreshToken: client.refreshToken })
        .expect(201);
      await http()
        .post('/client-area/auth/logout')
        .send({ refreshToken: bodyOf(agency).refreshToken })
        .expect(200);
      // Both sessions survived the other surface's logout.
      const clientRefreshed = await http()
        .post('/client-area/auth/refresh')
        .send({ refreshToken: client.refreshToken })
        .expect(200);
      await http()
        .post('/agency/auth/refresh')
        .send({ refreshToken: bodyOf(agency).refreshToken })
        .expect(201);
      await authed(
        '/client-area/me',
        bodyOf(clientRefreshed).accessToken,
      ).expect(200);
    });

    it('#16 an Agency operator cannot receive a membership (no Owner exception)', async () => {
      await expect(
        memberships.grant({
          tenantId: T,
          companyContextId: A,
          userId: OP,
          role: 'client_admin',
          grantedByUserId: OP,
        }),
      ).rejects.toMatchObject({
        response: { code: 'client_area_identity_is_agency_operator' },
      });
    });

    it('#17 kill switch off → every Client Area route fails, including login and refresh', async () => {
      const session = await tokensFor(email('u1'));
      process.env.CLIENT_AREA_ENABLED = 'false';
      try {
        await login(email('u1')).expect(404);
        await http()
          .post('/client-area/auth/refresh')
          .send({ refreshToken: session.refreshToken })
          .expect(404);
        await authed('/client-area/me', session.accessToken).expect(404);
        await authed('/client-area/companies', session.accessToken).expect(404);
        await authed(
          `/client-area/companies/${A}/context`,
          session.accessToken,
        ).expect(404);
      } finally {
        process.env.CLIENT_AREA_ENABLED = 'true';
      }
      await authed('/client-area/me', session.accessToken).expect(200);
    });

    it('#18 viewer cannot decide (403); operator and admin can', async () => {
      const viewer = await tokensFor(email('u1'));
      const denied = await authed(
        `/client-area/companies/${A}/probe/decide`,
        viewer.accessToken,
      ).expect(403);
      expect(bodyOf(denied).code).toBe('client_area_permission_denied');

      const operator = await tokensFor(email('u2'));
      const allowed = await authed(
        `/client-area/companies/${B}/probe/decide`,
        operator.accessToken,
      ).expect(200);
      expect(bodyOf(allowed).scope).toEqual({
        tenantId: T,
        workspaceId: W,
        agencyClientId: Y,
        companyContextId: B,
      });

      const admin = await tokensFor(email('u3'));
      await authed(
        `/client-area/companies/${A}/probe/decide`,
        admin.accessToken,
      ).expect(200);
    });

    it('an identity that becomes an Agency operator loses the Client Area on the next request', async () => {
      const session = await tokensFor(email('u2'));
      await db.query(
        `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES ($1,$2,$3,'Virou operador',$4,'member','active')`,
        [T, W, U2, email('u2')],
      );
      try {
        await authed('/client-area/me', session.accessToken).expect(401);
        await login(email('u2')).expect(401);
      } finally {
        await db.query(
          `DELETE FROM workspace_users WHERE tenant_id = $1 AND user_id = $2`,
          [T, U2],
        );
      }
    });
  });

  describe('membership service', () => {
    it('rejects Agency role names, duplicates, foreign identities and inactive companies', async () => {
      await expect(
        memberships.grant({
          tenantId: T,
          companyContextId: A2,
          userId: U1,
          role: 'admin',
          grantedByUserId: OP,
        }),
      ).rejects.toMatchObject({
        response: { code: 'client_area_role_invalid' },
      });
      await expect(
        memberships.grant({
          tenantId: T,
          companyContextId: A,
          userId: U1,
          role: 'client_viewer',
          grantedByUserId: OP,
        }),
      ).rejects.toMatchObject({
        response: { code: 'client_area_membership_exists' },
      });
      await expect(
        memberships.grant({
          tenantId: T,
          companyContextId: A2,
          userId: MT2,
          role: 'client_viewer',
          grantedByUserId: OP,
        }),
      ).rejects.toMatchObject({
        response: { code: 'client_area_identity_not_found' },
      });
      await expect(
        memberships.grant({
          tenantId: T,
          companyContextId: C,
          userId: U1,
          role: 'client_viewer',
          grantedByUserId: null,
        }),
      ).rejects.toMatchObject({
        response: { code: 'client_area_company_unavailable' },
      });
      await expect(
        memberships.grant({
          tenantId: T,
          companyContextId: A2,
          userId: U1,
          role: 'client_viewer',
          grantedByUserId: U2,
        }),
      ).rejects.toMatchObject({
        response: { code: 'client_area_grantor_invalid' },
      });

      await db.query(
        `UPDATE agency_client_company_contexts SET status = 'archived', is_primary = false, archived_at = now() WHERE id = $1`,
        [A2],
      );
      try {
        await expect(
          memberships.grant({
            tenantId: T,
            companyContextId: A2,
            userId: U1,
            role: 'client_viewer',
            grantedByUserId: OP,
          }),
        ).rejects.toMatchObject({
          response: { code: 'client_area_company_unavailable' },
        });
      } finally {
        await db.query(
          `UPDATE agency_client_company_contexts SET status = 'active', archived_at = NULL WHERE id = $1`,
          [A2],
        );
      }
    });

    it('revoke never deletes, is not repeatable, and a re-grant creates a new row', async () => {
      const granted = await memberships.grant({
        tenantId: T,
        companyContextId: A2,
        userId: U6,
        role: 'client_viewer',
        grantedByUserId: OP,
      });
      expect((await memberships.listForUser(T, U6)).map((m) => m.id)).toEqual([
        granted.id,
      ]);
      await memberships.revoke({
        tenantId: T,
        membershipId: granted.id,
        revokedByUserId: OP,
      });
      await expect(
        memberships.revoke({
          tenantId: T,
          membershipId: granted.id,
          revokedByUserId: OP,
        }),
      ).rejects.toMatchObject({
        response: { code: 'client_area_membership_not_found' },
      });
      expect(await memberships.listForUser(T, U6)).toEqual([]);
      const regrant = await memberships.grant({
        tenantId: T,
        companyContextId: A2,
        userId: U6,
        role: 'client_operator',
        grantedByUserId: OP,
      });
      expect(regrant.id).not.toBe(granted.id);
      const rows = await db.query<Array<{ status: string }>>(
        `SELECT status FROM client_area_memberships WHERE user_id = $1 AND company_context_id = $2`,
        [U6, A2],
      );
      expect(rows.map((row) => row.status).sort()).toEqual([
        'active',
        'revoked',
      ]);
    });
  });
});
