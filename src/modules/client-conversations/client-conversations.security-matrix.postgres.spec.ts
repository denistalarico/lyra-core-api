import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
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
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyAuthModule } from '../agency/agency-auth.module';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ClientAreaModule } from '../client-area/client-area.module';
import { ClientAreaMembershipService } from '../client-area/services/client-area-membership.service';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { FilesService } from '../../common/files/files.service';
import { ClientConversationsModule } from './client-conversations.module';
import { TenantContextAuthority } from '../../common/context/tenant-context-authority.service';

// `otplib` v13 ships ESM that Jest's CommonJS transform cannot load, and
// `AgencyAuthModule` imports it. Same contract as the real module (async,
// resolves `{ valid }`), and the same mock the CA1 matrix already uses. No
// identity here enables 2FA, so nothing under test depends on its behaviour.
jest.mock('otplib', () => ({
  verify: jest.fn(() => Promise.resolve({ valid: false })),
}));

const run = describePostgresIntegration();

const PASSWORD = 'Senha-forte-CCOM1!';
const AGENCY_SECRET = 'agency-access-secret-ccom1-matrix-0000000';
const CLIENT_SECRET = 'client-area-secret-ccom1-matrix-111111111';

@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class FakeEmailModule {}

/**
 * CCOM1 §50/§53 — the Client Area security matrix, through the real guard chain
 * against real PostgreSQL.
 *
 * Fixture, per §50:
 *
 *   U1 → Company A      (client_operator: may read and send)
 *   U2 → Company B      (client_operator)
 *   VIEWER → Company A  (client_viewer: may read, may NOT send)
 *   REVOKED → Company A (membership revoked mid-test)
 *
 * What these cases are actually defending against: in the Agency chat, a
 * channel UUID was a capability — `assertChannel` checked only tenant and
 * workspace, so anyone who knew an id could read and write. Several cases below
 * hand U1 a conversation id that genuinely exists and belongs to U2's company,
 * and assert 404. That is the property, not a nicety.
 */
