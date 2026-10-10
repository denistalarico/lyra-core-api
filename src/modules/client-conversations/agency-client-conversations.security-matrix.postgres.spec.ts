import { ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';
import { FilesService } from '../../common/files/files.service';
import {
  getAgencyTypeOrmConfig,
  getTypeOrmConfig,
} from '../../config/typeorm.config';
import { CreateClientAreaMemberships1797000000000 } from '../../database/migrations/1797000000000-create-client-area-memberships';
import { CreateClientAreaInvitations1797100000000 } from '../../database/migrations/1797100000000-create-client-area-invitations';
import { CreateClientAreaManagement1797150000000 } from '../../database/migrations/1797150000000-create-client-area-management';
import { AddCompanyBrandIdentityFoundation1797160000000 } from '../../database/migrations/1797160000000-add-company-brand-identity-foundation';
import { CreateClientAreaCrmIdentityRelationships1797300000000 } from '../../database/migrations/1797300000000-create-client-area-crm-identity-relationships';
import { CreateClientConversations1797500000000 } from '../../database/migrations/1797500000000-create-client-conversations';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ClientAreaModule } from '../client-area/client-area.module';
import { ClientConversationsModule } from './client-conversations.module';
import { TenantContextAuthority } from '../../common/context/tenant-context-authority.service';

// `otplib` v13 ships ESM that Jest's CommonJS transform cannot load, and it
// arrives transitively through the Client Area auth services. Nothing here
// exercises 2FA; tokens are signed directly.
jest.mock('otplib', () => ({
  verify: jest.fn(() => Promise.resolve({ valid: false })),
}));

const run = describePostgresIntegration();

const AGENCY_SECRET = 'agency-access-secret-ccom1-agency-matrix1';
const CLIENT_SECRET = 'client-area-secret-ccom1-agency-matrix-22';

/**
 * CCOM1 §51 — the Agency security matrix.
 *
 * Fixture, per §51:
 *
 *   OPERATOR_A  member, holds an `agency_client_access` grant for client X
 *   OPERATOR_B  member, holds NO grant for client X
 *   OWNER       owner, implied access to every client of the tenant
 *
 * The central claim is the one the Agency chat failed: knowing a conversation
 * UUID grants nothing. Operator B is handed the real conversation id of a real
 * company in their own tenant and workspace, and must be refused — with 404,
 * so the id is not even confirmed to exist.
 */
