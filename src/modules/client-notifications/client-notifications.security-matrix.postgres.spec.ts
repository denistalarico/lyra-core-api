import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { PassportModule } from '@nestjs/passport';
import { Test } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import * as argon2 from 'argon2';
import { randomUUID } from 'crypto';
import request from 'supertest';
import type { DataSource } from 'typeorm';
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
import { AddNotificationRecipientSurface1797600000000 } from '../../database/migrations/1797600000000-add-notification-recipient-surface';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyAuthModule } from '../agency/agency-auth.module';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ClientAreaModule } from '../client-area/client-area.module';
import { ClientAreaMembershipService } from '../client-area/services/client-area-membership.service';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import {
  NotificationActorType,
  NotificationInterestReason,
  NotificationProductKey,
  NotificationRecipientSurface,
} from '../notifications/enums';
import { NotificationEventProcessorService } from '../notifications/services';
import { NotificationsModule } from '../notifications/notifications.module';
import { NotificationsService } from '../notifications/services';
import { ClientNotificationsModule } from './client-notifications.module';

// `otplib` v13 ships ESM Jest's CommonJS transform cannot load, and
// `AgencyAuthModule` imports it. Same contract as the real module, and the
// same mock the CA1/CCOM1 matrices use. No identity here enables 2FA.
jest.mock('otplib', () => ({
  verify: jest.fn(() => Promise.resolve({ valid: false })),
}));

const run = describePostgresIntegration();

const PASSWORD = 'Senha-forte-NTFC1!';
const AGENCY_SECRET = 'agency-access-secret-ntfc1-matrix-000000';
const CLIENT_SECRET = 'client-area-secret-ntfc1-matrix-11111111';

@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class FakeEmailModule {}

/**
 * NTF-C1 §45/§64 — the notification security matrix, through the real guard
 * chain against real PostgreSQL.
 *
 * Fixture:
 *
 *   U1       Client Area member of Company A
 *   U2       Client Area member of Company B
 *   REVOKED  member of Company A, revoked mid-test
 *   OP       Agency operator, the Agency recipient of every published event
 *
 * DIVERGENCE FROM THE NTF-C1 BRIEF, FOUND HERE
 * --------------------------------------------
 * §5/§64 ask for a fixture where one identity is *both* an Agency operator and
 * a Client Area member, on the premise that this is "a real case when an
 * operator is also a member of a Company". In this codebase it is not a
 * reachable state: CA1 forbids it in two independent places —
 * `ClientAreaMembershipService.grantInTransaction` refuses the grant with
 * `client_area_identity_is_agency_operator` when a `workspace_users` row
 * exists, and `ClientAreaAuthGuard` refuses the login of an identity that is
 * an operator. This spec proved it by attempting the grant, which threw.
 *
 * So the dual-identity case is asserted where it *can* exist — at the storage
 * level, in the migration suite, which inserts both surfaces for one
 * `user_id` and shows the unique key permits exactly one row per surface. The
 * column still earns its place for the two reasons that do not depend on that
 * case: it is the ownership predicate of every feed query (§15), and it
 * partitions push fan-out (§25). And it keeps the invariant from depending on
 * CA1's exclusion rule continuing to hold — if a later sprint allows
 * cross-tenant operators, nothing here needs to change.
 */
