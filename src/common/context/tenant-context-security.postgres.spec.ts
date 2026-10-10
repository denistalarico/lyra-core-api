import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtModule, JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { FilesService } from '../files/files.service';
import {
  getAgencyTypeOrmConfig,
  getTypeOrmConfig,
} from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { ActivitiesModule } from '../../modules/activities/activities.module';
import { JwtStrategy } from '../../modules/auth/strategies/jwt.strategy';
import { CalendarModule } from '../../modules/calendar/calendar.module';
import { FinanceModule } from '../../modules/finance/finance.module';
import { KnowledgeModule } from '../../modules/knowledge/knowledge.module';
import { PlatformModule } from '../../modules/platform/platform.module';
import { ProjectsModule } from '../../modules/projects/projects.module';
import { TeamChatModule } from '../../modules/team-chat/team-chat.module';
import { TenantContextAuthority } from './tenant-context-authority.service';

// `otplib` v13 ships ESM that Jest's CommonJS transform cannot load; nothing
// here exercises 2FA, tokens are signed directly.
jest.mock('otplib', () => ({
  verify: jest.fn(() => Promise.resolve({ valid: false })),
}));

const run = describePostgresIntegration();

const SECRET = 'sec-a1-tenant-context-integrity-secret-01';

/**
 * SEC-A1 — tenant/workspace context integrity, end to end.
 *
 * The CS6 closeout reproduced it with reads only: a valid JWT of tenant B, sent
 * with `x-tenant-id`/`x-workspace-id` of tenant A, got 200 and A's real data
 * from Finance. Agency controllers read the context from those headers and
 * nobody compared them with the token.
 *
 * Every request here goes through the real `JwtStrategy`, `JwtAuthGuard`,
 * `PermissionsGuard` and the real controllers/services against PostgreSQL.
 * Tenant A writes its data through its own API first, so each "200" row of the
 * matrix is also proof that the legitimate path still works.
 */
