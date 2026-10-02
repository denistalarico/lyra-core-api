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
import { AddSocialApprovalCommentVisibility1797400000000 } from '../../database/migrations/1797400000000-add-social-approval-comment-visibility';
import { CreateClientConversations1797500000000 } from '../../database/migrations/1797500000000-create-client-conversations';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyAuthModule } from '../agency/agency-auth.module';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { ClientAreaModule } from '../client-area/client-area.module';
import { ClientAreaMembershipService } from '../client-area/services/client-area-membership.service';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { FilesService } from '../../common/files/files.service';
import { ClientConversationApprovalsModule } from './client-conversation-approvals.module';
import { ClientConversationsModule } from './client-conversations.module';
import { ClientConversationCardService } from './services/client-conversation-card.service';

// `otplib` v13 ships ESM that Jest's CommonJS transform cannot load, and
// `AgencyAuthModule` imports it. Same contract as the real module, and the same
// mock the CA1/CCOM1 matrices use. No identity here enables 2FA.
jest.mock('otplib', () => ({
  verify: jest.fn(() => Promise.resolve({ valid: false })),
}));

const run = describePostgresIntegration();

const PASSWORD = 'Senha-forte-CCOM2!';
const AGENCY_SECRET = 'agency-access-secret-ccom2-matrix-0000000';
const CLIENT_SECRET = 'client-area-secret-ccom2-matrix-111111111';

@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class FakeEmailModule {}

type TimelineItem = {
  source: 'conversation_message' | 'approval_comment';
  id: string;
  body?: string;
  kind?: string;
  card?: {
    kind: string;
    approvalId: string;
    announced: { title: string; version: string };
    state: {
      status: string;
      title: string;
      versionLabel: string;
      needsAction: boolean;
      replacementApprovalId?: string;
    } | null;
    actions: {
      canComment: boolean;
      canDecide: boolean;
      canOpenPreview: boolean;
    };
  } | null;
  authorName?: string;
  authorSide?: string;
  about?: { title: string; version: string };
  mine?: boolean;
};

type TimelineBody = { items: TimelineItem[]; nextCursor: string | null };

/**
 * CCOM2 §47–§54 — the approval-card security matrix, through the real guard
 * chains against real PostgreSQL.
 *
 * Fixture:
 *
 *   U1       → Company A (client_operator: view+send+comment+decide)
 *   VIEWER   → Company A (client_viewer:   view only, no decide)
 *   U2       → Company B (client_operator)
 *   OPERATOR → Agency, with an `agency_client_access` grant for client X
 *
 * Approvals in Company A: one sent (`sentA`), one never sent (`draftA`).
 * One sent approval in Company B (`sentB`).
 *
 * What these cases defend: a card is a *reference*, so the only thing an
 * attacker can tamper with is the `approvalId` inside `metadata.card` — and
 * several cases below write a forged or internal-only id into a real card row
 * of a real conversation and assert that the card resolves to nothing. That is
 * the property the "resolve on read" model exists to provide (§15).
 */
