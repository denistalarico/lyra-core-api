import {
  Controller,
  Get,
  Module,
  UseGuards,
  ValidationPipe,
  type INestApplication,
} from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
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
import { CreateClientAreaAgencySelfAccess1797700000000 } from '../../database/migrations/1797700000000-create-client-area-agency-self-access';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyAuthModule } from '../agency/agency-auth.module';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { ClientAreaModule } from './client-area.module';
import { ClientAreaSelfContextData } from './client-area.decorators';
import {
  CLIENT_AREA_ERROR_CODES,
  type ClientAreaSelfContext,
} from './client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaSelfContextGuard,
} from './guards/client-area.guards';
import { ClientAreaMembershipService } from './services/client-area-membership.service';
import { ClientAreaSelfAccessService } from './services/client-area-self-access.service';

jest.mock('otplib', () => ({
  verify: jest.fn(({ token }: { token: string }) =>
    Promise.resolve({ valid: token === '424242' }),
  ),
}));

const run = describePostgresIntegration();

const PASSWORD = 'Senha-forte-PD3!';
const AGENCY_SECRET = 'agency-access-secret-pd3-matrix-000000000';
const CLIENT_SECRET = 'client-area-secret-pd3-matrix-11111111111';

@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class FakeEmailModule {}

/** Test-only self-context route: PD3 exposes no business module in the self. */
@Controller('client-area/self/probe')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaSelfContextGuard,
)
class SelfProbeController {
  @Get()
  self(@ClientAreaSelfContextData() context: ClientAreaSelfContext) {
    // Returned verbatim so the test can assert no company scope leaks.
    return { context: { ...context, permissions: [...context.permissions] } };
  }
}