run('SEC-A1 tenant/workspace context integrity (PostgreSQL)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;

  const TA = randomUUID();
  const WA = randomUUID();
  const WA2 = randomUUID(); // second workspace of A: OWNER_A is NOT a member
  const TB = randomUUID();
  const WB = randomUUID();
  const MT_X = randomUUID(); // managed tenant of A's client X

  const OWNER_A = randomUUID();
  const MEMBER_A = randomUUID();
  const REMOVED_A = randomUUID(); // membership exists but is inactive
  const OWNER_B = randomUUID();

  const ORG_X = randomUUID();
  const ORG_Y = randomUUID();
  const ORG_B = randomUUID();
  const CLIENT_X = randomUUID();
  const CLIENT_Y = randomUUID();
  const CLIENT_B = randomUUID();
  const COMPANY_X = randomUUID();
  const COMPANY_Y = randomUUID();

  const MARKER = `sec-a1-${randomUUID().slice(0, 8)}`;
  const TENANTS = [TA, TB, MT_X];

  const http = () =>
    request(app.getHttpServer() as Parameters<typeof request>[0]);

  const tokenFor = (
    userId: string,
    tenantId: string,
    workspaceId: string,
    role: string,
  ) =>
    jwt.sign(
      {
        sub: userId,
        tenantId,
        workspaceId,
        role,
        sessionId: randomUUID(),
        email: `${userId.slice(0, 8)}@sec-a1.example.com`,
      },
      { secret: SECRET, expiresIn: '15m' },
    );

  let ownerA = '';
  let memberA = '';
  let removedA = '';
  let ownerB = '';
  let ownerAInWa2 = '';

  /** The exact headers the Agency frontend sends for a session. */
  const sessionHeaders = (
    tenantId: string,
    workspaceId: string,
    userId: string,
    role: string,
  ) => ({
    'x-tenant-id': tenantId,
    'x-workspace-id': workspaceId,
    'x-user-id': userId,
    'x-user-role': role,
  });

  const get = (
    path: string,
    token: string | null,
    headers: Record<string, string> = {},
  ) => {
    const req = http().get(path).set(headers);
    return token ? req.set('Authorization', `Bearer ${token}`) : req;
  };

  /** One readable surface per legacy header-based module. */
  const MODULE_READS: Array<{ module: string; path: string }> = [
    { module: 'Finance', path: '/agency/finance/cost-centers' },
    { module: 'Projects', path: '/agency/projects' },
    { module: 'Knowledge', path: '/agency/knowledge/categories' },
    {
      module: 'Calendar',
      path: `/calendar/events?startsAt=${new Date(Date.now() - 86_400_000).toISOString()}&endsAt=${new Date(Date.now() + 30 * 86_400_000).toISOString()}`,
    },
    { module: 'Team Chat', path: '/agency/team-chat/channels' },
    { module: 'Activities', path: '/agency/activities' },
  ];

  const insertMembership = (
    tenantId: string,
    workspaceId: string,
    userId: string,
    role: string,
    status = 'active',
  ) =>
    db.query(
      `INSERT INTO workspace_users (tenant_id, workspace_id, user_id, name, email, role, status)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [
        tenantId,
        workspaceId,
        userId,
        `user ${userId.slice(0, 8)}`,
        `${userId}@sec-a1.example.com`,
        role,
        status,
      ],
    );

  /**
   * Deletes every row of the fixture tenants, in every table that has a
   * `tenant_id`. Retries in passes so foreign keys resolve themselves without a
   * hand-kept order; scoped to this spec's random tenants only.
   */
  const deleteFixtureTenants = async () => {
    const tables: Array<{ table_name: string }> = await db.query(
      `SELECT table_name FROM information_schema.columns
        WHERE table_schema = 'public' AND column_name = 'tenant_id'`,
    );
    let pending = tables.map((row) => row.table_name);
    for (let pass = 0; pass < 8 && pending.length > 0; pass += 1) {
      const failed: string[] = [];
      for (const table of pending) {
        const runner = db.createQueryRunner();
        await runner.connect();
        try {
          await runner.query(
            `DELETE FROM "${table}" WHERE tenant_id = ANY($1::uuid[])`,
            [TENANTS],
          );
        } catch {
          failed.push(table);
        } finally {
          await runner.release();
        }
      }
      pending = failed;
    }
  };

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        TypeOrmModule.forRoot(getTypeOrmConfig()),
        TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
        PassportModule,
        JwtModule.register({}),
        FinanceModule,
        ProjectsModule,
        KnowledgeModule,
        CalendarModule,
        TeamChatModule,
        ActivitiesModule,
        PlatformModule,
      ],
      providers: [JwtStrategy, TenantContextAuthority],
    })
      .overrideProvider(FilesService)
      .useValue({})
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
    jwt = moduleRef.get(JwtService, { strict: false });

    await deleteFixtureTenants();

    await insertMembership(TA, WA, OWNER_A, 'owner');
    await insertMembership(TA, WA, MEMBER_A, 'member');
    await insertMembership(TA, WA, REMOVED_A, 'owner', 'inactive');
    await insertMembership(TB, WB, OWNER_B, 'owner');

    ownerA = tokenFor(OWNER_A, TA, WA, 'owner');
    memberA = tokenFor(MEMBER_A, TA, WA, 'member');
    removedA = tokenFor(REMOVED_A, TA, WA, 'owner');
    ownerB = tokenFor(OWNER_B, TB, WB, 'owner');
    ownerAInWa2 = tokenFor(OWNER_A, TA, WA2, 'owner');

    // Managed context fixture: A operates clients X and Y; B has its own client.
    await db.query(
      `INSERT INTO contacts (id, tenant_id, workspace_id, type, display_name) VALUES
        ($1, $4, $5, 'organization', 'Org X'),
        ($2, $4, $5, 'organization', 'Org Y'),
        ($3, $6, $7, 'organization', 'Org B')`,
      [ORG_X, ORG_Y, ORG_B, TA, WA, TB, WB],
    );
    await db.query(
      `INSERT INTO agency_clients (id, tenant_id, workspace_id, contact_id, display_name, managed_tenant_id) VALUES
        ($1, $4, $5, $7, 'Client X', $10),
        ($2, $4, $5, $8, 'Client Y', $10),
        ($3, $6, $11, $9, 'Client B', $10)`,
      [CLIENT_X, CLIENT_Y, CLIENT_B, TA, WA, TB, ORG_X, ORG_Y, ORG_B, MT_X, WB],
    );
    await db.query(
      `INSERT INTO agency_client_company_contexts (id, tenant_id, workspace_id, agency_client_id, company_contact_id, status, is_primary) VALUES
        ($1, $3, $4, $5, $7, 'active', true),
        ($2, $3, $4, $6, $8, 'active', true)`,
      [COMPANY_X, COMPANY_Y, TA, WA, CLIENT_X, CLIENT_Y, ORG_X, ORG_Y],
    );
    await db.query(
      `INSERT INTO tenant_product_entitlements (tenant_id, product_key, status, source)
       VALUES ($1, 'social', 'active', 'manual')`,
      [MT_X],
    );

    // Tenant A writes one record per module through its own API.
    const asOwnerA = sessionHeaders(TA, WA, OWNER_A, 'owner');
    const writes: Array<[string, Record<string, unknown>]> = [
      ['/agency/finance/cost-centers', { name: `${MARKER} cost center` }],
      ['/agency/projects', { name: `${MARKER} project` }],
      [
        '/agency/knowledge/categories',
        { name: `${MARKER} category`, slug: `${MARKER}-category` },
      ],
      [
        '/calendar/events',
        {
          title: `${MARKER} event`,
          // Calendar refuses events in the past: keep the fixture in the future.
          startsAt: new Date(Date.now() + 86_400_000).toISOString(),
          endsAt: new Date(Date.now() + 90_000_000).toISOString(),
        },
      ],
      [
        '/agency/team-chat/channels',
        { name: `${MARKER} private channel`, visibility: 'private' },
      ],
      ['/agency/activities', { type: 'call', summary: `${MARKER} activity` }],
    ];
    for (const [path, body] of writes) {
      const response = await http()
        .post(path)
        .set('Authorization', `Bearer ${ownerA}`)
        .set(asOwnerA)
        .send(body);
      if (response.status >= 300) {
        throw new Error(
          `fixture write ${path} failed: ${response.status} ${JSON.stringify(response.body)}`,
        );
      }
    }
  }, 60_000);

  afterAll(async () => {
    if (db?.isInitialized) {
      await deleteFixtureTenants();
    }
    await app?.close();
  });

  describe('legitimate access keeps working', () => {
    it.each(MODULE_READS)(
      '$module: same tenant + authorized workspace → 200 with own data',
      async ({ path }) => {
        const response = await get(
          path,
          ownerA,
          sessionHeaders(TA, WA, OWNER_A, 'owner'),
        );

        expect(response.status).toBe(200);
        expect(JSON.stringify(response.body)).toContain(MARKER);
      },
    );

    it.each(MODULE_READS)(
      '$module: no context headers → context comes from the JWT (200)',
      async ({ path }) => {
        const response = await get(path, ownerA);

        expect(response.status).toBe(200);
        expect(JSON.stringify(response.body)).toContain(MARKER);
      },
    );
  });

  describe('original CS6 attack: JWT of tenant B + headers of tenant A', () => {
    it.each(MODULE_READS)(
      '$module → 403 and zero data of A',
      async ({ path }) => {
        const response = await get(path, ownerB, {
          'x-tenant-id': TA,
          'x-workspace-id': WA,
        });

        expect(response.status).toBe(403);
        expect(JSON.stringify(response.body)).not.toContain(MARKER);
        expect(JSON.stringify(response.body)).not.toContain(TA);
      },
    );

    it.each(MODULE_READS)(
      '$module → 403 also when B impersonates A’s owner via x-user-id/x-user-role',
      async ({ path }) => {
        const response = await get(
          path,
          ownerB,
          sessionHeaders(TA, WA, OWNER_A, 'owner'),
        );

        expect(response.status).toBe(403);
        expect(JSON.stringify(response.body)).not.toContain(MARKER);
      },
    );

    it('Finance profitability AI-cost ledger (the CS6 surface) → 403', async () => {
      const response = await get(
        '/agency/finance/profitability/ai-costs',
        ownerB,
        { 'x-tenant-id': TA, 'x-workspace-id': WA },
      );

      expect(response.status).toBe(403);
    });

    it('a write with B’s JWT and A’s headers is refused and creates nothing in A', async () => {
      const response = await http()
        .post('/agency/finance/cost-centers')
        .set('Authorization', `Bearer ${ownerB}`)
        .set({ 'x-tenant-id': TA, 'x-workspace-id': WA })
        .send({ name: `${MARKER} injected by B` });

      expect(response.status).toBe(403);
      const rows: unknown[] = await db.query(
        `SELECT 1 FROM finance_cost_centers WHERE tenant_id = $1 AND name LIKE '%injected by B%'`,
        [TA],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('authorization matrix', () => {
    const FINANCE = '/agency/finance/cost-centers';

    it('tenant different in header → 403', async () => {
      const response = await get(FINANCE, ownerA, {
        'x-tenant-id': TB,
        'x-workspace-id': WA,
      });
      expect(response.status).toBe(403);
    });

    it('same tenant, workspace not authorized (header) → 403', async () => {
      const response = await get(FINANCE, ownerA, {
        'x-tenant-id': TA,
        'x-workspace-id': WA2,
      });
      expect(response.status).toBe(403);
    });

    it('same tenant, token for a workspace without membership → 403', async () => {
      const response = await get(FINANCE, ownerAInWa2, {
        'x-tenant-id': TA,
        'x-workspace-id': WA2,
      });
      expect(response.status).toBe(403);
    });

    it('workspace of another tenant → 403', async () => {
      const response = await get(FINANCE, ownerA, {
        'x-tenant-id': TA,
        'x-workspace-id': WB,
      });
      expect(response.status).toBe(403);
    });

    it('x-user-id of another user → 403', async () => {
      const response = await get(FINANCE, memberA, {
        'x-tenant-id': TA,
        'x-workspace-id': WA,
        'x-user-id': OWNER_A,
      });
      expect(response.status).toBe(403);
    });

    it('invalid JWT → 401', async () => {
      const response = await get(FINANCE, `${ownerA}tampered`, {
        'x-tenant-id': TA,
        'x-workspace-id': WA,
      });
      expect(response.status).toBe(401);
    });

    it('JWT of another stack (lyra_core seed tenant, no Agency membership) → 403', async () => {
      const coreTenant = randomUUID();
      const coreWorkspace = randomUUID();
      const token = tokenFor(randomUUID(), coreTenant, coreWorkspace, 'owner');
      const response = await get(FINANCE, token);
      expect(response.status).toBe(403);
    });

    it('membership deactivated after the token was issued → 403', async () => {
      const response = await get(FINANCE, removedA, {
        'x-tenant-id': TA,
        'x-workspace-id': WA,
      });
      expect(response.status).toBe(403);
    });

    it('Activities without any JWT → 401 (was fully public)', async () => {
      const response = await get('/agency/activities', null, {
        'x-tenant-id': TA,
        'x-workspace-id': WA,
        'x-user-id': OWNER_A,
      });
      expect(response.status).toBe(401);
      expect(JSON.stringify(response.body)).not.toContain(MARKER);
    });

    it('rejection body names no tenant, workspace or membership', async () => {
      const response = await get(FINANCE, ownerB, {
        'x-tenant-id': TA,
        'x-workspace-id': WA,
      });
      const body = JSON.stringify(response.body);
      for (const id of [TA, WA, TB, WB, OWNER_A, OWNER_B]) {
        expect(body).not.toContain(id);
      }
    });
  });

  describe('role comes from the membership, never from the token or a header', () => {
    it('a token still claiming owner after a demotion is evaluated with the live role → 403', async () => {
      const staleOwnerToken = tokenFor(MEMBER_A, TA, WA, 'owner');
      const response = await get(
        '/agency/finance/cost-centers',
        staleOwnerToken,
      );

      expect(response.status).toBe(403);
      expect(JSON.stringify(response.body)).not.toContain(MARKER);
    });

    it('a member claiming x-user-role=owner gets no Finance access → 403', async () => {
      const response = await get(
        '/agency/finance/cost-centers',
        memberA,
        sessionHeaders(TA, WA, MEMBER_A, 'owner'),
      );

      expect(response.status).toBe(403);
    });
  });

  describe('managed context stays agency tenant + validated selection', () => {
    type PlatformContextBody = {
      account: { tenantId: string };
      managedContext: {
        active: {
          kind: string;
          clientId: string | null;
          companyContextId: string | null;
        };
        rejection: unknown;
      };
    };
    const body = (response: { body: unknown }) =>
      response.body as PlatformContextBody;

    const managed = (clientId: string, companyContextId?: string) => ({
      'x-lyra-product-key': 'social',
      'x-lyra-operating-mode': 'client',
      'x-lyra-client-id': clientId,
      ...(companyContextId
        ? { 'x-lyra-company-context-id': companyContextId }
        : {}),
    });

    it('authorized managed client → 200, context active', async () => {
      const response = await get(
        '/platform/context',
        ownerA,
        managed(CLIENT_X, COMPANY_X),
      );

      expect(response.status).toBe(200);
      expect(body(response).account.tenantId).toBe(TA);
      expect(body(response).managedContext.active).toMatchObject({
        kind: 'client',
        clientId: CLIENT_X,
        companyContextId: COMPANY_X,
      });
      expect(body(response).managedContext.rejection).toBeNull();
    });

    it('member without a grant → selection refused, falls back to agency', async () => {
      const response = await get(
        '/platform/context',
        memberA,
        managed(CLIENT_X, COMPANY_X),
      );

      expect(response.status).toBe(200);
      expect(body(response).managedContext.active.clientId).toBeNull();
      expect(body(response).managedContext.rejection).not.toBeNull();
    });

    it('company context of another client → refused', async () => {
      const response = await get(
        '/platform/context',
        ownerA,
        managed(CLIENT_X, COMPANY_Y),
      );

      expect(response.status).toBe(200);
      expect(body(response).managedContext.active.companyContextId).toBeNull();
      expect(body(response).managedContext.rejection).not.toBeNull();
    });

    it('client of another tenant → refused', async () => {
      const response = await get(
        '/platform/context',
        ownerA,
        managed(CLIENT_B),
      );

      expect(response.status).toBe(200);
      expect(body(response).managedContext.active.clientId).toBeNull();
      expect(body(response).managedContext.rejection).not.toBeNull();
    });

    it('x-tenant-id = managed tenant is not a way in → 403', async () => {
      const response = await get('/platform/context', ownerA, {
        ...managed(CLIENT_X, COMPANY_X),
        'x-tenant-id': MT_X,
      });

      expect(response.status).toBe(403);
    });

    it('tenant B selecting A’s client with A’s headers → 403', async () => {
      const response = await get('/platform/context', ownerB, {
        ...managed(CLIENT_X, COMPANY_X),
        'x-tenant-id': TA,
        'x-workspace-id': WA,
      });

      expect(response.status).toBe(403);
    });
  });
});