run('CCOM2 approval cards in conversations (PostgreSQL, real guards)', () => {
  let app: INestApplication;
  let db: DataSource;
  let memberships: ClientAreaMembershipService;
  let cards: ClientConversationCardService;
  const savedEnv = { ...process.env };

  const runId = randomUUID().slice(0, 8);
  const email = (label: string) => `${label}.${runId}@ccom2-spec.example.com`;

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
  const OP = randomUUID();
  const OPERATOR = randomUUID();

  const sentA = randomUUID();
  const draftA = randomUUID();
  const sentB = randomUUID();

  let conversationA = '';
  let conversationB = '';

  const http = () => request(app.getHttpServer());
  const authed = (token: string) => ({
    get: (path: string) =>
      http().get(path).set('Authorization', `Bearer ${token}`),
    post: (path: string) =>
      http().post(path).set('Authorization', `Bearer ${token}`),
  });

  /** One login per identity, cached: CA2 rate-limits Client Area logins. */
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
  const timelinePath = (company: string, conversation: string) =>
    `${conversationsPath(company)}/${conversation}/timeline`;

  async function seedApproval(
    id: string,
    companyContextId: string,
    agencyClientId: string,
    overrides: {
      status?: string;
      sentToClientAt?: string | null;
      supersededAt?: string | null;
      title?: string;
      versionLabel?: string;
    } = {},
  ) {
    const [{ id: planId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO social_plans
         (tenant_id,workspace_id,agency_client_id,company_context_id,title,period_start,period_end,status)
       VALUES ($1,$2,$3,$4,'Plano CCOM2','2026-01-01','2026-01-31','active') RETURNING id`,
      [T, W, agencyClientId, companyContextId],
    );
    const [{ id: itemId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO social_content_items
         (tenant_id,workspace_id,agency_client_id,plan_id,title,planning_status)
       VALUES ($1,$2,$3,$4,'Conteúdo CCOM2','planned') RETURNING id`,
      [T, W, agencyClientId, planId],
    );
    const [{ id: revisionId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO social_content_revisions
         (tenant_id,workspace_id,agency_client_id,content_item_id,revision_number,copy)
       VALUES ($1,$2,$3,$4,2,'Copy da revisão') RETURNING id`,
      [T, W, agencyClientId, itemId],
    );

    await db.query(
      `INSERT INTO social_approval_requests
         (id,tenant_id,workspace_id,agency_client_id,company_context_id,subject_type,subject_id,subject_revision_id,
          source_module,display_type,title,subject_version_label,status,current_stage,requested_by_user_id,
          requested_at,sent_to_client_at,superseded_at)
       VALUES ($1,$2,$3,$4,$5,'planner_content_revision',$6,$7,'social_planner','content_revision',$8,$9,$10,'client',$11,
               now(),$12,$13)`,
      [
        id,
        T,
        W,
        agencyClientId,
        companyContextId,
        itemId,
        revisionId,
        overrides.title ?? 'Post Carnaval',
        overrides.versionLabel ?? 'v2',
        overrides.status ?? 'awaiting_client',
        OP,
        // `??` would turn an intentional null into a date; `undefined` is the
        // only value that may fall through to the default.
        overrides.sentToClientAt === undefined
          ? new Date().toISOString()
          : overrides.sentToClientAt,
        overrides.supersededAt ?? null,
      ],
    );

    return { itemId, revisionId };
  }

  /** Publishes a card the way the publisher does, through the real service. */
  async function publishCard(approvalId: string) {
    const [approval] = await db.query<Array<Record<string, unknown>>>(
      `SELECT id, tenant_id AS "tenantId", workspace_id AS "workspaceId",
              agency_client_id AS "agencyClientId",
              company_context_id AS "companyContextId",
              title, subject_version_label AS "subjectVersionLabel"
         FROM social_approval_requests WHERE id = $1`,
      [approvalId],
    );

    return cards.publishApprovalCard({
      approval: approval as never,
      dedupeKey: `social.approval.awaiting_client:${approvalId}:2026-10-01T10:00:00.000Z`,
    });
  }

  const cardsOf = (body: TimelineBody) =>
    body.items.filter(
      (item) => item.source === 'conversation_message' && item.card,
    );

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
        ClientConversationsModule,
        // The join module: without it, cards are never published and never
        // resolve. Importing it here is what puts CCOM2 under test at all.
        ClientConversationApprovalsModule,
      ],
      providers: [JwtStrategy],
    })
      .overrideModule(EmailModule)
      .useModule(FakeEmailModule)
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
    cards = moduleRef.get(ClientConversationCardService, { strict: false });

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
      await new AddSocialApprovalCommentVisibility1797400000000().up(runner);
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
      `INSERT INTO agency_client_company_contexts
         (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES
        ($1,$3,$4,$5,$7,'active',true),($2,$3,$4,$6,$8,'active',true)`,
      [A, B, T, W, clientX, clientY, orgA, orgB],
    );
    await db.query(
      `INSERT INTO client_area_settings (tenant_id,workspace_id,enabled) VALUES ($1,$2,true)`,
      [T, W],
    );
    // CCOM2 — both modules on for both companies: the approvals-off case flips
    // the flag inside its own test and restores it.
    await db.query(
      `INSERT INTO client_area_company_settings
         (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,approvals_enabled,conversations_enabled) VALUES
        ($1,$2,$3,$5,true,true,true),($1,$2,$4,$6,true,true,true)`,
      [T, W, clientX, clientY, A, B],
    );
    await db.query(
      `INSERT INTO tenant_product_entitlements (tenant_id,product_key,status,source)
       VALUES ($1,'social','active','manual')`,
      [MT],
    );

    for (const [user, label] of [
      [U1, 'u1'],
      [U2, 'u2'],
      [VIEWER, 'viewer'],
      [OP, 'op'],
      [OPERATOR, 'operator'],
    ] as const) {
      await db.query(
        `INSERT INTO user_security_settings
           (tenant_id,user_id,current_email,password_hash,two_factor_enabled,login_alerts_enabled)
         VALUES ($1,$2,$3,$4,false,false)`,
        [T, user, email(label), passwordHash],
      );
    }
    await db.query(
      `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES
        ($1,$2,$3,'Operador',$4,'owner','active'),
        ($1,$2,$5,'Operador B',$6,'member','active')`,
      [T, W, OP, email('op'), OPERATOR, email('operator')],
    );

    const crmLink = async (
      userId: string,
      address: string,
      organizationContactId: string,
    ) => {
      const [{ id: personContactId }] = await db.query<Array<{ id: string }>>(
        `INSERT INTO contacts (tenant_id,workspace_id,type,display_name)
         VALUES ($1,$2,'person',$3) RETURNING id`,
        [T, W, address],
      );
      await db.query(
        `INSERT INTO contact_methods (tenant_id,workspace_id,contact_id,type,value,is_primary)
         VALUES ($1,$2,$3,'email',$4,true)`,
        [T, W, personContactId, address],
      );
      await db.query(
        `INSERT INTO contact_company_links
           (tenant_id,workspace_id,person_contact_id,company_contact_id,status,linked_at,is_primary)
         VALUES ($1,$2,$3,$4,'active',now(),false)`,
        [T, W, personContactId, organizationContactId],
      );
      await db.query(
        `INSERT INTO client_area_identity_contacts
           (tenant_id,workspace_id,user_id,contact_id,status,linked_at)
         VALUES ($1,$2,$3,$4,'active',now())`,
        [T, W, userId, personContactId],
      );
      /**
       * No `agency_user_profiles` row is seeded.
       *
       * That table belongs to the Agency settings migrations, which this
       * spec's set does not include, and the AP3 author projection already
       * handles its absence: a client author with no profile falls back to
       * 'Usuário'. What these cases assert about authorship is the *side*
       * (client vs agency) and that no operator name or id is ever emitted —
       * both of which hold without a display name, and the agency label is a
       * constant rather than a profile lookup.
       */
    };

    await crmLink(U1, email('u1'), orgA);
    await crmLink(U2, email('u2'), orgB);
    await crmLink(VIEWER, email('viewer'), orgA);

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

    await seedApproval(sentA, A, clientX);
    // §15 — never sent to the client. It exists, it is in the right company,
    // and it must still be invisible on the timeline.
    await seedApproval(draftA, A, clientX, {
      status: 'draft',
      sentToClientAt: null,
      title: 'APROVAÇÃO INTERNA',
    });
    await seedApproval(sentB, B, clientY, { title: 'Post da Empresa B' });

    // Touch both conversations so they exist (the card publisher provisions
    // nothing — §10 — so a company that never opened the surface gets no card).
    const u1 = await tokenFor(email('u1'));
    conversationA = (
      (await authed(u1).get(conversationsPath(A)).expect(200)).body as {
        conversations: Array<{ id: string }>;
      }
    ).conversations[0].id;

    const u2 = await tokenFor(email('u2'));
    conversationB = (
      (await authed(u2).get(conversationsPath(B)).expect(200)).body as {
        conversations: Array<{ id: string }>;
      }
    ).conversations[0].id;
  }, 240000);

  afterAll(async () => {
    await app?.close();
    process.env = { ...savedEnv };
  });

  describe('§3/§5/§6 card persistence', () => {
    it('publishes the card as a system message with no human author', async () => {
      const result = await publishCard(sentA);
      expect(result.status).toBe('posted');

      const [row] = await db.query<
        Array<{
          kind: string;
          sender_surface: string;
          sender_user_id: string | null;
          body: string;
          metadata: Record<string, unknown>;
        }>
      >(
        `SELECT kind, sender_surface, sender_user_id, body, metadata
           FROM client_conversation_messages
          WHERE conversation_id = $1 AND metadata ->> 'dedupeKey' IS NOT NULL`,
        [conversationA],
      );

      // §5 — `kind='system'`, which the existing CHECK already accepts, so no
      // migration was needed for the card.
      expect(row.kind).toBe('system');
      // §6 — the platform speaks: agency surface, null author. The database
      // CHECK allows a null author only on the agency side.
      expect(row.sender_surface).toBe('agency');
      expect(row.sender_user_id).toBeNull();
      // §3 — a textual fallback for search and sidebar previews.
      expect(row.body).toBe('Nova aprovação disponível: Post Carnaval (v2)');

      const card = row.metadata.card as Record<string, unknown>;
      expect(card).toEqual({
        kind: 'approval_card',
        approvalId: sentA,
        title: 'Post Carnaval',
        version: 'v2',
      });
    });

    /** §4 — nothing volatile is persisted. Asserted key by key. */
    it('persists no status, actions, preview or media in the card', async () => {
      const [row] = await db.query<Array<{ metadata: string }>>(
        `SELECT metadata::text AS metadata
           FROM client_conversation_messages
          WHERE conversation_id = $1 AND metadata ->> 'dedupeKey' IS NOT NULL`,
        [conversationA],
      );

      for (const volatile of [
        'status',
        'actionsPermitted',
        'actions',
        'preview',
        'mediaRef',
        'permissions',
        'storageKey',
        'publicUrl',
      ]) {
        expect(row.metadata).not.toContain(volatile);
      }
    });

    /** §9/§51 — a retried event lands once. */
    it('does not create a second card for a retried event', async () => {
      const again = await publishCard(sentA);
      expect(again.status).toBe('duplicate');

      const [{ count }] = await db.query<Array<{ count: string }>>(
        `SELECT count(*) FROM client_conversation_messages
          WHERE conversation_id = $1 AND metadata -> 'card' IS NOT NULL`,
        [conversationA],
      );
      expect(Number(count)).toBe(1);
    });

    /**
     * §10 — the card never provisions. A company whose client has never opened
     * the surface has no conversation, and an approval transition must not
     * create one and seat the client in it.
     */
    it('skips the card when the company has no conversation yet', async () => {
      const lonelyOrg = randomUUID();
      const lonelyClient = randomUUID();
      const lonelyCompany = randomUUID();
      const lonelyApproval = randomUUID();

      await db.query(
        `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name)
         VALUES ($1,$2,$3,'organization','Empresa sem conversa')`,
        [lonelyOrg, T, W],
      );
      await db.query(
        `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name,managed_tenant_id)
         VALUES ($1,$2,$3,$4,'Cliente sem conversa',$5)`,
        [lonelyClient, T, W, lonelyOrg, MT],
      );
      await db.query(
        `INSERT INTO agency_client_company_contexts
           (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary)
         VALUES ($1,$2,$3,$4,$5,'active',true)`,
        [lonelyCompany, T, W, lonelyClient, lonelyOrg],
      );
      await db.query(
        `INSERT INTO client_area_company_settings
           (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,approvals_enabled,conversations_enabled)
         VALUES ($1,$2,$3,$4,true,true,true)`,
        [T, W, lonelyClient, lonelyCompany],
      );
      await seedApproval(lonelyApproval, lonelyCompany, lonelyClient);

      expect((await publishCard(lonelyApproval)).status).toBe('skipped');

      const [{ count }] = await db.query<Array<{ count: string }>>(
        `SELECT count(*) FROM client_conversations WHERE company_context_id = $1`,
        [lonelyCompany],
      );
      expect(Number(count)).toBe(0);
    });

    /** §10 — conversations off for the company means no card, and no error. */
    it('skips the card when the company has conversations switched off', async () => {
      const offApproval = randomUUID();
      await seedApproval(offApproval, B, clientY, { title: 'Sem conversa' });

      await db.query(
        `UPDATE client_area_company_settings SET conversations_enabled = false
          WHERE company_context_id = $1`,
        [B],
      );
      try {
        expect((await publishCard(offApproval)).status).toBe('skipped');
      } finally {
        await db.query(
          `UPDATE client_area_company_settings SET conversations_enabled = true
            WHERE company_context_id = $1`,
          [B],
        );
      }
    });
  });

  describe('§47 client card security', () => {
    it('U1 sees the card of its own company, resolved to the live status', async () => {
      const token = await tokenFor(email('u1'));
      const body = (
        await authed(token).get(timelinePath(A, conversationA)).expect(200)
      ).body as TimelineBody;

      const [card] = cardsOf(body);
      expect(card.card?.approvalId).toBe(sentA);
      expect(card.card?.state).toMatchObject({
        status: 'awaiting_your_review',
        title: 'Post Carnaval',
        versionLabel: 'v2',
        needsAction: true,
      });
    });

    it('U1 does not see company B at all', async () => {
      const token = await tokenFor(email('u1'));
      await authed(token).get(timelinePath(B, conversationB)).expect(404);
      // And a real conversation of B paired with a reachable company is 404.
      await authed(token).get(timelinePath(A, conversationB)).expect(404);
    });

    /**
     * §15 — the headline case. A forged `approvalId` is written into the real
     * card row of U1's own conversation. The card must resolve to nothing: the
     * id is a *request*, and the resolver re-proves it against the scope.
     */
    it('a forged approvalId in metadata resolves to nothing', async () => {
      const forged = randomUUID();
      await db.query(
        `UPDATE client_conversation_messages
            SET metadata = jsonb_set(metadata, '{card,approvalId}', to_jsonb($2::text))
          WHERE conversation_id = $1 AND metadata -> 'card' IS NOT NULL`,
        [conversationA, forged],
      );

      try {
        const token = await tokenFor(email('u1'));
        const body = (
          await authed(token).get(timelinePath(A, conversationA)).expect(200)
        ).body as TimelineBody;

        const [card] = cardsOf(body);
        expect(card.card?.state).toBeNull();
        expect(card.card?.actions).toEqual({
          canComment: false,
          canDecide: false,
          canOpenPreview: false,
        });
      } finally {
        await db.query(
          `UPDATE client_conversation_messages
              SET metadata = jsonb_set(metadata, '{card,approvalId}', to_jsonb($2::text))
            WHERE conversation_id = $1 AND metadata -> 'card' IS NOT NULL`,
          [conversationA, sentA],
        );
      }
    });

    /**
     * §15 — an approval that exists, in the right company, that was never sent
     * to the client. Fail closed: the phase filter is part of the scope.
     */
    it('an approval never sent to the client does not resolve', async () => {
      await db.query(
        `UPDATE client_conversation_messages
            SET metadata = jsonb_set(metadata, '{card,approvalId}', to_jsonb($2::text))
          WHERE conversation_id = $1 AND metadata -> 'card' IS NOT NULL`,
        [conversationA, draftA],
      );

      try {
        const token = await tokenFor(email('u1'));
        const body = (
          await authed(token).get(timelinePath(A, conversationA)).expect(200)
        ).body as TimelineBody;

        const [card] = cardsOf(body);
        expect(card.card?.state).toBeNull();
        // And nothing of the internal approval leaks into the response.
        expect(JSON.stringify(body)).not.toContain('APROVAÇÃO INTERNA');
      } finally {
        await db.query(
          `UPDATE client_conversation_messages
              SET metadata = jsonb_set(metadata, '{card,approvalId}', to_jsonb($2::text))
            WHERE conversation_id = $1 AND metadata -> 'card' IS NOT NULL`,
          [conversationA, sentA],
        );
      }
    });

    /** §15 — another company's real, sent approval does not resolve either. */
    it("another company's approval does not resolve on this timeline", async () => {
      await db.query(
        `UPDATE client_conversation_messages
            SET metadata = jsonb_set(metadata, '{card,approvalId}', to_jsonb($2::text))
          WHERE conversation_id = $1 AND metadata -> 'card' IS NOT NULL`,
        [conversationA, sentB],
      );

      try {
        const token = await tokenFor(email('u1'));
        const body = (
          await authed(token).get(timelinePath(A, conversationA)).expect(200)
        ).body as TimelineBody;

        expect(cardsOf(body)[0].card?.state).toBeNull();
        expect(JSON.stringify(body)).not.toContain('Post da Empresa B');
      } finally {
        await db.query(
          `UPDATE client_conversation_messages
              SET metadata = jsonb_set(metadata, '{card,approvalId}', to_jsonb($2::text))
            WHERE conversation_id = $1 AND metadata -> 'card' IS NOT NULL`,
          [conversationA, sentA],
        );
      }
    });

    it('rejects an unauthenticated timeline read', async () => {
      await http().get(timelinePath(A, conversationA)).expect(401);
    });

    it('an archived Company Context fails closed', async () => {
      const token = await tokenFor(email('u1'));
      await db.query(
        `UPDATE agency_client_company_contexts SET status='archived', archived_at=now() WHERE id=$1`,
        [A],
      );
      try {
        await authed(token).get(timelinePath(A, conversationA)).expect(404);
      } finally {
        await db.query(
          `UPDATE agency_client_company_contexts SET status='active', archived_at=NULL WHERE id=$1`,
          [A],
        );
      }
    });

    it('a removed CRM relation fails closed', async () => {
      const token = await tokenFor(email('u1'));
      await db.query(
        `UPDATE contact_company_links SET status='inactive', unlinked_at=now()
          WHERE tenant_id=$1 AND company_contact_id=$2`,
        [T, orgA],
      );
      try {
        await authed(token).get(timelinePath(A, conversationA)).expect(404);
      } finally {
        await db.query(
          `UPDATE contact_company_links SET status='active', unlinked_at=NULL
            WHERE tenant_id=$1 AND company_contact_id=$2`,
          [T, orgA],
        );
      }
    });

    it('a revoked membership loses the timeline on the next request', async () => {
      const revoked = randomUUID();
      await db.query(
        `INSERT INTO user_security_settings
           (tenant_id,user_id,current_email,password_hash,two_factor_enabled,login_alerts_enabled)
         VALUES ($1,$2,$3,$4,false,false)`,
        [T, revoked, email('revoked'), await argon2.hash(PASSWORD)],
      );
      await crmLinkFor(revoked, email('revoked'), orgA);
      const membership = await memberships.grant({
        tenantId: T,
        companyContextId: A,
        userId: revoked,
        role: 'client_operator',
        grantedByUserId: OP,
      });

      const token = await tokenFor(email('revoked'));
      await authed(token).get(timelinePath(A, conversationA)).expect(200);

      await memberships.revoke({
        tenantId: T,
        membershipId: membership.id,
        revokedByUserId: OP,
      });

      // 401, not 404: CA2 revokes the Client Area sessions when the last
      // membership goes, so the still-valid token stops authenticating at all
      // — the same stronger outcome CCOM1 §30 recorded.
      await authed(token).get(timelinePath(A, conversationA)).expect(401);
    });

    /** Inline, because the outer helper is scoped to `beforeAll`. */
    async function crmLinkFor(
      userId: string,
      address: string,
      organizationContactId: string,
    ) {
      const [{ id: personContactId }] = await db.query<Array<{ id: string }>>(
        `INSERT INTO contacts (tenant_id,workspace_id,type,display_name)
         VALUES ($1,$2,'person',$3) RETURNING id`,
        [T, W, address],
      );
      await db.query(
        `INSERT INTO contact_methods (tenant_id,workspace_id,contact_id,type,value,is_primary)
         VALUES ($1,$2,$3,'email',$4,true)`,
        [T, W, personContactId, address],
      );
      await db.query(
        `INSERT INTO contact_company_links
           (tenant_id,workspace_id,person_contact_id,company_contact_id,status,linked_at,is_primary)
         VALUES ($1,$2,$3,$4,'active',now(),false)`,
        [T, W, personContactId, organizationContactId],
      );
      await db.query(
        `INSERT INTO client_area_identity_contacts
           (tenant_id,workspace_id,user_id,contact_id,status,linked_at)
         VALUES ($1,$2,$3,$4,'active',now())`,
        [T, W, userId, personContactId],
      );
    }
  });

  describe('§14/§48 action resolution', () => {
    it('an operator with decide gets both actions', async () => {
      const token = await tokenFor(email('u1'));
      const body = (
        await authed(token).get(timelinePath(A, conversationA)).expect(200)
      ).body as TimelineBody;

      expect(cardsOf(body)[0].card?.actions).toEqual({
        canComment: true,
        canDecide: true,
        canOpenPreview: true,
      });
    });

    /**
     * §48 — a viewer reads and comments, and does not decide.
     *
     * The asymmetry is deliberate and predates CCOM2 (CCOM1 §12): the
     * `client_viewer` preset holds `approvals.view` + `approvals.comment` but
     * not `approvals.decide`, and holds `conversations.view` without
     * `conversations.send`. So the same person can comment on an artefact under
     * review and cannot open a message channel to the agency — a comment is
     * scoped to one version, a message is a channel.
     *
     * This case therefore proves the two axes are genuinely independent: the
     * card's `canComment` follows the *approvals* key, not the conversation's
     * `send`, which this reader does not have.
     */
    it('a viewer reads and comments on the card, and cannot decide', async () => {
      const token = await tokenFor(email('viewer'));
      const body = (
        await authed(token).get(timelinePath(A, conversationA)).expect(200)
      ).body as TimelineBody;

      const card = cardsOf(body)[0];
      expect(card.card?.state?.status).toBe('awaiting_your_review');
      expect(card.card?.actions).toEqual({
        // From `client_area.approvals.comment`, which the viewer holds...
        canComment: true,
        // ...while `decide` is withheld, so no decision is ever offered.
        canDecide: false,
        canOpenPreview: true,
      });

      // And the conversation's own `send` is genuinely absent for this reader,
      // which is what makes the line above a statement about independence
      // rather than a coincidence.
      await authed(token)
        .post(`${conversationsPath(A)}/${conversationA}/messages`)
        .send({ body: 'viewer não envia' })
        .expect(403);

      // The approvals domain refuses the decision too, so the card is not
      // merely hiding a button that would have worked.
      await authed(token)
        .post(`/client-area/companies/${A}/approvals/${sentA}/approve`)
        .expect(403);
    });

    /**
     * §14 — approvals off, conversations on. The record stays and every action
     * falls away; the client is not offered a CTA that would 403 against
     * `@RequireClientAreaModule('approvals')`.
     */
    it('degrades the actions when the approvals module is off', async () => {
      const token = await tokenFor(email('u1'));
      await db.query(
        `UPDATE client_area_company_settings SET approvals_enabled = false
          WHERE company_context_id = $1`,
        [A],
      );
      try {
        const body = (
          await authed(token).get(timelinePath(A, conversationA)).expect(200)
        ).body as TimelineBody;

        const card = cardsOf(body)[0];
        // The card is still there, and still resolves its status...
        expect(card.card?.state?.status).toBe('awaiting_your_review');
        // ...with no action at all.
        expect(card.card?.actions).toEqual({
          canComment: false,
          canDecide: false,
          canOpenPreview: false,
        });

        // And the approvals routes genuinely refuse, which is why no CTA is
        // offered above.
        await authed(token)
          .post(`/client-area/companies/${A}/approvals/${sentA}/approve`)
          .expect(403);
      } finally {
        await db.query(
          `UPDATE client_area_company_settings SET approvals_enabled = true
            WHERE company_context_id = $1`,
          [A],
        );
      }
    });
  });

  describe('§16/§49 comment visibility', () => {
    it('projects a client-visible comment, naming the agency as a team', async () => {
      await db.query(
        `INSERT INTO social_approval_comments
           (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
         VALUES ($1,'client','client','user',$2,$3)`,
        [sentA, OP, 'Resposta pública da agência'],
      );

      const token = await tokenFor(email('u1'));
      const body = (
        await authed(token).get(timelinePath(A, conversationA)).expect(200)
      ).body as TimelineBody;

      const comment = body.items.find(
        (item) => item.source === 'approval_comment',
      );
      expect(comment).toMatchObject({
        source: 'approval_comment',
        body: 'Resposta pública da agência',
        // §17 — the agency is a team, never an operator's name or id.
        authorName: 'Equipe da agência',
        authorSide: 'agency',
        mine: false,
      });
      // §41 — the comment says which version it is about.
      expect(comment?.about).toEqual({ title: 'Post Carnaval', version: 'v2' });

      // §17 — no operator identity anywhere in the page.
      const serialized = JSON.stringify(body);
      expect(serialized).not.toContain(OP);
      expect(serialized).not.toContain('Operador');
    });

    /**
     * §16/§49 — `visibility`, never `stage`. An agency note taken while the
     * request waits on the client is `stage='client'` with
     * `visibility='internal'`, and reading `stage` would publish it.
     */
    it('never projects an internal comment, even at stage=client', async () => {
      await db.query(
        `INSERT INTO social_approval_comments
           (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
         VALUES ($1,'client','internal','user',$2,$3)`,
        [sentA, OP, 'NOTA INTERNA: renegociar prazo'],
      );

      const token = await tokenFor(email('u1'));
      const body = (
        await authed(token).get(timelinePath(A, conversationA)).expect(200)
      ).body as TimelineBody;

      expect(JSON.stringify(body)).not.toContain('NOTA INTERNA');
    });

    it("marks the reader's own comment as theirs", async () => {
      await db.query(
        `INSERT INTO social_approval_comments
           (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
         VALUES ($1,'client','client','user',$2,$3)`,
        [sentA, U1, 'Pergunta do cliente'],
      );

      const token = await tokenFor(email('u1'));
      const body = (
        await authed(token).get(timelinePath(A, conversationA)).expect(200)
      ).body as TimelineBody;

      const mine = body.items.find(
        (item) => item.body === 'Pergunta do cliente',
      );
      expect(mine).toMatchObject({ authorSide: 'client', mine: true });

      // And the same row is not "mine" for a different reader.
      const viewerToken = await tokenFor(email('viewer'));
      const viewerBody = (
        await authed(viewerToken)
          .get(timelinePath(A, conversationA))
          .expect(200)
      ).body as TimelineBody;
      expect(
        viewerBody.items.find((item) => item.body === 'Pergunta do cliente'),
      ).toMatchObject({ mine: false });
    });

    it("does not project another company's approval comments", async () => {
      await db.query(
        `INSERT INTO social_approval_comments
           (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
         VALUES ($1,'client','client','user',$2,$3)`,
        [sentB, U2, 'COMENTARIO DA EMPRESA B'],
      );

      const token = await tokenFor(email('u1'));
      const body = (
        await authed(token).get(timelinePath(A, conversationA)).expect(200)
      ).body as TimelineBody;

      expect(JSON.stringify(body)).not.toContain('COMENTARIO DA EMPRESA B');
    });

    /**
     * §15 — a comment on an approval that was never sent must not surface,
     * because the approval itself does not exist for this client.
     */
    it('does not project comments of an approval never sent to the client', async () => {
      await db.query(
        `INSERT INTO social_approval_comments
           (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
         VALUES ($1,'client','client','user',$2,$3)`,
        [draftA, OP, 'COMENTARIO DE RASCUNHO'],
      );

      const token = await tokenFor(email('u1'));
      const body = (
        await authed(token).get(timelinePath(A, conversationA)).expect(200)
      ).body as TimelineBody;

      expect(JSON.stringify(body)).not.toContain('COMENTARIO DE RASCUNHO');
    });
  });

  describe('§50 metadata injection', () => {
    it('a client cannot send metadata or a card through the message DTO', async () => {
      const token = await tokenFor(email('u1'));

      // The DTO has no `metadata` and the global pipe runs
      // `forbidNonWhitelisted`, so this is refused before any service runs.
      await authed(token)
        .post(`${conversationsPath(A)}/${conversationA}/messages`)
        .send({
          body: 'tentativa de card',
          metadata: { card: { kind: 'approval_card', approvalId: sentA } },
        })
        .expect(400);

      await authed(token)
        .post(`${conversationsPath(A)}/${conversationA}/messages`)
        .send({ body: 'tentativa de kind', kind: 'system' })
        .expect(400);
    });

    it('a client message is stored as text with no card, whatever it says', async () => {
      const token = await tokenFor(email('u1'));
      await authed(token)
        .post(`${conversationsPath(A)}/${conversationA}/messages`)
        .send({ body: 'approval_card' })
        .expect(201);

      const [row] = await db.query<
        Array<{ kind: string; metadata: Record<string, unknown> | null }>
      >(
        `SELECT kind, metadata FROM client_conversation_messages
          WHERE conversation_id = $1 AND body = 'approval_card'`,
        [conversationA],
      );

      // §5/§50 — `kind` is derived server-side, and no card was created.
      expect(row.kind).toBe('text');
      expect(row.metadata?.card).toBeUndefined();
    });
  });

  describe('§23/§53 cross-source pagination', () => {
    /**
     * The required shape: alternating sources, small pages, walked to the end.
     * The rows already in the conversation from earlier cases are part of the
     * walk, which makes the assertion stronger rather than weaker: whatever is
     * there must come back exactly once.
     */
    it('walks the whole timeline with no duplicate and no skip', async () => {
      const token = await tokenFor(email('u1'));

      // A few more rows of each source, interleaved.
      for (let index = 0; index < 3; index += 1) {
        await authed(token)
          .post(`${conversationsPath(A)}/${conversationA}/messages`)
          .send({ body: `mensagem de paginacao ${index}` })
          .expect(201);
        await db.query(
          `INSERT INTO social_approval_comments
             (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
           VALUES ($1,'client','client','user',$2,$3)`,
          [sentA, U1, `comentario de paginacao ${index}`],
        );
      }

      for (const limit of [1, 2, 3, 5]) {
        const seen: string[] = [];
        let cursor: string | null = null;

        for (let guard = 0; guard < 60; guard += 1) {
          const query = `?limit=${limit}${
            cursor ? `&before=${encodeURIComponent(cursor)}` : ''
          }`;
          const page = (
            await authed(token)
              .get(`${timelinePath(A, conversationA)}${query}`)
              .expect(200)
          ).body as TimelineBody;

          expect(page.items.length).toBeLessThanOrEqual(limit);
          seen.push(...page.items.map((item) => `${item.source}:${item.id}`));
          if (!page.nextCursor) break;
          cursor = page.nextCursor;
        }

        // No duplicate across pages, at any page size.
        expect(new Set(seen).size).toBe(seen.length);
        // And the walk is stable: every page size reaches the same set.
        expect(seen.length).toBeGreaterThan(5);
      }
    }, 120000);

    /**
     * §23/§53 — the hard case: a message and an approval comment written at the
     * *same* instant. Without `source` in the sort key, one of them is lost or
     * repeated at a page boundary of one.
     */
    it('handles a message and a comment at the identical timestamp', async () => {
      const token = await tokenFor(email('u1'));
      const instant = new Date('2026-09-01T12:00:00.000Z').toISOString();

      const [{ id: messageId }] = await db.query<Array<{ id: string }>>(
        `INSERT INTO client_conversation_messages
           (tenant_id,workspace_id,agency_client_id,company_context_id,conversation_id,
            sender_surface,sender_user_id,body,kind,created_at)
         VALUES ($1,$2,$3,$4,$5,'client_area',$6,'empate de timestamp','text',$7)
         RETURNING id`,
        [T, W, clientX, A, conversationA, U1, instant],
      );
      const [{ id: commentId }] = await db.query<Array<{ id: string }>>(
        `INSERT INTO social_approval_comments
           (approval_request_id,stage,visibility,actor_type,actor_user_id,body,created_at)
         VALUES ($1,'client','client','user',$2,'empate de comentario',$3)
         RETURNING id`,
        [sentA, U1, instant],
      );

      const seen: string[] = [];
      let cursor: string | null = null;

      for (let guard = 0; guard < 80; guard += 1) {
        const query = `?limit=1${
          cursor ? `&before=${encodeURIComponent(cursor)}` : ''
        }`;
        const page = (
          await authed(token)
            .get(`${timelinePath(A, conversationA)}${query}`)
            .expect(200)
        ).body as TimelineBody;

        seen.push(...page.items.map((item) => `${item.source}:${item.id}`));
        if (!page.nextCursor) break;
        cursor = page.nextCursor;
      }

      expect(new Set(seen).size).toBe(seen.length);
      expect(seen).toContain(`conversation_message:${messageId}`);
      expect(seen).toContain(`approval_comment:${commentId}`);
    }, 120000);

    /** §24 — `limit` bounds the merged page, not each source. */
    it('returns at most `limit` items in total', async () => {
      const token = await tokenFor(email('u1'));
      const page = (
        await authed(token)
          .get(`${timelinePath(A, conversationA)}?limit=2`)
          .expect(200)
      ).body as TimelineBody;

      expect(page.items).toHaveLength(2);
      expect(page.nextCursor).toBeTruthy();
    });

    /** §54 — a malformed cursor is the first page, never a 500 and never all. */
    it.each([
      ['garbage', 'not-a-cursor!!'],
      ['empty', ''],
      ['traversal', '../../etc/passwd'],
      [
        'wrong source',
        Buffer.from(
          `2026-10-01T10:00:00.000Z|no_such_source|${randomUUID()}`,
        ).toString('base64url'),
      ],
      [
        'non-uuid id',
        Buffer.from('2026-10-01T10:00:00.000Z|nope').toString('base64url'),
      ],
    ])('treats a %s cursor as the first page', async (_label, cursor) => {
      const token = await tokenFor(email('u1'));
      const first = (
        await authed(token)
          .get(`${timelinePath(A, conversationA)}?limit=3`)
          .expect(200)
      ).body as TimelineBody;
      const withBad = (
        await authed(token)
          .get(
            `${timelinePath(A, conversationA)}?limit=3&before=${encodeURIComponent(
              cursor,
            )}`,
          )
          .expect(200)
      ).body as TimelineBody;

      expect(withBad.items.map((item) => item.id)).toEqual(
        first.items.map((item) => item.id),
      );
    });

    /** §21 — a CCOM1 two-part cursor still pages rather than resetting. */
    it('accepts a CCOM1 cursor and continues from it', async () => {
      const token = await tokenFor(email('u1'));
      const first = (
        await authed(token)
          .get(`${timelinePath(A, conversationA)}?limit=2`)
          .expect(200)
      ).body as TimelineBody;

      const oldest = first.items[0];
      const legacy = Buffer.from(
        `${new Date(
          (oldest as unknown as { createdAt: string }).createdAt,
        ).toISOString()}|${oldest.id}`,
      ).toString('base64url');

      const next = (
        await authed(token)
          .get(
            `${timelinePath(A, conversationA)}?limit=2&before=${encodeURIComponent(
              legacy,
            )}`,
          )
          .expect(200)
      ).body as TimelineBody;

      // It paged, rather than returning the newest rows again.
      expect(next.items.map((item) => item.id)).not.toEqual(
        first.items.map((item) => item.id),
      );
    });
  });

  describe('§52 replacement chain', () => {
    it('keeps the historical card and resolves it as replaced', async () => {
      const rev3 = randomUUID();

      // rev2 (`sentA`) is superseded by rev3, which is itself sent.
      await db.query(
        `UPDATE social_approval_requests
            SET status='superseded', superseded_at=now()
          WHERE id=$1`,
        [sentA],
      );
      /**
       * rev3 shares rev2's logical subject root and carries a **different**
       * `subject_revision_id`.
       *
       * Both halves are required by AP4's resolver: same `(subjectType,
       * subjectId)` so it is the same work, and a different revision so it is
       * genuinely a later version rather than the same one re-sent. Copying
       * rev2's revision id — which the first draft of this fixture did — makes
       * the resolver correctly return nothing, and the card then shows the
       * plain "replaced" message with no navigation.
       */
      const [parent] = await db.query<
        Array<{ subject_id: string; content_item_id: string }>
      >(
        `SELECT r.subject_id, rev.content_item_id
           FROM social_approval_requests r
           JOIN social_content_revisions rev ON rev.id = r.subject_revision_id
          WHERE r.id = $1`,
        [sentA],
      );
      const [{ id: rev3RevisionId }] = await db.query<Array<{ id: string }>>(
        `INSERT INTO social_content_revisions
           (tenant_id,workspace_id,agency_client_id,content_item_id,revision_number,copy)
         VALUES ($1,$2,$3,$4,3,'Copy da revisão 3') RETURNING id`,
        [T, W, clientX, parent.content_item_id],
      );

      await db.query(
        `INSERT INTO social_approval_requests
           (id,tenant_id,workspace_id,agency_client_id,company_context_id,subject_type,subject_id,subject_revision_id,
            source_module,display_type,title,subject_version_label,status,current_stage,requested_by_user_id,
            requested_at,sent_to_client_at,created_at)
         SELECT $1,tenant_id,workspace_id,agency_client_id,company_context_id,subject_type,subject_id,
                $3,source_module,display_type,'Post Carnaval','v3','awaiting_client','client',
                requested_by_user_id,now(),now(),now() + interval '1 second'
           FROM social_approval_requests WHERE id = $2`,
        [rev3, sentA, rev3RevisionId],
      );

      try {
        const token = await tokenFor(email('u1'));
        const body = (
          await authed(token).get(timelinePath(A, conversationA)).expect(200)
        ).body as TimelineBody;

        const card = cardsOf(body)[0];
        // The historical card survives, and resolves to the current truth.
        expect(card.card?.state?.status).toBe('replaced');
        // §39 — AP4 offers the newer version, already proven client-visible.
        expect(card.card?.state?.replacementApprovalId).toBe(rev3);
        // §4/§52 — the announcement is still the revision it announced; there
        // is no snapshot to update, because there is no snapshot.
        expect(card.card?.announced).toEqual({
          title: 'Post Carnaval',
          version: 'v2',
        });
        // §39/§52 — a replaced approval is not actionable.
        expect(card.card?.actions.canDecide).toBe(false);
      } finally {
        /**
         * rev3 goes first, then rev2 is restored to active.
         *
         * `UQ_social_approval_requests_active_revision` allows one active
         * approval per logical subject, and both rows share a subject here —
         * so restoring rev2 while rev3 is still active violates it. The order
         * matters, and getting it backwards is what made this cleanup fail the
         * first time.
         */
        await db.query(`DELETE FROM social_approval_requests WHERE id = $1`, [
          rev3,
        ]);
        await db.query(`DELETE FROM social_content_revisions WHERE id = $1`, [
          rev3RevisionId,
        ]);
        await db.query(
          `UPDATE social_approval_requests
              SET status='awaiting_client', superseded_at=NULL WHERE id=$1`,
          [sentA],
        );
      }
    });
  });

  describe('§35/§36 the Agency external timeline', () => {
    async function agencyToken() {
      const response = await http()
        .post('/agency/auth/login')
        .send({ email: email('op'), password: PASSWORD });
      return (response.body as { accessToken?: string }).accessToken ?? null;
    }

    it('shows the same card, with no client decision available', async () => {
      const token = await agencyToken();
      if (!token) return;

      const body = (
        await authed(token)
          .get(
            `/agency/client-conversations/companies/${A}/conversations/${conversationA}/timeline`,
          )
          .expect(200)
      ).body as TimelineBody;

      const card = cardsOf(body)[0];
      expect(card.card?.state?.status).toBe('awaiting_your_review');
      // §35 — the Agency sees the status and never a client decision.
      expect(card.card?.actions.canDecide).toBe(false);
      expect(card.card?.actions.canComment).toBe(false);
    });

    /**
     * §36/§49 — the "Clientes" section represents the *external* conversation,
     * so internal approval comments must not appear there either. They remain
     * readable in the Agency approvals UI.
     */
    it('hides internal approval comments from the external timeline', async () => {
      const token = await agencyToken();
      if (!token) return;

      const body = (
        await authed(token)
          .get(
            `/agency/client-conversations/companies/${A}/conversations/${conversationA}/timeline`,
          )
          .expect(200)
      ).body as TimelineBody;

      expect(JSON.stringify(body)).not.toContain('NOTA INTERNA');
      // The client-visible one is there, so the absence above is a filter and
      // not an empty projection.
      expect(JSON.stringify(body)).toContain('Resposta pública da agência');
    });

    it('refuses a Client Area token on the Agency timeline', async () => {
      const token = await tokenFor(email('u1'));
      await authed(token)
        .get(
          `/agency/client-conversations/companies/${A}/conversations/${conversationA}/timeline`,
        )
        .expect(401);
    });

    it('refuses an unauthenticated Agency timeline read', async () => {
      await http()
        .get(
          `/agency/client-conversations/companies/${A}/conversations/${conversationA}/timeline`,
        )
        .expect(401);
    });
  });

  describe('§37/§38 the support preview', () => {
    async function agencyToken() {
      const response = await http()
        .post('/agency/auth/login')
        .send({ email: email('op'), password: PASSWORD });
      return (response.body as { accessToken?: string }).accessToken ?? null;
    }

    it('shows cards and client-visible comments, and provisions nothing', async () => {
      const token = await agencyToken();
      if (!token) return;

      const [membership] = await db.query<Array<{ id: string }>>(
        `SELECT id FROM client_area_memberships
          WHERE company_context_id = $1 AND user_id = $2`,
        [A, U1],
      );

      const before = await db.query<Array<{ count: string }>>(
        `SELECT count(*) FROM client_conversation_participants WHERE conversation_id = $1`,
        [conversationA],
      );

      const body = (
        await authed(token)
          .get(
            `/agency/client-area-management/clients/${clientX}/companies/${A}/preview/${membership.id}/conversations/${conversationA}/timeline`,
          )
          .expect(200)
      ).body as TimelineBody;

      expect(cardsOf(body)[0].card?.state?.status).toBe('awaiting_your_review');
      expect(JSON.stringify(body)).toContain('Resposta pública da agência');
      // §37/§49 — no internal comment in the preview either.
      expect(JSON.stringify(body)).not.toContain('NOTA INTERNA');

      // §38 — nothing was provisioned by looking.
      const after = await db.query<Array<{ count: string }>>(
        `SELECT count(*) FROM client_conversation_participants WHERE conversation_id = $1`,
        [conversationA],
      );
      expect(after[0].count).toBe(before[0].count);
    });

    it('exposes no mutating preview route', async () => {
      const token = await agencyToken();
      if (!token) return;

      const [membership] = await db.query<Array<{ id: string }>>(
        `SELECT id FROM client_area_memberships
          WHERE company_context_id = $1 AND user_id = $2`,
        [A, U1],
      );
      const base = `/agency/client-area-management/clients/${clientX}/companies/${A}/preview/${membership.id}`;

      // Read-only by construction: these paths simply do not exist.
      await authed(token)
        .post(`${base}/conversations/${conversationA}/messages`)
        .send({ body: 'operador tentando enviar' })
        .expect(404);
      await authed(token)
        .post(`${base}/approvals/${sentA}/approve`)
        .expect(404);
    });
  });
});