run('NTF-C1 client notification security matrix (PostgreSQL, real guards)', () => {
  let app: INestApplication;
  let db: DataSource;
  let memberships: ClientAreaMembershipService;
  let processor: NotificationEventProcessorService;
  let agencyFeed: NotificationsService;
  const savedEnv = { ...process.env };

  const runId = randomUUID().slice(0, 8);
  const email = (label: string) => `${label}.${runId}@ntfc1-spec.example.com`;

  const T = randomUUID();
  const W = randomUUID();
  const MT = randomUUID();
  const orgA = randomUUID();
  const orgB = randomUUID();
  const clientX = randomUUID();
  const clientY = randomUUID();
  const A = randomUUID();
  const B = randomUUID();
  const U1 = randomUUID();
  const U2 = randomUUID();
  const REVOKED = randomUUID();
  const OP = randomUUID();

  let revokedMembershipId = '';

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({
    get: (path: string) =>
      http().get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string) =>
      http().post(path).set('Authorization', `Bearer ${token}`),
  });

  // CA2 rate-limits Client Area logins per identity, which a spec logging in
  // per case would trip; one token per identity stays valid for the run.
  const tokenCache = new Map<string, string>();
  async function tokenFor(address: string) {
    const cached = tokenCache.get(address);
    if (cached) return cached;
    const response = await http()
      .post('/client-area/auth/login')
      .send({ email: address, password: PASSWORD })
      .expect(200);
    const token = (response.body as { accessToken: string }).accessToken;
    tokenCache.set(address, token);
    return token;
  }

  /**
   * A stable uuid per logical fixture name. `resource_id` is a uuid column, so
   * the readable label cannot be the id itself; this keeps the labels readable
   * in assertions while the stored value stays a real uuid.
   */
  const resourceIds = new Map<string, string>();
  const resourceIdFor = (label: string) => {
    const existing = resourceIds.get(label);
    if (existing) return existing;
    const id = randomUUID();
    resourceIds.set(label, id);
    return id;
  };

  /**
   * The source-event id of a fixture event.
   *
   * Namespaced by `runId`, because `notifications` is deduplicated on
   * `(tenant_id, source_event_id)` and the test database is shared and
   * persistent: a fixed id would collide with the row a previous run left
   * behind, and the second run would read that row's recipients instead of
   * its own. (This spec found exactly that.)
   */
  const eventIdFor = (label: string) =>
    `social.approval.awaiting_client:${runId}:${label}`;

  /** Publishes an approval event addressed at one company's client audience. */
  async function publishApproval(
    companyContextId: string,
    eventSuffix: string,
  ) {
    return processor.process({
      eventId: eventIdFor(eventSuffix),
      eventType: 'social.approval.awaiting_client',
      tenantId: T,
      workspaceId: W,
      productKey: NotificationProductKey.SOCIAL,
      moduleKey: 'approvals',
      actorType: NotificationActorType.SYSTEM,
      resourceType: 'social_approval_request',
      resourceId: resourceIdFor(eventSuffix),
      occurredAt: new Date().toISOString(),
      // The Agency audience of the same notification, so every case runs
      // against a row that genuinely addresses both surfaces.
      recipients: [
        { userId: OP, interestReason: NotificationInterestReason.REQUESTER },
      ],
      clientAudience: {
        companyContextId,
        requiredPermission: 'client_area.approvals.view',
        requiredModule: 'approvals',
        interestReason: NotificationInterestReason.APPROVER,
        actionUrl: `/client-area/companies/${companyContextId}/approvals/${resourceIdFor(
          eventSuffix,
        )}`,
        title: 'Uma aprovação aguarda você',
        body: 'Algo aguarda você.',
      },
      payload: {
        title: 'Aprovação aguardando cliente',
        body: 'Corpo Agency',
        actionUrl: `/social/approvals?approvalId=${resourceIdFor(eventSuffix)}`,
      },
    });
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = AGENCY_SECRET;
    process.env.JWT_CLIENT_AREA_ACCESS_SECRET = CLIENT_SECRET;
    process.env.CLIENT_AREA_ENABLED = 'true';
    delete process.env.JWT_2FA_SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        TypeOrmModule.forRoot(getTypeOrmConfig()),
        TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
        PassportModule,
        AgencyAuthModule,
        ClientAreaModule,
        NotificationsModule,
        ClientNotificationsModule,
      ],
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
    memberships = moduleRef.get(ClientAreaMembershipService);
    processor = moduleRef.get(NotificationEventProcessorService);
    agencyFeed = moduleRef.get(NotificationsService);

    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await new CreateClientAreaMemberships1797000000000().up(runner);
      await new CreateClientAreaInvitations1797100000000().up(runner);
      await new CreateClientAreaManagement1797150000000().up(runner);
      await new AddCompanyBrandIdentityFoundation1797160000000().up(runner);
      await new CreateClientAreaCrmIdentityRelationships1797300000000().up(runner);
      await new CreateClientConversations1797500000000().up(runner);
      await new AddNotificationRecipientSurface1797600000000().up(runner);
    } finally {
      await runner.release();
    }

    const passwordHash = await argon2.hash(PASSWORD);

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
      `INSERT INTO client_area_company_settings (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,approvals_enabled,conversations_enabled) VALUES
      ($1,$2,$3,$5,true,true,true),($1,$2,$4,$6,true,true,true)`,
      [T, W, clientX, clientY, A, B],
    );
    await db.query(
      `INSERT INTO tenant_product_entitlements (tenant_id,product_key,status,source) VALUES ($1,'social','active','manual')`,
      [MT],
    );

    for (const [user, label] of [
      [U1, 'u1'],
      [U2, 'u2'],
      [REVOKED, 'revoked'],
      [OP, 'op'],
    ] as const) {
      await db.query(
        `INSERT INTO user_security_settings
         (tenant_id,user_id,current_email,password_hash,two_factor_enabled,login_alerts_enabled)
         VALUES ($1,$2,$3,$4,false,false)`,
        [T, user, email(label), passwordHash],
      );
    }

    // OP is the only operator: CA1 refuses a Client Area grant to any identity
    // holding a `workspace_users` row, so U1 must not have one (see the
    // divergence note in this file's header).
    await db.query(
      `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES
       ($1,$2,$3,'Operador',$4,'owner','active')`,
      [T, W, OP, email('op')],
    );

    const crmLink = async (
      userId: string,
      address: string,
      organizationContactId: string,
    ) => {
      const [{ id: personContactId }] = await db.query<Array<{ id: string }>>(
        `INSERT INTO contacts (tenant_id,workspace_id,type,display_name) VALUES ($1,$2,'person',$3) RETURNING id`,
        [T, W, address],
      );
      await db.query(
        `INSERT INTO contact_methods (tenant_id,workspace_id,contact_id,type,value,is_primary) VALUES ($1,$2,$3,'email',$4,true)`,
        [T, W, personContactId, address],
      );
      await db.query(
        `INSERT INTO contact_company_links (tenant_id,workspace_id,person_contact_id,company_contact_id,status,linked_at,is_primary) VALUES ($1,$2,$3,$4,'active',now(),false)`,
        [T, W, personContactId, organizationContactId],
      );
      await db.query(
        `INSERT INTO client_area_identity_contacts (tenant_id,workspace_id,user_id,contact_id,status,linked_at) VALUES ($1,$2,$3,$4,'active',now())`,
        [T, W, userId, personContactId],
      );
    };

    await crmLink(U1, email('u1'), orgA);
    await crmLink(U2, email('u2'), orgB);
    await crmLink(REVOKED, email('revoked'), orgA);

    const grant = (companyContextId: string, userId: string, role: string) =>
      memberships.grant({
        tenantId: T,
        companyContextId,
        userId,
        role,
        grantedByUserId: OP,
      });

    await grant(A, U1, 'client_operator');
    await grant(B, U2, 'client_operator');
    revokedMembershipId = (await grant(A, REVOKED, 'client_operator')).id;
  }, 180000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...savedEnv };
  });

  describe('fan-out and surface separation', () => {
    it('one event creates recipients on both surfaces, each labelled explicitly', async () => {
      const result = await publishApproval(A, 'approval-dual');

      expect(result.status).toBe('created');

      const rows = await db.query<
        Array<{ user_id: string; recipient_surface: string }>
      >(
        `SELECT r.user_id, r.recipient_surface
           FROM notification_recipients r
           JOIN notifications n ON n.id = r.notification_id
          WHERE n.source_event_id = $1
          ORDER BY r.recipient_surface, r.user_id`,
        [eventIdFor('approval-dual')],
      );

      const bySurface = (surface: string) =>
        rows
          .filter((row) => row.recipient_surface === surface)
          .map((row) => row.user_id)
          .sort();

      expect(bySurface('agency')).toEqual([OP]);
      expect(bySurface('client_area')).toEqual([U1, REVOKED].sort());
    });

    /**
     * §15 — the surface is part of the ownership predicate, so a client row
     * cannot surface in an Agency feed read. Asserted by reading the *client*
     * recipient's id through the Agency service: same tenant, same workspace,
     * same user, and still nothing, because the surface differs.
     */
    it('an Agency feed read for a client user returns nothing', async () => {
      await publishApproval(A, 'approval-feeds');

      const clientToken = await tokenFor(email('u1'));
      const clientResponse = await authed(clientToken)
        .get('/client-area/notifications')
        .expect(200);
      const clientItems = (
        clientResponse.body as { items: Array<{ id: string }> }
      ).items;
      expect(clientItems.length).toBeGreaterThan(0);

      const agencyList = await agencyFeed.list(
        { tenantId: T, workspaceId: W, userId: U1 },
        {},
      );
      expect(agencyList.items).toHaveLength(0);

      const agencyUnread = await agencyFeed.unreadCount({
        tenantId: T,
        workspaceId: W,
        userId: U1,
      });
      expect(agencyUnread.count).toBe(0);
    });

    it('the Agency feed of the Agency recipient never shows client rows', async () => {
      await publishApproval(A, 'approval-op');

      const agencyList = await agencyFeed.list(
        { tenantId: T, workspaceId: W, userId: OP },
        {},
      );

      expect(agencyList.items.length).toBeGreaterThan(0);
      // The Agency item keeps the Agency route; the client route stays in
      // metadata, invisible here.
      expect(
        agencyList.items.every((item) =>
          item.actionUrl?.startsWith('/social/approvals'),
        ),
      ).toBe(true);
    });
  });

  describe('company isolation (§15/§46)', () => {
    it('Client A never sees Company B notifications', async () => {
      await publishApproval(B, 'approval-company-b');

      const token = await tokenFor(email('u1'));
      const response = await authed(token)
        .get('/client-area/notifications')
        .expect(200);

      const items = (
        response.body as { items: Array<{ companyContextId: string }> }
      ).items;
      expect(items.length).toBeGreaterThan(0);
      expect(items.every((item) => item.companyContextId === A)).toBe(true);
    });

    it('U2 sees only its own company', async () => {
      const token = await tokenFor(email('u2'));
      const response = await authed(token)
        .get('/client-area/notifications')
        .expect(200);

      const items = (
        response.body as { items: Array<{ companyContextId: string }> }
      ).items;
      expect(items.every((item) => item.companyContextId === B)).toBe(true);
    });

    it('a client cannot read another client notification by id', async () => {
      await publishApproval(B, 'approval-cross-read');
      const [row] = await db.query<Array<{ id: string }>>(
        `SELECT n.id FROM notifications n WHERE n.source_event_id = $1`,
        [eventIdFor('approval-cross-read')],
      );

      const token = await tokenFor(email('u1'));
      // 404, not 403: knowing an id must reveal nothing.
      await authed(token)
        .post(`/client-area/notifications/${row.id}/read`)
        .expect(404);
    });
  });

  describe('revoked membership (§21)', () => {
    it('receives no new notification after revocation', async () => {
      await memberships.revoke({
        tenantId: T,
        membershipId: revokedMembershipId,
        revokedByUserId: OP,
      });

      await publishApproval(A, 'approval-after-revoke');

      const rows = await db.query<Array<{ user_id: string }>>(
        `SELECT r.user_id
           FROM notification_recipients r
           JOIN notifications n ON n.id = r.notification_id
          WHERE n.source_event_id = $1
            AND r.recipient_surface = 'client_area'`,
        [eventIdFor('approval-after-revoke')],
      );

      expect(rows.map((row) => row.user_id)).toEqual([U1]);
    });

    it('keeps the historical notification it already received', async () => {
      // §21 — history is not rewritten; what fails closed is new delivery and
      // acting on it, which the approvals route re-checks.
      const rows = await db.query<Array<{ user_id: string }>>(
        `SELECT r.user_id
           FROM notification_recipients r
           JOIN notifications n ON n.id = r.notification_id
          WHERE n.source_event_id = $1 AND r.user_id = $2`,
        [eventIdFor('approval-dual'), REVOKED],
      );

      expect(rows).toHaveLength(1);
    });
  });

  describe('cross-surface authentication (§45)', () => {
    /**
     * The Agency token is signed here rather than obtained from the Agency
     * login route, which this test module does not mount. Signing it directly
     * is the stronger claim anyway: the token is *valid* — correct secret,
     * correct claims for the Agency stack, a real operator — and it is still
     * refused, because the Client Area strategy verifies against a different
     * secret and requires `typ='client_area'`, which an Agency token never
     * carries. The rejection is structural, not a filter.
     */
    it('an Agency token cannot read the client notification routes', async () => {
      const agencyToken = new JwtService({ secret: AGENCY_SECRET }).sign({
        sub: OP,
        tenantId: T,
        workspaceId: W,
        role: 'owner',
      });

      await authed(agencyToken).get('/client-area/notifications').expect(401);
    });

    it('a client token cannot read the Agency notification routes', async () => {
      const token = await tokenFor(email('u1'));
      await authed(token).get('/notifications').expect(401);
    });

    it('no token is no access', async () => {
      await http().get('/client-area/notifications').expect(401);
    });
  });

  describe('push subscriptions per surface (§24/§25)', () => {
    it('registers a client subscription with the client surface, server-side', async () => {
      const token = await tokenFor(email('u1'));
      const endpoint = `https://push.example.com/ntfc1-${runId}-client`;

      await authed(token)
        .post('/client-area/notifications/push/subscribe')
        .send({ endpoint, keys: { p256dh: 'p256dh-key', auth: 'auth-key' } })
        .expect(201);

      const rows = await db.query<Array<{ surface: string; user_id: string }>>(
        `SELECT surface, user_id FROM notification_push_subscriptions WHERE endpoint = $1`,
        [endpoint],
      );
      expect(rows).toEqual([
        { surface: NotificationRecipientSurface.CLIENT_AREA, user_id: U1 },
      ]);
    });

    it('ignores a surface supplied in the body', async () => {
      const token = await tokenFor(email('u1'));
      const endpoint = `https://push.example.com/ntfc1-${runId}-forged`;

      // `forbidNonWhitelisted` rejects the unknown property outright, which is
      // the strongest possible answer: the field does not exist in the DTO, so
      // it cannot be honoured by accident.
      await authed(token)
        .post('/client-area/notifications/push/subscribe')
        .send({
          endpoint,
          keys: { p256dh: 'p', auth: 'a' },
          surface: 'agency',
        })
        .expect(400);

      const rows = await db.query<Array<unknown>>(
        `SELECT 1 FROM notification_push_subscriptions WHERE endpoint = $1`,
        [endpoint],
      );
      expect(rows).toHaveLength(0);
    });
  });

  describe('unread, read and seen (§30)', () => {
    it('counts unread from the recipient row, on the client surface only', async () => {
      const token = await tokenFor(email('u2'));

      const before = await authed(token)
        .get('/client-area/notifications/unread-count')
        .expect(200);
      const beforeCount = (before.body as { count: number }).count;
      expect(beforeCount).toBeGreaterThan(0);

      const list = await authed(token)
        .get('/client-area/notifications')
        .expect(200);
      const first = (list.body as { items: Array<{ id: string }> }).items[0];

      await authed(token)
        .post(`/client-area/notifications/${first.id}/read`)
        .expect(201);

      const after = await authed(token)
        .get('/client-area/notifications/unread-count')
        .expect(200);
      expect((after.body as { count: number }).count).toBe(beforeCount - 1);
    });

    it('marking read on the client surface leaves the Agency feed untouched', async () => {
      const agencyBefore = await agencyFeed.unreadCount({
        tenantId: T,
        workspaceId: W,
        userId: OP,
      });

      const token = await tokenFor(email('u1'));
      await authed(token)
        .post('/client-area/notifications/read-all')
        .expect(201);

      const agencyAfter = await agencyFeed.unreadCount({
        tenantId: T,
        workspaceId: W,
        userId: OP,
      });
      expect(agencyAfter.count).toBe(agencyBefore.count);
    });
  });

  describe('client projection (§43)', () => {
    it('exposes the Client Area route and no internal field', async () => {
      await publishApproval(B, 'approval-projection');

      const token = await tokenFor(email('u2'));
      const response = await authed(token)
        .get('/client-area/notifications')
        .expect(200);

      const items = (
        response.body as { items: Array<Record<string, unknown>> }
      ).items;
      const item = items[0];

      expect(item.actionUrl).toEqual(
        expect.stringContaining(`/client-area/companies/${B}/approvals/`),
      );

      for (const internalKey of [
        'eventType',
        'productKey',
        'moduleKey',
        'actorUserId',
        'interestReason',
        'resourceId',
      ]) {
        expect(item).not.toHaveProperty(internalKey);
      }

      const serialized = JSON.stringify(items);
      expect(serialized).not.toContain(T);
      expect(serialized).not.toContain(W);
      expect(serialized).not.toContain(OP);
      expect(serialized).not.toContain('/social/approvals');
    });
  });

  describe('idempotency (§11/§26)', () => {
    it('a replayed event creates no second notification, recipient or delivery', async () => {
      const first = await publishApproval(A, 'approval-replay');
      expect(first.status).toBe('created');

      const countsBefore = await db.query<Array<{ recipients: string }>>(
        `SELECT count(r.id)::text AS recipients
           FROM notification_recipients r
           JOIN notifications n ON n.id = r.notification_id
          WHERE n.source_event_id = $1`,
        [eventIdFor('approval-replay')],
      );

      const second = await publishApproval(A, 'approval-replay');
      expect(second.status).toBe('duplicate');

      const countsAfter = await db.query<Array<{ recipients: string }>>(
        `SELECT count(r.id)::text AS recipients
           FROM notification_recipients r
           JOIN notifications n ON n.id = r.notification_id
          WHERE n.source_event_id = $1`,
        [eventIdFor('approval-replay')],
      );

      expect(countsAfter[0].recipients).toBe(countsBefore[0].recipients);

      const notifications = await db.query<Array<unknown>>(
        `SELECT 1 FROM notifications WHERE source_event_id = $1`,
        [eventIdFor('approval-replay')],
      );
      expect(notifications).toHaveLength(1);
    });

    it('records the client email delivery in notification_deliveries (§50)', async () => {
      await publishApproval(B, 'approval-delivery');

      const rows = await db.query<Array<{ channel: string; surface: string }>>(
        `SELECT d.channel, r.recipient_surface AS surface
           FROM notification_deliveries d
           JOIN notification_recipients r ON r.id = d.notification_recipient_id
           JOIN notifications n ON n.id = r.notification_id
          WHERE n.source_event_id = $1
            AND r.recipient_surface = 'client_area'
          ORDER BY d.channel`,
        [eventIdFor('approval-delivery')],
      );

      // No parallel ledger: the client email is a first-class delivery row.
      expect(rows.map((row) => row.channel)).toContain('email');
      expect(rows.map((row) => row.channel)).toContain('in_app');
    });
  });
});