run('CCOM1 Agency Client Conversation security matrix (PostgreSQL)', () => {
  let app: INestApplication;
  let db: DataSource;
  let jwt: JwtService;
  const savedEnv = { ...process.env };

  const T = randomUUID();
  const W = randomUUID();
  const MT = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const clientX = randomUUID();
  const clientY = randomUUID();
  const A = randomUUID();
  const B = randomUUID();
  const OPERATOR_A = randomUUID();
  const OPERATOR_B = randomUUID();
  const OWNER = randomUUID();

  let conversationA = '';

  const http = () => request(app.getHttpServer());

  /**
   * Mints an Agency access token directly.
   *
   * The Agency login path needs credentials, 2FA state and `otplib` (whose ESM
   * build Jest cannot load here). What is under test is authorization, not
   * authentication, and `JwtStrategy` is the real strategy verifying the real
   * secret — so a signed token is the honest input.
   */
  const tokenFor = (userId: string, role: string) =>
    jwt.sign(
      {
        sub: userId,
        tenantId: T,
        workspaceId: W,
        role,
        sessionId: randomUUID(),
        email: `${role}@ccom1-agency.example.com`,
      },
      { secret: AGENCY_SECRET, expiresIn: '15m' },
    );

  const authed = (token: string) => ({
    get: (path: string) =>
      http()
        .get(path)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', T)
        .set('x-workspace-id', W),
    post: (path: string) =>
      http()
        .post(path)
        .set('Authorization', `Bearer ${token}`)
        .set('x-tenant-id', T)
        .set('x-workspace-id', W),
  });

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = AGENCY_SECRET;
    process.env.JWT_CLIENT_AREA_ACCESS_SECRET = CLIENT_SECRET;
    process.env.CLIENT_AREA_ENABLED = 'true';

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        TypeOrmModule.forRoot(getTypeOrmConfig()),
        TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
        PassportModule,
        ClientAreaModule,
        ClientConversationsModule,
      ],
      providers: [JwtStrategy, TenantContextAuthority],
    })
      .overrideProvider(FilesService)
      .useValue({
        uploadPrivateBuffer: jest.fn(({ path }: { path: string }) =>
          Promise.resolve({ path }),
        ),
        getPrivateAsset: jest.fn(() =>
          Promise.resolve({
            body: { pipe: (response: { end: () => void }) => response.end() },
            contentType: 'image/png',
            cacheControl: 'private, no-store',
          }),
        ),
      })
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
      await new CreateClientConversations1797500000000().up(runner);
    } finally {
      await runner.release();
    }

    await db.query(
      `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name,legal_name) VALUES
        ($1,$3,$4,'organization','Empresa A','Empresa A Ltda'),
        ($2,$3,$4,'organization','Empresa B',NULL)`,
      [orgA, orgB, T, W],
    );
    await db.query(
      `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name,managed_tenant_id) VALUES
        ($1,$3,$4,$5,'Rotulo interno X',$7),($2,$3,$4,$6,'Rotulo interno Y',$7)`,
      [clientX, clientY, T, W, orgA, orgB, MT],
    );
    await db.query(
      `INSERT INTO agency_client_company_contexts (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES
        ($1,$3,$4,$5,$7,'active',true),($2,$3,$4,$6,$8,'active',true)`,
      [A, B, T, W, clientX, clientY, orgA, orgB],
    );
    await db.query(
      `INSERT INTO client_area_settings (tenant_id,workspace_id,enabled) VALUES ($1,$2,true)`,
      [T, W],
    );
    await db.query(
      `INSERT INTO client_area_company_settings (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,conversations_enabled) VALUES
        ($1,$2,$3,$5,true,true),($1,$2,$4,$6,true,true)`,
      [T, W, clientX, clientY, A, B],
    );

    for (const [user, role] of [
      [OPERATOR_A, 'member'],
      [OPERATOR_B, 'member'],
      [OWNER, 'owner'],
    ] as const) {
      await db.query(
        `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES ($1,$2,$3,$4,$5,$6,'active')`,
        [T, W, user, role, `${role}.${user}@ccom1-agency.example.com`, role],
      );
    }

    // §29 — the platform's existing rule: everyone below owner needs an
    // explicit `agency_client_access` grant. Operator A gets one for client X
    // only; operator B gets none at all.
    await db.query(
      `INSERT INTO agency_client_access (tenant_id,workspace_id,client_id,user_id,role_key,access_level)
       VALUES ($1,$2,$3,$4,'manager','admin')`,
      [T, W, clientX, OPERATOR_A],
    );

    // The permission keys must exist in `platform_permissions`, or
    // `PermissionsGuard` fails closed and every case below would 403 for the
    // wrong reason. The migration seeds them; this asserts the seeding ran.
    const seeded = await db.query<Array<{ key: string }>>(
      `SELECT key FROM platform_permissions WHERE key LIKE 'agency.client_conversations.%'`,
    );
    expect(seeded.map((row) => row.key).sort()).toEqual([
      'agency.client_conversations.send.assigned',
      'agency.client_conversations.view.assigned',
    ]);
  }, 180000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...savedEnv };
  });

  describe('operator eligibility (§29)', () => {
    it('an operator with client access sees only that company', async () => {
      const response = await authed(tokenFor(OPERATOR_A, 'member'))
        .get('/agency/client-conversations/companies')
        .expect(200);

      const body = response.body as {
        companies: Array<{
          companyContextId: string;
          displayName: string;
          conversation: { id: string };
        }>;
      };
      expect(body.companies.map((item) => item.companyContextId)).toEqual([A]);
      // §40 — the organization Contact's name, never "Rotulo interno X".
      expect(body.companies[0].displayName).toBe('Empresa A');
      conversationA = body.companies[0].conversation.id;
    });

    it('an operator without client access sees nothing', async () => {
      const response = await authed(tokenFor(OPERATOR_B, 'member'))
        .get('/agency/client-conversations/companies')
        .expect(200);
      expect(
        (response.body as { companies: unknown[] }).companies,
      ).toHaveLength(0);
    });

    it('an owner sees every company of the tenant', async () => {
      const response = await authed(tokenFor(OWNER, 'owner'))
        .get('/agency/client-conversations/companies')
        .expect(200);
      expect(
        (
          response.body as { companies: Array<{ companyContextId: string }> }
        ).companies
          .map((item) => item.companyContextId)
          .sort(),
      ).toEqual([A, B].sort());
    });

    /**
     * The headline case. Operator B is in the right tenant and the right
     * workspace, holds the permission key, and is handed a conversation id
     * that really exists. The Agency chat would have served this.
     */
    it('knowing a conversation id grants an ineligible operator nothing', async () => {
      const token = tokenFor(OPERATOR_B, 'member');

      await authed(token)
        .get(`/agency/client-conversations/companies/${A}`)
        .expect(404);
      await authed(token)
        .get(
          `/agency/client-conversations/companies/${A}/conversations/${conversationA}/messages`,
        )
        .expect(404);
      await authed(token)
        .post(
          `/agency/client-conversations/companies/${A}/conversations/${conversationA}/messages`,
        )
        .send({ body: 'não deveria chegar ao cliente' })
        .expect(404);
    });

    it('an eligible operator sends, and the message is attributed to the agency', async () => {
      const token = tokenFor(OPERATOR_A, 'member');
      const response = await authed(token)
        .post(
          `/agency/client-conversations/companies/${A}/conversations/${conversationA}/messages`,
        )
        .send({ body: 'Claro, podemos remarcar.' })
        .expect(201);

      expect(
        (response.body as { message: Record<string, unknown> }).message,
      ).toMatchObject({
        senderSurface: 'agency',
        senderUserId: OPERATOR_A,
        body: 'Claro, podemos remarcar.',
      });
    });

    it('refuses a conversation of another company paired with a reachable one', async () => {
      const ownerToken = tokenFor(OWNER, 'owner');
      const companyB = await authed(ownerToken)
        .get(`/agency/client-conversations/companies/${B}`)
        .expect(200);
      const conversationB = (companyB.body as { conversation: { id: string } })
        .conversation.id;

      // Operator A may reach company A, and conversation B really exists —
      // but not inside company A's scope.
      await authed(tokenFor(OPERATOR_A, 'member'))
        .get(
          `/agency/client-conversations/companies/${A}/conversations/${conversationB}/messages`,
        )
        .expect(404);
    });

    it('fails closed when the company switches conversations off (§20)', async () => {
      const token = tokenFor(OPERATOR_A, 'member');
      await db.query(
        `UPDATE client_area_company_settings SET conversations_enabled=false WHERE company_context_id=$1`,
        [A],
      );
      try {
        await authed(token)
          .get(`/agency/client-conversations/companies/${A}`)
          .expect(403);
      } finally {
        await db.query(
          `UPDATE client_area_company_settings SET conversations_enabled=true WHERE company_context_id=$1`,
          [A],
        );
      }
    });

    it('rejects an unauthenticated request', async () => {
      await http().get('/agency/client-conversations/companies').expect(401);
    });

    /**
     * §31/§52 — the surfaces do not share authentication. A Client Area token
     * is refused here even when signed with the Agency secret, because
     * `JwtStrategy` rejects any token carrying `typ`.
     */
    it('refuses a Client Area token on the Agency boundary', async () => {
      const clientAreaToken = jwt.sign(
        {
          sub: randomUUID(),
          tenantId: T,
          sessionId: randomUUID(),
          typ: 'client_area',
        },
        { secret: AGENCY_SECRET, expiresIn: '15m' },
      );

      await authed(clientAreaToken)
        .get('/agency/client-conversations/companies')
        .expect(401);
    });
  });

  describe('attachments', () => {
    it('refuses an attachment ref from a company the operator cannot reach', async () => {
      const ownerToken = tokenFor(OWNER, 'owner');
      const uploaded = await authed(ownerToken)
        .post(
          `/agency/client-conversations/companies/${A}/conversations/${conversationA}/attachments`,
        )
        .attach('file', Buffer.from('bytes'), {
          filename: 'plano.pdf',
          contentType: 'application/pdf',
        })
        .expect(201);

      const attachmentId = (uploaded.body as { attachment: { id: string } })
        .attachment.id;

      // The owner uploaded it and may read it back.
      await authed(ownerToken)
        .get(
          `/agency/client-conversations/companies/${A}/conversations/${conversationA}/attachments/${attachmentId}`,
        )
        .expect(200);

      // Operator B cannot, even with the exact ref.
      await authed(tokenFor(OPERATOR_B, 'member'))
        .get(
          `/agency/client-conversations/companies/${A}/conversations/${conversationA}/attachments/${attachmentId}`,
        )
        .expect(404);
    });

    it('never projects a storage key to an Agency caller either', async () => {
      const response = await authed(tokenFor(OPERATOR_A, 'member'))
        .post(
          `/agency/client-conversations/companies/${A}/conversations/${conversationA}/attachments`,
        )
        .attach('file', Buffer.from('bytes'), {
          filename: 'brief.png',
          contentType: 'image/png',
        })
        .expect(201);

      const serialized = JSON.stringify(response.body);
      expect(serialized).not.toContain('tenants/');
      expect(serialized).not.toContain('storageKey');
    });
  });
});
