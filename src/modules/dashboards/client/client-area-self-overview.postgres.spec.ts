import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { getAgencyTypeOrmConfig } from '../../../config/typeorm.config';
import { CreateClientAreaMemberships1797000000000 } from '../../../database/migrations/1797000000000-create-client-area-memberships';
import { CreateClientAreaInvitations1797100000000 } from '../../../database/migrations/1797100000000-create-client-area-invitations';
import { CreateClientAreaManagement1797150000000 } from '../../../database/migrations/1797150000000-create-client-area-management';
import { AddCompanyBrandIdentityFoundation1797160000000 } from '../../../database/migrations/1797160000000-add-company-brand-identity-foundation';
import { CreateClientAreaCrmIdentityRelationships1797300000000 } from '../../../database/migrations/1797300000000-create-client-area-crm-identity-relationships';
import { CreateClientAreaAgencySelfAccess1797700000000 } from '../../../database/migrations/1797700000000-create-client-area-agency-self-access';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { AgencyAuthModule } from '../../agency/agency-auth.module';
import { JwtStrategy } from '../../auth/strategies/jwt.strategy';
import { ClientAreaModule } from '../../client-area/client-area.module';
import { CLIENT_AREA_ERROR_CODES } from '../../client-area/client-area.types';
import { ClientAreaMembershipService } from '../../client-area/services/client-area-membership.service';
import { ClientAreaSelfAccessService } from '../../client-area/services/client-area-self-access.service';
import { EmailModule } from '../../email/email.module';
import { EmailService } from '../../email/email.service';
import { AgencyDashboardsService } from '../services/agency-dashboards.service';
import { ClientAreaSelfOverviewController } from './client-area-self-overview.controller';
import { ClientAreaSelfOverviewService } from './client-area-self-overview.service';
import { TenantContextAuthority } from '../../../common/context/tenant-context-authority.service';

jest.mock('otplib', () => ({
  verify: jest.fn(({ token }: { token: string }) =>
    Promise.resolve({ valid: token === '424242' }),
  ),
}));

const run = describePostgresIntegration();

const PASSWORD = 'Senha-forte-PD4!';
const AGENCY_SECRET = 'agency-access-secret-pd4-matrix-000000000';
const CLIENT_SECRET = 'client-area-secret-pd4-matrix-11111111111';

@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class FakeEmailModule {}

/**
 * PD4 §40 — the security matrix of `GET /client-area/self/overview`.
 *
 * Runs against the **real** route, the real guards and a real database, so
 * what is proven is the wiring and not a mock of it. The one thing stubbed is
 * `AgencyDashboardsService`: this spec is about who may read the overview and
 * what the body may contain, and importing the whole Agency domain graph
 * (Finance, Projects, Clients, Activities, Team, Calendar, Platform and their
 * migrations) to answer those questions would test the dashboard instead.
 * The stub also lets the spec record the scope the projection asked for,
 * which is the §20 proof: the caller cannot influence it.
 */