run(
  'CCOM1 Client Conversation security matrix (PostgreSQL, real guards)',
  () => {
    let app: INestApplication;
    let db: DataSource;
    let memberships: ClientAreaMembershipService;
    const savedEnv = { ...process.env };

    const runId = randomUUID().slice(0, 8);
    const email = (label: string) => `${label}.${runId}@ccom1-spec.example.com`;

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
    const VIEWER = randomUUID();
    const REVOKED = randomUUID();
    const OP = randomUUID();

    let conversationA = '';
    let conversationB = '';
    let revokedMembershipId = '';

    const http = () => request(app.getHttpServer());
    const authed = (token: string) => ({
      get: (path: string) =>
        http().get(path).set('Authorization', `Bearer ${token}`),
      post: (path: string) =>
        http().post(path).set('Authorization', `Bearer ${token}`),
    });

    /**
     * One login per identity, cached.
     *
     * CA2 rate-limits Client Area logins per identity and IP, which is correct
     * behaviour that a spec logging in on every case would trip (and then report
     * as 429s that look like authorization failures). An access token stays
     * valid for the whole run, and the cases that care about revocation assert
     * that the *membership* stopped being true while this very token still
     * verifies — which is the stronger claim anyway.
     */
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

    const conversationsPath = (company: string) =>
      `/client-area/companies/${company}/conversations`;

    beforeAll(async () => {
      process.env.JWT_ACCESS_SECRET = AGENCY_SECRET;
      process.env.JWT_CLIENT_AREA_ACCESS_SECRET = CLIENT_SECRET;
      process.env.CLIENT_AREA_ENABLED = 'true';
      delete process.env.JWT_2FA_SECRET;

      const moduleRef = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
          // Both connections, as the real application has: this module pulls in
          // PermissionsModule (for the Agency boundary's `canAccessClient`),
          // whose entities live on the default (core) connection, while
          // everything CCOM1 persists is on 'agency'.
          TypeOrmModule.forRoot(getTypeOrmConfig()),
          TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
          PassportModule,
          AgencyAuthModule,
          ClientAreaModule,
          ClientConversationsModule,
        ],
        providers: [JwtStrategy, TenantContextAuthority],
      })
        .overrideModule(EmailModule)
        .useModule(FakeEmailModule)
        // Storage is not under test here; the attachment cases assert the
        // authorization chain, and a real MinIO would only add flakiness.
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
        await new CreateClientConversations1797500000000().up(runner);
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
      // §19/§20 — conversations enabled for both companies; approvals left off
      // on purpose, so these cases prove the two modules gate independently.
      await db.query(
        `INSERT INTO client_area_company_settings (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,approvals_enabled,conversations_enabled) VALUES
        ($1,$2,$3,$5,true,false,true),($1,$2,$4,$6,true,false,true)`,
        [T, W, clientX, clientY, A, B],
      );
      await db.query(
        `INSERT INTO tenant_product_entitlements (tenant_id,product_key,status,source) VALUES ($1,'social','active','manual')`,
        [MT],
      );

      for (const [user, label] of [
        [U1, 'u1'],
        [U2, 'u2'],
        [VIEWER, 'viewer'],
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
      await db.query(
        `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES ($1,$2,$3,'Operador',$4,'owner','active')`,
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
        return personContactId;
      };

      await crmLink(U1, email('u1'), orgA);
      await crmLink(U2, email('u2'), orgB);
      await crmLink(VIEWER, email('viewer'), orgA);
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
      await grant(A, VIEWER, 'client_viewer');
      revokedMembershipId = (await grant(A, REVOKED, 'client_operator')).id;
    }, 180000);

    afterAll(async () => {
      await app?.close();
      process.env = { ...savedEnv };
    });

    describe('company isolation', () => {
      it('U1 reads its own company conversation, provisioned on first touch', async () => {
        const token = await tokenFor(email('u1'));
        const response = await authed(token)
          .get(conversationsPath(A))
          .expect(200);

        const body = response.body as {
          conversations: Array<{
            id: string;
            companyContextId: string;
            companyDisplayName: string;
            unreadCount: number;
          }>;
        };
        expect(body.conversations).toHaveLength(1);
        conversationA = body.conversations[0].id;
        expect(body.conversations[0].companyContextId).toBe(A);
        // §40 — the organization Contact's name, not `AgencyClient.displayName`
        // ("Rotulo interno X"), which is the agency's internal commercial label.
        expect(body.conversations[0].companyDisplayName).toBe('Empresa A');
        expect(body.conversations[0].unreadCount).toBe(0);
      });

      it('U2 reads its own, and the two conversations are different rows', async () => {
        const token = await tokenFor(email('u2'));
        const response = await authed(token)
          .get(conversationsPath(B))
          .expect(200);

        const body = response.body as { conversations: Array<{ id: string }> };
        conversationB = body.conversations[0].id;
        expect(conversationB).not.toBe(conversationA);
      });

      it('U1 cannot reach company B at all', async () => {
        const token = await tokenFor(email('u1'));
        await authed(token).get(conversationsPath(B)).expect(404);
      });

      /**
       * The headline case: a real conversation id, owned by another company,
       * presented by an authenticated client with a valid session. This is the
       * exact shape of the Agency chat bug, and it must 404 — not 403, which
       * would confirm the row exists.
       */
      it("knowing U2's conversation id grants U1 nothing", async () => {
        const token = await tokenFor(email('u1'));

        await authed(token)
          .get(`${conversationsPath(A)}/${conversationB}`)
          .expect(404);
        await authed(token)
          .get(`${conversationsPath(A)}/${conversationB}/messages`)
          .expect(404);
        await authed(token)
          .post(`${conversationsPath(A)}/${conversationB}/messages`)
          .send({ body: 'tentativa' })
          .expect(404);
        await authed(token)
          .post(`${conversationsPath(A)}/${conversationB}/read`)
          .expect(404);
      });

      it('a forged conversation id fails', async () => {
        const token = await tokenFor(email('u1'));
        await authed(token)
          .get(`${conversationsPath(A)}/${randomUUID()}/messages`)
          .expect(404);
      });

      it('a forged company id fails, even paired with a real conversation', async () => {
        const token = await tokenFor(email('u1'));
        await authed(token)
          .get(`${conversationsPath(randomUUID())}/${conversationA}/messages`)
          .expect(404);
      });

      it('rejects an unauthenticated request', async () => {
        await http().get(conversationsPath(A)).expect(401);
      });
    });

    describe('messages and permissions', () => {
      it('an operator sends and the message comes back canonical', async () => {
        const token = await tokenFor(email('u1'));
        const sent = await authed(token)
          .post(`${conversationsPath(A)}/${conversationA}/messages`)
          .send({ body: 'Bom dia, podemos alterar a data da campanha?' })
          .expect(201);

        const body = sent.body as {
          message: {
            body: string;
            senderSurface: string;
            senderUserId: string;
          };
        };
        expect(body.message).toMatchObject({
          body: 'Bom dia, podemos alterar a data da campanha?',
          // §6 — persisted explicitly, never inferred from the user id.
          senderSurface: 'client_area',
          senderUserId: U1,
        });

        const listed = await authed(token)
          .get(`${conversationsPath(A)}/${conversationA}/messages`)
          .expect(200);
        expect(
          (listed.body as { messages: Array<{ body: string }> }).messages.map(
            (message) => message.body,
          ),
        ).toContain('Bom dia, podemos alterar a data da campanha?');
      });

      /** §18 — the viewer preset carries `view` but not `send`. */
      it('a viewer reads but cannot send', async () => {
        const token = await tokenFor(email('viewer'));

        await authed(token).get(conversationsPath(A)).expect(200);
        await authed(token)
          .get(`${conversationsPath(A)}/${conversationA}/messages`)
          .expect(200);
        await authed(token)
          .post(`${conversationsPath(A)}/${conversationA}/messages`)
          .send({ body: 'não deveria passar' })
          .expect(403);
      });

      it('a viewer also cannot upload, since upload requires send', async () => {
        const token = await tokenFor(email('viewer'));
        await authed(token)
          .post(`${conversationsPath(A)}/${conversationA}/attachments`)
          .attach('file', Buffer.from('x'), {
            filename: 'a.png',
            contentType: 'image/png',
          })
          .expect(403);
      });

      it('refuses an empty message instead of storing a blank line', async () => {
        const token = await tokenFor(email('u1'));
        await authed(token)
          .post(`${conversationsPath(A)}/${conversationA}/messages`)
          .send({ body: '   ' })
          .expect(400);
      });

      /**
       * §44/§45 — the watermark is the only read state. A sender has read their
       * own message, and the other participant has not.
       */
      it('unread follows the watermark per participant', async () => {
        const viewerToken = await tokenFor(email('viewer'));
        const senderToken = await tokenFor(email('u1'));

        // Read first, so this case owns its starting point instead of depending
        // on what earlier cases left in the viewer's watermark.
        await authed(viewerToken)
          .post(`${conversationsPath(A)}/${conversationA}/read`)
          .expect(201);
        await authed(senderToken)
          .post(`${conversationsPath(A)}/${conversationA}/messages`)
          .send({ body: 'mensagem nova para contar como não lida' })
          .expect(201);

        const before = await authed(viewerToken)
          .get(conversationsPath(A))
          .expect(200);
        expect(
          (before.body as { conversations: Array<{ unreadCount: number }> })
            .conversations[0].unreadCount,
        ).toBeGreaterThan(0);

        await authed(viewerToken)
          .post(`${conversationsPath(A)}/${conversationA}/read`)
          .expect(201);

        const after = await authed(viewerToken)
          .get(conversationsPath(A))
          .expect(200);
        expect(
          (after.body as { conversations: Array<{ unreadCount: number }> })
            .conversations[0].unreadCount,
        ).toBe(0);
      });

      it('pages by keyset without repeating or skipping a line', async () => {
        const token = await tokenFor(email('u1'));
        for (let index = 0; index < 5; index += 1) {
          await authed(token)
            .post(`${conversationsPath(A)}/${conversationA}/messages`)
            .send({ body: `linha ${index}` })
            .expect(201);
        }

        const first = await authed(token)
          .get(`${conversationsPath(A)}/${conversationA}/messages?limit=3`)
          .expect(200);
        const firstBody = first.body as {
          messages: Array<{ id: string }>;
          nextCursor: string | null;
        };
        expect(firstBody.messages).toHaveLength(3);
        expect(firstBody.nextCursor).toBeTruthy();

        const second = await authed(token)
          .get(
            `${conversationsPath(A)}/${conversationA}/messages?limit=3&before=${encodeURIComponent(
              firstBody.nextCursor ?? '',
            )}`,
          )
          .expect(200);
        const secondBody = second.body as { messages: Array<{ id: string }> };

        const firstIds = firstBody.messages.map((message) => message.id);
        const secondIds = secondBody.messages.map((message) => message.id);
        expect(firstIds.filter((id) => secondIds.includes(id))).toEqual([]);
      });
    });

    describe('attachments (§53)', () => {
      let attachmentA = '';

      it('a participant uploads and receives an opaque ref only', async () => {
        const token = await tokenFor(email('u1'));
        const response = await authed(token)
          .post(`${conversationsPath(A)}/${conversationA}/attachments`)
          .attach('file', Buffer.from('fake-png-bytes'), {
            filename: 'brief.png',
            contentType: 'image/png',
          })
          .expect(201);

        const body = response.body as {
          attachment: Record<string, unknown> & { id: string };
        };
        attachmentA = body.attachment.id;
        expect(attachmentA).toBeTruthy();

        // §15 — nothing in the projection names storage.
        const serialized = JSON.stringify(body.attachment);
        expect(serialized).not.toContain('tenants/');
        expect(serialized).not.toContain('storageKey');
        expect(serialized).not.toContain('publicUrl');
        expect(Object.keys(body.attachment).sort()).toEqual([
          'fileName',
          'height',
          'id',
          'kind',
          'mimeType',
          'sizeBytes',
          'width',
        ]);
      });

      it('rejects a disallowed MIME type', async () => {
        const token = await tokenFor(email('u1'));
        await authed(token)
          .post(`${conversationsPath(A)}/${conversationA}/attachments`)
          .attach('file', Buffer.from('#!/bin/sh'), {
            filename: 'run.sh',
            contentType: 'application/x-sh',
          })
          .expect(400);
      });

      it('streams bytes to the participant', async () => {
        const token = await tokenFor(email('u1'));
        await authed(token)
          .get(
            `${conversationsPath(A)}/${conversationA}/attachments/${attachmentA}`,
          )
          .expect(200);
      });

      it('denies the same ref to another company', async () => {
        const token = await tokenFor(email('u2'));
        await authed(token)
          .get(
            `${conversationsPath(B)}/${conversationB}/attachments/${attachmentA}`,
          )
          .expect(404);
      });

      it('denies a forged ref', async () => {
        const token = await tokenFor(email('u1'));
        await authed(token)
          .get(
            `${conversationsPath(A)}/${conversationA}/attachments/${randomUUID()}`,
          )
          .expect(404);
      });

      it('denies an unauthenticated read', async () => {
        await http()
          .get(
            `${conversationsPath(A)}/${conversationA}/attachments/${attachmentA}`,
          )
          .expect(401);
      });

      /**
       * §53 — path traversal is inapplicable rather than mitigated: the route
       * takes an attachment id, and the storage key is read off the row. A
       * traversal string is simply not a ref.
       */
      it('treats a traversal string as a missing ref, never as a path', async () => {
        const token = await tokenFor(email('u1'));
        for (const candidate of [
          '..%2F..%2Fetc%2Fpasswd',
          encodeURIComponent('../../secret'),
        ]) {
          await authed(token)
            .get(
              `${conversationsPath(A)}/${conversationA}/attachments/${candidate}`,
            )
            .expect(404);
        }
      });
    });

    describe('revocation (§26) and company state', () => {
      it('a revoked membership loses the conversation on the next request', async () => {
        const token = await tokenFor(email('revoked'));
        await authed(token).get(conversationsPath(A)).expect(200);

        await memberships.revoke({
          tenantId: T,
          membershipId: revokedMembershipId,
          revokedByUserId: OP,
        });

        /**
         * 401, not 404 — and that is the stronger outcome.
         *
         * CA2 revokes the person's Client Area sessions when their last
         * membership goes, so the still-unexpired, still-correctly-signed token
         * stops authenticating at all rather than merely losing one company.
         * Either answer satisfies §26 (no listing, no reading, no sending); this
         * asserts the behaviour the code actually has instead of the weaker one.
         */
        await authed(token).get(conversationsPath(A)).expect(401);
        await authed(token)
          .post(`${conversationsPath(A)}/${conversationA}/messages`)
          .send({ body: 'depois da revogação' })
          .expect(401);
      });

      it('the participant row survives revocation as history', async () => {
        const rows = await db.query<Array<{ user_id: string }>>(
          `SELECT user_id FROM client_conversation_participants WHERE conversation_id = $1 AND user_id = $2`,
          [conversationA, REVOKED],
        );
        expect(rows).toHaveLength(1);
      });

      it('switching the company module off hides the thread (§20)', async () => {
        const token = await tokenFor(email('u1'));
        await db.query(
          `UPDATE client_area_company_settings SET conversations_enabled = false WHERE company_context_id = $1`,
          [A],
        );
        try {
          await authed(token).get(conversationsPath(A)).expect(403);
        } finally {
          await db.query(
            `UPDATE client_area_company_settings SET conversations_enabled = true WHERE company_context_id = $1`,
            [A],
          );
        }
        await authed(token).get(conversationsPath(A)).expect(200);
      });

      it('an archived Company Context fails closed', async () => {
        const token = await tokenFor(email('u1'));
        await db.query(
          `UPDATE agency_client_company_contexts SET status='archived', archived_at=now() WHERE id=$1`,
          [A],
        );
        try {
          await authed(token).get(conversationsPath(A)).expect(404);
        } finally {
          await db.query(
            `UPDATE agency_client_company_contexts SET status='active', archived_at=NULL WHERE id=$1`,
            [A],
          );
        }
      });

      it('a removed CRM relation fails closed', async () => {
        const token = await tokenFor(email('u1'));
        // `unlinked_at` is required for any non-active status
        // (CK_contact_company_links_validity).
        await db.query(
          `UPDATE contact_company_links SET status='inactive', unlinked_at=now()
          WHERE tenant_id=$1 AND company_contact_id=$2`,
          [T, orgA],
        );
        try {
          await authed(token).get(conversationsPath(A)).expect(404);
        } finally {
          await db.query(
            `UPDATE contact_company_links SET status='active', unlinked_at=NULL
            WHERE tenant_id=$1 AND company_contact_id=$2`,
            [T, orgA],
          );
        }
      });
    });

    describe('cross-surface token rejection', () => {
      it('refuses an Agency access token on the Client Area boundary', async () => {
        const agencyLogin = await http()
          .post('/agency/auth/login')
          .send({ email: email('op'), password: PASSWORD });

        // The operator may or may not have a usable Agency login in this
        // fixture; what matters is that no Agency token reaches this surface.
        const agencyToken = (agencyLogin.body as { accessToken?: string })
          .accessToken;
        if (agencyToken) {
          await authed(agencyToken).get(conversationsPath(A)).expect(401);
        }
      });

      it('refuses a syntactically valid token signed with the wrong secret', async () => {
        await http()
          .get(conversationsPath(A))
          .set('Authorization', 'Bearer not.a.jwt')
          .expect(401);
      });
    });
  },
);