run('PD3 agency self-context security matrix (PostgreSQL, real guards)', () => {
  let app: INestApplication;
  let db: DataSource;
  let selfAccess: ClientAreaSelfAccessService;
  let memberships: ClientAreaMembershipService;
  const savedEnv = { ...process.env };

  const runId = randomUUID().slice(0, 8);
  const email = (label: string) => `${label}.${runId}@pd3-spec.example.com`;

  // Tenant T / workspace W = the agency. T2/W2 is a second agency, used to
  // prove a self-context can never cross a tenant boundary.
  const T = randomUUID(),
    W = randomUUID(),
    T2 = randomUUID(),
    W2 = randomUUID();
  const MX = randomUUID();
  const orgA = randomUUID();
  const X = randomUUID();
  const A = randomUUID();
  // OWNER/ADMIN: eligible Agency operators. MANAGER: ineligible role.
  // CLIENT: an external client person (no workspace_users).
  const OWNER = randomUUID(),
    ADMIN = randomUUID(),
    MANAGER = randomUUID(),
    OWNER2 = randomUUID(),
    CLIENT = randomUUID();

  const http = () => request(app.getHttpServer());
  const login = (address: string) =>
    http()
      .post('/client-area/auth/login')
      .send({ email: address, password: PASSWORD });
  const authed = (path: string, token: string) =>
    http().get(path).set('Authorization', `Bearer ${token}`);
  async function clientTokens(address: string) {
    const response = await login(address).expect(200);
    return response.body as { accessToken: string; refreshToken: string };
  }
  const scope = { tenantId: T, workspaceId: W };

  const enableSelf = (enabled: boolean) =>
    selfAccess.setSelfEnabled(scope, enabled, OWNER);

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
      controllers: [SelfProbeController],
      providers: [JwtStrategy],
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
    selfAccess = moduleRef.get(ClientAreaSelfAccessService);
    memberships = moduleRef.get(ClientAreaMembershipService);
    const crypto = moduleRef.get(SettingsCryptoService, { strict: false });

    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await new CreateClientAreaMemberships1797000000000().up(runner);
      await new CreateClientAreaInvitations1797100000000().up(runner);
      await new CreateClientAreaManagement1797150000000().up(runner);
      await new AddCompanyBrandIdentityFoundation1797160000000().up(runner);
      await new CreateClientAreaCrmIdentityRelationships1797300000000().up(
        runner,
      );
      await new CreateClientAreaAgencySelfAccess1797700000000().up(runner);
    } finally {
      await runner.release();
    }

    const passwordHash = await argon2.hash(PASSWORD);

    await db.query(
      `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name) VALUES ($1,$2,$3,'organization','Empresa A')`,
      [orgA, T, W],
    );
    await db.query(
      `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name,managed_tenant_id) VALUES ($1,$2,$3,$4,'Cliente X',$5)`,
      [X, T, W, orgA, MX],
    );
    await db.query(
      `INSERT INTO agency_client_company_contexts (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES ($1,$2,$3,$4,$5,'active',true)`,
      [A, T, W, X, orgA],
    );
    await db.query(
      `INSERT INTO client_area_settings (tenant_id,workspace_id,enabled) VALUES ($1,$2,true),($3,$4,true)`,
      [T, W, T2, W2],
    );
    await db.query(
      `INSERT INTO client_area_company_settings (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,approvals_enabled) VALUES ($1,$2,$3,$4,true,true)`,
      [T, W, X, A],
    );
    await db.query(
      `INSERT INTO tenant_product_entitlements (tenant_id,product_key,status,source) VALUES ($1,'social','active','manual')`,
      [MX],
    );
    await db.query(
      `INSERT INTO workspace_company_settings (tenant_id,workspace_id,trade_name,workspace_name) VALUES ($1,$2,'Agência Lyra','Agência Lyra')`,
      [T, W],
    );

    for (const [tenant, user, address] of [
      [T, OWNER, email('owner')],
      [T, ADMIN, email('admin')],
      [T, MANAGER, email('manager')],
      [T, CLIENT, email('client')],
      [T2, OWNER2, email('owner2')],
    ] as Array<[string, string, string]>) {
      await db.query(
        `INSERT INTO user_security_settings
           (tenant_id,user_id,current_email,password_hash,two_factor_enabled,two_factor_method,two_factor_secret_encrypted,login_alerts_enabled)
         VALUES ($1,$2,$3,$4,false,'authenticator',NULL,false)`,
        [tenant, user, address, passwordHash],
      );
    }
    // A 2FA-enabled Owner proves the self login honours the identity's 2FA.
    await db.query(
      `UPDATE user_security_settings
         SET two_factor_enabled = true, two_factor_secret_encrypted = $3
       WHERE tenant_id = $1 AND user_id = $2`,
      [T, ADMIN, crypto.encrypt('TOTPSECRET')],
    );

    await db.query(
      `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES
         ($1,$2,$3,'Owner',$4,'owner','active'),
         ($1,$2,$5,'Admin',$6,'admin','active'),
         ($1,$2,$7,'Manager',$8,'manager','active'),
         ($9,$10,$11,'Owner 2',$12,'owner','active')`,
      [
        T,
        W,
        OWNER,
        email('owner'),
        ADMIN,
        email('admin'),
        MANAGER,
        email('manager'),
        T2,
        W2,
        OWNER2,
        email('owner2'),
      ],
    );
  }, 180_000);

  afterAll(async () => {
    if (app) {
      await db.query(
        `DELETE FROM client_area_self_access_events WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(
        `DELETE FROM client_area_self_access WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(`DELETE FROM user_sessions WHERE tenant_id = ANY($1)`, [
        [T, T2],
      ]);
      await db.query(
        `DELETE FROM user_login_events WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(`DELETE FROM workspace_users WHERE tenant_id = ANY($1)`, [
        [T, T2],
      ]);
      await db.query(
        `DELETE FROM user_security_settings WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(
        `DELETE FROM workspace_company_settings WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(
        `DELETE FROM tenant_product_entitlements WHERE tenant_id = $1`,
        [MX],
      );
      await db.query(
        `DELETE FROM client_area_member_events WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(
        `DELETE FROM client_area_memberships WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(
        `DELETE FROM client_area_identity_contacts WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(
        `DELETE FROM contact_company_links WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(
        `DELETE FROM client_area_company_settings WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(
        `DELETE FROM client_area_settings WHERE tenant_id = ANY($1)`,
        [[T, T2]],
      );
      await db.query(
        `DELETE FROM agency_client_company_contexts WHERE tenant_id = $1`,
        [T],
      );
      await db.query(`DELETE FROM agency_clients WHERE tenant_id = $1`, [T]);
      await db.query(`DELETE FROM contacts WHERE tenant_id = ANY($1)`, [
        [T, T2],
      ]);
      await app.close();
    }
    process.env = { ...savedEnv };
  });

  beforeEach(async () => {
    // Every case starts from "self area off, nobody has access".
    await db.query(
      `DELETE FROM client_area_self_access WHERE tenant_id = ANY($1)`,
      [[T, T2]],
    );
    await db.query(
      `DELETE FROM client_area_member_events WHERE tenant_id = ANY($1)`,
      [[T, T2]],
    );
    await db.query(
      `DELETE FROM client_area_memberships WHERE tenant_id = ANY($1)`,
      [[T, T2]],
    );
    await db.query(
      `DELETE FROM client_area_identity_contacts WHERE tenant_id = ANY($1)`,
      [[T, T2]],
    );
    await db.query(
      `UPDATE client_area_settings SET self_enabled = false WHERE tenant_id = ANY($1)`,
      [[T, T2]],
    );
    await db.query(
      `UPDATE user_sessions SET status='expired', revoked_at=now() WHERE tenant_id = ANY($1) AND revoked_at IS NULL`,
      [[T, T2]],
    );
  });

  // ------------------------------------------------------------------ §19/§36

  it('keeps the external membership prohibition for an Agency operator, with and without self access (§19, §36)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });

    // The exception is ONLY for agency_self. An Owner with self access still
    // cannot become a member of an external Company Context.
    await expect(
      memberships.grant({
        tenantId: T,
        companyContextId: A,
        userId: OWNER,
        role: 'client_admin',
        grantedByUserId: OWNER,
      }),
    ).rejects.toMatchObject({
      response: {
        statusCode: 409,
        code: CLIENT_AREA_ERROR_CODES.identityIsAgencyOperator,
      },
    });

    // And the same for a Manager, who is not even self-eligible.
    await expect(
      memberships.grant({
        tenantId: T,
        companyContextId: A,
        userId: MANAGER,
        role: 'client_viewer',
        grantedByUserId: OWNER,
      }),
    ).rejects.toMatchObject({
      response: { code: CLIENT_AREA_ERROR_CODES.identityIsAgencyOperator },
    });
  });

  // -------------------------------------------------------------------- §20

  it('refuses Client Area login for an Agency operator while self access is disabled (§20, §28)', async () => {
    // Self area off entirely.
    await login(email('owner')).expect(401);

    // Self area on, but this person has no access row.
    await enableSelf(true);
    const refused = await login(email('owner')).expect(401);
    expect((refused.body as { code: string }).code).toBe(
      CLIENT_AREA_ERROR_CODES.invalidCredentials,
    );
    // §28 — the generic credentials error, never "you are an Agency operator
    // but self is not active".
    expect(JSON.stringify(refused.body)).not.toMatch(/operator|self|agency/i);
  });

  it('lets an eligible Owner log in and resolve the self-context once enabled (§20)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });

    const { accessToken } = await clientTokens(email('owner'));
    const body = (
      await authed('/client-area/self/probe', accessToken).expect(200)
    ).body as { context: Record<string, unknown> };

    expect(body.context.kind).toBe('agency_self');
    expect(body.context.role).toBe('client_admin');
    expect(body.context.agencyDisplayName).toBe('Agência Lyra');
    // §15 — no module is available in the self-context V1.
    expect(body.context.modules).toEqual({
      approvals: false,
      conversations: false,
    });
    // §18 — no invented company scope ever reaches a handler.
    expect(body.context).not.toHaveProperty('agencyClientId');
    expect(body.context).not.toHaveProperty('companyContextId');
    expect(body.context).not.toHaveProperty('membershipId');
    expect(body.context).not.toHaveProperty('managedTenantId');
  });

  it('refuses self access for an ineligible Agency role and for an external client (§12, §20)', async () => {
    await enableSelf(true);

    // Manager is not in SELF_ACCESS_ELIGIBLE_AGENCY_ROLES.
    await expect(
      selfAccess.grant({ scope, userId: MANAGER, grantedByUserId: OWNER }),
    ).rejects.toMatchObject({
      response: { code: CLIENT_AREA_ERROR_CODES.selfIdentityNotOperator },
    });

    // An external client person is not an Agency operator at all: the
    // self-context is not a way for a client to reach the agency.
    await expect(
      selfAccess.grant({ scope, userId: CLIENT, grantedByUserId: OWNER }),
    ).rejects.toMatchObject({
      response: { code: CLIENT_AREA_ERROR_CODES.selfIdentityNotOperator },
    });
  });

  it('honours the identity 2FA on the self login, with no Owner/Admin bypass (§9)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: ADMIN, grantedByUserId: OWNER });

    const challenge = await login(email('admin')).expect(200);
    const { requiresTwoFactor, tempToken } = challenge.body as {
      requiresTwoFactor: boolean;
      tempToken: string;
    };
    expect(requiresTwoFactor).toBe(true);

    // A wrong code is refused: being Admin grants no bypass.
    await http()
      .post('/client-area/auth/2fa/login')
      .send({ token: tempToken, code: '000000' })
      .expect(401);

    const ok = await http()
      .post('/client-area/auth/2fa/login')
      .send({ token: tempToken, code: '424242' })
      .expect(200);
    expect((ok.body as { accessToken?: string }).accessToken).toBeTruthy();
  });

  // -------------------------------------------------------------------- §21

  it('isolates the two surfaces in both directions and keeps both sessions alive (§21 cases 1,2,8,9,10)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });

    // Case 8 — the same userId holds an Agency session and a Client session.
    const agencyLogin = await http()
      .post('/agency/auth/login')
      .send({ email: email('owner'), password: PASSWORD })
      .expect(201);
    const agency = agencyLogin.body as {
      accessToken: string;
      refreshToken: string;
    };
    const client = await clientTokens(email('owner'));

    // Case 1 — Agency JWT on a Client Area self route.
    await authed('/client-area/self/probe', agency.accessToken).expect(401);
    // Case 2 — Client self JWT on an Agency route.
    await authed('/agency/auth/me', client.accessToken).expect(401);

    // Case 9 — logging out of the Client Area leaves the Agency session usable.
    await http()
      .post('/client-area/auth/logout')
      .send({ refreshToken: client.refreshToken })
      .expect(({ status }) => expect([200, 201]).toContain(status));
    await authed('/agency/auth/me', agency.accessToken).expect(200);

    // Case 10 — logging out of the Agency leaves the Client session usable.
    const client2 = await clientTokens(email('owner'));
    await http()
      .post('/agency/auth/logout')
      .send({ refreshToken: agency.refreshToken })
      .set('Authorization', `Bearer ${agency.accessToken}`)
      .expect(({ status }) => expect([200, 201, 204]).toContain(status));
    await authed('/client-area/self/probe', client2.accessToken).expect(200);
  });

  it('fails closed for an external client reaching the self-context and a self token reaching a company (§21 cases 3,4)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });

    // Case 4 — a self holder has no membership, so every Company Context
    // answers the generic 404. The self-context grants no company at all.
    const { accessToken } = await clientTokens(email('owner'));
    const companyResponse = await authed(
      `/client-area/companies/${A}/context`,
      accessToken,
    ).expect(404);
    expect((companyResponse.body as { code: string }).code).toBe(
      CLIENT_AREA_ERROR_CODES.companyNotFound,
    );
    // The directory confirms it: zero companies, one self entry.
    const directory = (
      await authed('/client-area/contexts', accessToken).expect(200)
    ).body as { contexts: Array<{ kind: string }> };
    expect(directory.contexts.map((entry) => entry.kind)).toEqual([
      'agency_self',
    ]);

    // Case 3 — an external client token on the self route: fail-closed 404.
    await memberships.grant({
      tenantId: T,
      companyContextId: A,
      userId: CLIENT,
      role: 'client_viewer',
      grantedByUserId: null,
    });
    await crmChain(CLIENT, email('client'));
    const clientTokenSet = await clientTokens(email('client'));
    const refused = await authed(
      '/client-area/self/probe',
      clientTokenSet.accessToken,
    ).expect(404);
    expect((refused.body as { code: string }).code).toBe(
      CLIENT_AREA_ERROR_CODES.selfContextNotFound,
    );
  });

  it('forged context ids fail closed (§21 case 7)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    const { accessToken } = await clientTokens(email('owner'));

    // `agency_self` is a fixed path segment, never a company id: feeding it
    // to the company route must not resolve anything.
    for (const forged of [
      'agency_self',
      '00000000-0000-0000-0000-000000000000',
      'not-a-uuid',
    ]) {
      await authed(
        `/client-area/companies/${forged}/context`,
        accessToken,
      ).expect(404);
    }
  });

  it('cannot reach the self-context of another tenant (§21 case 6, §33)', async () => {
    // The agency T enables its own self area; the Owner of T2 must not gain
    // anything from it, and T's management routes are scoped to T's token.
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });

    // T2's owner has no self access of its own: login refused.
    await login(email('owner2')).expect(401);

    // A grant pointed at T's workspace for a user of T2 is refused: the
    // target is not an operator of that workspace.
    await expect(
      selfAccess.grant({ scope, userId: OWNER2, grantedByUserId: OWNER }),
    ).rejects.toMatchObject({
      response: { code: CLIENT_AREA_ERROR_CODES.selfIdentityNotOperator },
    });
  });

  // ---------------------------------------------------------------- §22, §5

  it('revoking one self access ends only that person Client Area sessions (§22)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    await selfAccess.grant({ scope, userId: ADMIN, grantedByUserId: OWNER });

    const agencyLogin = await http()
      .post('/agency/auth/login')
      .send({ email: email('owner'), password: PASSWORD })
      .expect(201);
    const agency = agencyLogin.body as { accessToken: string };
    const owner = await clientTokens(email('owner'));

    await authed('/client-area/self/probe', owner.accessToken).expect(200);

    await selfAccess.revoke({ scope, userId: OWNER, revokedByUserId: OWNER });

    // The Client Area session is dead on the very next request...
    await authed('/client-area/self/probe', owner.accessToken).expect(401);
    // ...the refresh is refused...
    await http()
      .post('/client-area/auth/refresh')
      .send({ refreshToken: owner.refreshToken })
      .expect(401);
    // ...and the Agency session is untouched.
    await authed('/agency/auth/me', agency.accessToken).expect(200);
  });

  it('disabling the self area revokes the self Client sessions but no Agency session (§22)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });

    const agencyLogin = await http()
      .post('/agency/auth/login')
      .send({ email: email('owner'), password: PASSWORD })
      .expect(201);
    const agency = agencyLogin.body as { accessToken: string };
    const client = await clientTokens(email('owner'));
    await authed('/client-area/self/probe', client.accessToken).expect(200);

    await enableSelf(false);

    await authed('/client-area/self/probe', client.accessToken).expect(401);
    await http()
      .post('/client-area/auth/refresh')
      .send({ refreshToken: client.refreshToken })
      .expect(401);
    await authed('/agency/auth/me', agency.accessToken).expect(200);
    // And login is closed again while the area is off.
    await login(email('owner')).expect(401);
  });

  it('losing the eligible Agency role closes the self-context on the next request (§5)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: ADMIN, grantedByUserId: OWNER });
    // Admin has 2FA; go through the challenge to get a session.
    const challenge = await login(email('admin')).expect(200);
    const authenticated = await http()
      .post('/client-area/auth/2fa/login')
      .send({
        token: (challenge.body as { tempToken: string }).tempToken,
        code: '424242',
      })
      .expect(200);
    const token = (authenticated.body as { accessToken: string }).accessToken;
    await authed('/client-area/self/probe', token).expect(200);

    // Demoted to Manager: still an Agency operator, no longer self-eligible.
    await db.query(
      `UPDATE workspace_users SET role = 'manager' WHERE tenant_id = $1 AND user_id = $2`,
      [T, ADMIN],
    );
    try {
      await authed('/client-area/self/probe', token).expect(401);
    } finally {
      await db.query(
        `UPDATE workspace_users SET role = 'admin' WHERE tenant_id = $1 AND user_id = $2`,
        [T, ADMIN],
      );
    }
  });

  // ---------------------------------------------------------------- §11, §29

  it('grants without an invitation, is idempotent-safe, and writes an audit trail (§11, §29)', async () => {
    await enableSelf(true);
    // §11 — no invitation row is created for a self grant.
    const before = await db.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM client_area_invitations WHERE tenant_id = $1`,
      [T],
    );
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    const after = await db.query<Array<{ count: string }>>(
      `SELECT count(*)::text AS count FROM client_area_invitations WHERE tenant_id = $1`,
      [T],
    );
    expect(after[0].count).toBe(before[0].count);

    // A second grant for the same person conflicts rather than duplicating.
    await expect(
      selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER }),
    ).rejects.toMatchObject({
      response: { code: CLIENT_AREA_ERROR_CODES.selfAccessExists },
    });

    await selfAccess.changeRole({
      scope,
      userId: OWNER,
      role: 'client_viewer',
      actorUserId: OWNER,
    });
    await selfAccess.revoke({ scope, userId: OWNER, revokedByUserId: OWNER });

    const events = await db.query<
      Array<{ action: string; actor_user_id: string; target_user_id: string }>
    >(
      `SELECT action, actor_user_id, target_user_id FROM client_area_self_access_events
        WHERE tenant_id = $1 ORDER BY created_at, action`,
      [T],
    );
    const actions = events.map((event) => event.action);
    expect(actions).toContain('self_area_enabled');
    expect(actions).toContain('self_access_granted');
    expect(actions).toContain('self_access_role_changed');
    expect(actions).toContain('self_access_revoked');
    // The actor is the Agency operator who performed it; no secret is stored.
    for (const event of events) {
      if (event.target_user_id) expect(event.actor_user_id).toBe(OWNER);
    }
  });

  it('cannot enable the self area while the Client Area itself is off (§14)', async () => {
    await db.query(
      `UPDATE client_area_settings SET enabled = false WHERE tenant_id = $1 AND workspace_id = $2`,
      [T, W],
    );
    try {
      await expect(enableSelf(true)).rejects.toMatchObject({
        response: { statusCode: 409 },
      });
    } finally {
      await db.query(
        `UPDATE client_area_settings SET enabled = true WHERE tenant_id = $1 AND workspace_id = $2`,
        [T, W],
      );
    }
  });

  it('the overview lists only eligible Agency users and no internal ids (§13, §31)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });

    const overview = await selfAccess.overview(scope);
    expect(overview.selfEnabled).toBe(true);
    expect(overview.activeAccessCount).toBe(1);
    // Manager is an active operator but is not offered.
    const roles = overview.users.map((user) => user.agencyRole).sort();
    expect(roles).toEqual(['admin', 'owner']);
    expect(
      overview.users.find((user) => user.userId === OWNER)?.hasSelfAccess,
    ).toBe(true);
    expect(
      overview.users.find((user) => user.userId === ADMIN)?.hasSelfAccess,
    ).toBe(false);
    // §15 — honest about modules.
    expect(overview.modules).toEqual({
      approvals: false,
      conversations: false,
    });
  });

  /** CA4 chain for an external client person, so their membership resolves. */
  async function crmChain(userId: string, address: string) {
    const [{ id: personContactId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO contacts (tenant_id,workspace_id,type,display_name,status)
       VALUES ($1,$2,'person',$3,'active') RETURNING id`,
      [T, W, address],
    );
    await db.query(
      `INSERT INTO contact_company_links
         (tenant_id,workspace_id,person_contact_id,company_contact_id,status,linked_at,is_primary)
       VALUES ($1,$2,$3,$4,'active',now(),false)`,
      [T, W, personContactId, orgA],
    );
    await db.query(
      `INSERT INTO client_area_identity_contacts
         (tenant_id,workspace_id,user_id,contact_id,status,linked_at)
       VALUES ($1,$2,$3,$4,'active',now())`,
      [T, W, userId, personContactId],
    );
  }
});