run('PD4 self overview security matrix (PostgreSQL, real guards)', () => {
  let app: INestApplication;
  let db: DataSource;
  let selfAccess: ClientAreaSelfAccessService;
  let memberships: ClientAreaMembershipService;
  const savedEnv = { ...process.env };

  const runId = randomUUID().slice(0, 8);
  const email = (label: string) => `${label}.${runId}@pd4-spec.example.com`;

  const T = randomUUID(),
    W = randomUUID(),
    T2 = randomUUID(),
    W2 = randomUUID();
  const MX = randomUUID();
  const orgA = randomUUID();
  const X = randomUUID();
  const A = randomUUID();
  const OWNER = randomUUID(),
    ADMIN = randomUUID(),
    MANAGER = randomUUID(),
    OWNER2 = randomUUID(),
    CLIENT = randomUUID();

  /** Every scope the projection asked the canonical source for. */
  const requestedScopes: Array<Record<string, unknown>> = [];

  const dashboardStub = {
    getOverview: jest.fn((context: Record<string, unknown>) => {
      requestedScopes.push(context);
      return Promise.resolve({
        generatedAt: '2026-10-03T00:00:00.000Z',
        product: {
          key: 'agency',
          moduleKey: 'agency.dashboard',
          entitlementStatus: 'active',
        },
        context: {
          tenantId: context.tenantId,
          workspaceId: context.workspaceId,
          accountType: 'agency',
          accountStatus: 'active',
          accountDisplayName: 'Agência Lyra',
          managedTenantId: null,
          agencyClientId: null,
        },
        user: { id: context.userId, role: context.role, preset: 'executive' },
        access: {
          canViewDashboard: true,
          canViewFinance: true,
          canViewProfitability: true,
          canViewCommercial: true,
          canViewTeam: true,
          canViewPortfolio: true,
          canViewCrossProductSignals: true,
          canManageLayout: true,
        },
        greeting: { attentionCount: 0, messageKey: 'dashboard.stable' },
        priorities: [
          {
            id: 'project-overdue:proj-leak',
            type: 'overdue_project',
            severity: 'critical',
            title: 'Projeto atrasado',
            description: 'Projeto interno secreto',
            sourceModule: 'projects',
            href: '/projects/proj-leak',
            entityId: 'proj-leak',
            dueAt: null,
            score: 120,
          },
          {
            id: 'finance-overdue-receivables',
            type: 'overdue_receivables',
            severity: 'critical',
            title: 'Existem recebimentos vencidos',
            description: 'BRL 1000.00 em aberto e vencido.',
            sourceModule: 'finance',
            href: '/finance/invoices?status=overdue',
            entityId: 'finance-overdue-receivables',
            dueAt: null,
            score: 150,
          },
        ],
        widgets: {
          projects: null,
          finance: {
            currency: 'BRL',
            period: { type: 'monthly', start: '2026-10-01', end: '2026-10-31' },
            status: 'ok',
            metrics: {
              mrr: 1,
              revenueIssued: 1000,
              revenueReceived: 500,
              openReceivables: 500,
              overdueReceivables: 1000,
              defaultRate: 1,
              averageTicket: 1000,
              fixedCosts: 300,
              variableCosts: 200,
              grossMargin: 0.8,
              netMargin: 0.5,
              breakEvenPoint: 375,
              activeContracts: 1,
            },
            counts: {
              invoices: 1,
              monthInvoices: 1,
              bills: 1,
              monthBills: 1,
              recurringProfiles: 0,
              activeRecurringProfiles: 0,
            },
          },
          profitability: null,
          clients: null,
          sales: null,
          activities: null,
          calendar: null,
          team: null,
        },
        opportunities: {
          trends: { status: 'pending_integration', markets: ['BR'], items: [] },
          dates: { status: 'pending_integration', markets: ['BR'], items: [] },
          dailyTip: { status: 'pending_integration', item: null },
        },
        partialFailures: [],
      });
    }),
  };

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

  const OVERVIEW = '/client-area/self/overview';

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
      controllers: [ClientAreaSelfOverviewController],
      providers: [
        JwtStrategy,
        TenantContextAuthority,
        ClientAreaSelfOverviewService,
        { provide: AgencyDashboardsService, useValue: dashboardStub },
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
    selfAccess = moduleRef.get(ClientAreaSelfAccessService);
    memberships = moduleRef.get(ClientAreaMembershipService);

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
      for (const [table, column] of [
        ['client_area_self_access_events', 'tenant_id'],
        ['client_area_self_access', 'tenant_id'],
        ['user_sessions', 'tenant_id'],
        ['user_login_events', 'tenant_id'],
        ['workspace_users', 'tenant_id'],
        ['user_security_settings', 'tenant_id'],
        ['workspace_company_settings', 'tenant_id'],
        ['client_area_member_events', 'tenant_id'],
        ['client_area_memberships', 'tenant_id'],
        ['client_area_identity_contacts', 'tenant_id'],
        ['contact_company_links', 'tenant_id'],
        ['client_area_company_settings', 'tenant_id'],
        ['client_area_settings', 'tenant_id'],
      ] as Array<[string, string]>) {
        await db.query(`DELETE FROM ${table} WHERE ${column} = ANY($1)`, [
          [T, T2],
        ]);
      }
      await db.query(
        `DELETE FROM tenant_product_entitlements WHERE tenant_id = $1`,
        [MX],
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
    requestedScopes.length = 0;
    dashboardStub.getOverview.mockClear();
    await db.query(
      `DELETE FROM client_area_self_access WHERE tenant_id = ANY($1)`,
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

  // ------------------------------------------------------------------- case 1

  it('serves the overview to an authorized self holder (case 1)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    const { accessToken } = await clientTokens(email('owner'));

    const response = await authed(OVERVIEW, accessToken).expect(200);
    const body = response.body as Record<string, unknown>;

    expect(body.agencyDisplayName).toBe('Agência Lyra');
    expect(body.period).toEqual({
      type: 'current_month',
      start: '2026-10-01',
      end: '2026-10-31',
    });
    expect(body.finance).toMatchObject({ status: 'ok', currency: 'BRL' });
  });

  it('derives the scope from the self access row, ignoring anything the caller sends (§20)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    const { accessToken } = await clientTokens(email('owner'));

    // Forged scope on every channel a caller controls: query string and the
    // headers the Agency surface reads. None of them is read here.
    await http()
      .get(OVERVIEW)
      .query({
        tenantId: T2,
        workspaceId: W2,
        clientId: X,
        companyContextId: A,
      })
      .set('Authorization', `Bearer ${accessToken}`)
      .set('x-tenant-id', T2)
      .set('x-workspace-id', W2)
      .set('x-user-id', OWNER2)
      .set('x-lyra-company-context-id', A)
      .expect(200);

    expect(requestedScopes).toHaveLength(1);
    expect(requestedScopes[0]).toEqual({
      tenantId: T,
      workspaceId: W,
      userId: OWNER,
      role: 'owner',
    });
  });

  // ------------------------------------------------------------------- case 2

  it('fails closed once the self area is disabled (case 2, case 8)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    const { accessToken } = await clientTokens(email('owner'));
    await authed(OVERVIEW, accessToken).expect(200);

    // Disabling revokes the Client Area sessions, so the very next request
    // with the same token is refused — before the projection is reached.
    await enableSelf(false);
    await authed(OVERVIEW, accessToken).expect(401);
    expect(dashboardStub.getOverview).toHaveBeenCalledTimes(1);
  });

  it('fails closed on the request after the self access is revoked (case 8)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    const { accessToken } = await clientTokens(email('owner'));
    await authed(OVERVIEW, accessToken).expect(200);

    await selfAccess.revoke({ scope, userId: OWNER, revokedByUserId: OWNER });
    await authed(OVERVIEW, accessToken).expect(401);
  });

  // ------------------------------------------------------------------- case 3

  it('refuses an external client with the generic 404 (case 3)', async () => {
    await enableSelf(true);
    await memberships.grant({
      tenantId: T,
      companyContextId: A,
      userId: CLIENT,
      role: 'client_admin',
      grantedByUserId: null,
    });
    await crmChain(CLIENT, email('client'));

    const { accessToken } = await clientTokens(email('client'));
    const refused = await authed(OVERVIEW, accessToken).expect(404);

    expect((refused.body as { code: string }).code).toBe(
      CLIENT_AREA_ERROR_CODES.selfContextNotFound,
    );
    // The projection was never reached: no canonical query ran for a client.
    expect(dashboardStub.getOverview).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------- case 4

  it('refuses an Agency token with 401 (case 4)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });

    const agencyLogin = await http()
      .post('/agency/auth/login')
      .send({ email: email('owner'), password: PASSWORD })
      .expect(201);
    const agency = agencyLogin.body as { accessToken: string };

    // A valid Agency JWT is signed with a different secret and carries no
    // `typ='client_area'`: it cannot authenticate on this surface at all.
    await authed(OVERVIEW, agency.accessToken).expect(401);
    expect(dashboardStub.getOverview).not.toHaveBeenCalled();
  });

  // ------------------------------------------------------------------- case 5

  it('cannot be reached with a token of another tenant (case 5, §34)', async () => {
    // T enables its self area and grants its Owner. T2's Owner has no self
    // access, so it cannot even obtain a Client Area token.
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });

    await login(email('owner2')).expect(401);

    // And when T2 enables its own self area, its Owner reads T2's scope only.
    await db.query(
      `UPDATE client_area_settings SET self_enabled = true WHERE tenant_id = $1`,
      [T2],
    );
    await selfAccess.grant({
      scope: { tenantId: T2, workspaceId: W2 },
      userId: OWNER2,
      grantedByUserId: OWNER2,
    });
    const { accessToken } = await clientTokens(email('owner2'));
    await authed(OVERVIEW, accessToken).expect(200);

    expect(requestedScopes).toEqual([
      { tenantId: T2, workspaceId: W2, userId: OWNER2, role: 'owner' },
    ]);
  });

  // ------------------------------------------------------------------- case 7

  it('refuses a Manager without self access, and an ineligible grant (case 7)', async () => {
    await enableSelf(true);

    // A Manager cannot be granted self access at all (PD3 §12).
    await expect(
      selfAccess.grant({ scope, userId: MANAGER, grantedByUserId: OWNER }),
    ).rejects.toMatchObject({
      response: { code: CLIENT_AREA_ERROR_CODES.selfIdentityNotOperator },
    });

    // With no access row, the Manager cannot log into the Client Area.
    await login(email('manager')).expect(401);
  });

  it('closes the overview when an Admin is demoted, with no row revoked (§5)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: ADMIN, grantedByUserId: OWNER });
    const { accessToken } = await clientTokens(email('admin'));
    await authed(OVERVIEW, accessToken).expect(200);

    await db.query(
      `UPDATE workspace_users SET role = 'manager' WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3`,
      [T, W, ADMIN],
    );
    try {
      // The access row is still 'active'; eligibility is what changed.
      const refused = await authed(OVERVIEW, accessToken).expect(401);
      expect(refused.body).toBeDefined();
    } finally {
      await db.query(
        `UPDATE workspace_users SET role = 'admin' WHERE tenant_id = $1 AND workspace_id = $2 AND user_id = $3`,
        [T, W, ADMIN],
      );
    }
  });

  // ------------------------------------------------------------- §21 payload

  it('never serializes an internal id, an Agency route or operational detail (§21, §37)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    const { accessToken } = await clientTokens(email('owner'));

    const response = await authed(OVERVIEW, accessToken).expect(200);
    const serialized = JSON.stringify(response.body);

    for (const forbidden of [T, W, OWNER, X, A, MX, orgA]) {
      expect(serialized).not.toContain(forbidden);
    }
    for (const key of [
      'tenantId',
      'workspaceId',
      'userId',
      'sessionId',
      'selfAccessId',
      'agencyClientId',
      'companyContextId',
      'managedTenantId',
      'agencyRole',
      'membershipId',
      'href',
      'entityId',
    ]) {
      expect(serialized).not.toContain(key);
    }
    // The project-sourced alert was dropped with its id, route and title.
    expect(serialized).not.toContain('proj-leak');
    expect(serialized).not.toContain('Projeto interno secreto');
    expect(serialized).not.toContain('/projects/');
    // The aggregate finance alert survived.
    expect(serialized).toContain('recebimentos vencidos');
  });

  it('exposes no company context and no module route in the self surface (§20, §29)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    const { accessToken } = await clientTokens(email('owner'));

    const body = (await authed(OVERVIEW, accessToken).expect(200))
      .body as Record<string, unknown>;

    expect(Object.keys(body).sort()).toEqual([
      'agencyDisplayName',
      'alerts',
      'clients',
      'finance',
      'generatedAt',
      'operations',
      'period',
      'profitability',
    ]);

    // Approvals and Conversations remain unreachable in the self-context.
    await authed('/client-area/self/context', accessToken)
      .expect(200)
      .then((response) => {
        const context = (response.body as { context: Record<string, unknown> })
          .context;
        expect(context.modules).toEqual({
          approvals: false,
          conversations: false,
        });
      });
  });

  it('a slice that is unavailable is not a zero (§7, §23)', async () => {
    await enableSelf(true);
    await selfAccess.grant({ scope, userId: OWNER, grantedByUserId: OWNER });
    const { accessToken } = await clientTokens(email('owner'));

    const body = (await authed(OVERVIEW, accessToken).expect(200))
      .body as Record<string, { status: string; reason?: string }>;

    // The stub returns no clients/profitability/operations widget and reports
    // no failure, which is "not available for this reader", never 0.
    expect(body.clients).toEqual({
      status: 'unavailable',
      reason: 'not_available',
    });
    expect(body.profitability).toEqual({
      status: 'unavailable',
      reason: 'not_available',
    });
    // Finance answered, so one failing domain does not take the page down.
    expect(body.finance.status).toBe('ok');
  });

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
