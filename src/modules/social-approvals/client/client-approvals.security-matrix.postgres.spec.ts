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
} from '../../../config/typeorm.config';
import { CreateClientAreaMemberships1797000000000 } from '../../../database/migrations/1797000000000-create-client-area-memberships';
import { CreateClientAreaInvitations1797100000000 } from '../../../database/migrations/1797100000000-create-client-area-invitations';
import { CreateClientAreaManagement1797150000000 } from '../../../database/migrations/1797150000000-create-client-area-management';
import { AddCompanyBrandIdentityFoundation1797160000000 } from '../../../database/migrations/1797160000000-add-company-brand-identity-foundation';
import { CreateClientAreaCrmIdentityRelationships1797300000000 } from '../../../database/migrations/1797300000000-create-client-area-crm-identity-relationships';
import { AddSocialApprovalCommentVisibility1797400000000 } from '../../../database/migrations/1797400000000-add-social-approval-comment-visibility';
import { assertSafePostgresTarget } from '../../../testing/postgres-integration-guard';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { AgencyAuthModule } from '../../agency/agency-auth.module';
import { JwtStrategy } from '../../auth/strategies/jwt.strategy';
import { ClientAreaModule } from '../../client-area/client-area.module';
import { ClientAreaMembershipService } from '../../client-area/services/client-area-membership.service';
import { ClientAreaRateLimitService } from '../../client-area/services/client-area-rate-limit.service';
import { EmailModule } from '../../email/email.module';
import { EmailService } from '../../email/email.service';
import { ClientAreaApprovalsModule } from './client-approvals.module';

// Same contract as otplib v13 (async, resolves `{ valid }`).
jest.mock('otplib', () => ({
  verify: jest.fn(({ token }: { token: string }) =>
    Promise.resolve({ valid: token === '424242' }),
  ),
}));

const run = describePostgresIntegration();

const PASSWORD = 'Senha-forte-AP3!';
const AGENCY_SECRET = 'agency-access-secret-ap3-matrix-00000000';
const CLIENT_SECRET = 'client-area-secret-ap3-matrix-1111111111';

@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class FakeEmailModule {}

type ListBody = {
  items: Array<{
    id: string;
    status: string;
    needsYou: boolean;
    versionLabel: string;
  }>;
};
type DetailBody = {
  id: string;
  status: string;
  versionLabel: string;
  comments: Array<{ body: string; author: { name: string; side: string } }>;
  history: Array<{ kind: string }>;
  actions: { canComment: boolean; canDecide: boolean };
  preview: { format: string; text?: { copy: string | null } };
};

/**
 * AP3 §60–§65 — the Client Area approvals surface against a real database,
 * through the real guards and the real controller.
 *
 * Fixture (CA0 shape, extended for AP3):
 *   U1  client_viewer    → Company A
 *   U2  client_operator  → Company A
 *   U3  client_admin     → Company B
 */
run('AP3 Client Approvals security matrix (PostgreSQL, real guards)', () => {
  let app: INestApplication;
  let db: DataSource;
  let memberships: ClientAreaMembershipService;
  const savedEnv = { ...process.env };

  const runId = randomUUID().slice(0, 8);
  const email = (label: string) => `${label}.${runId}@ap3-spec.example.com`;

  const T = randomUUID(),
    W = randomUUID();
  const MX = randomUUID(),
    MY = randomUUID();
  const orgA = randomUUID(),
    orgB = randomUUID();
  const X = randomUUID(),
    Y = randomUUID();
  const A = randomUUID(),
    B = randomUUID();
  const U1 = randomUUID(),
    U2 = randomUUID(),
    U3 = randomUUID(),
    OP = randomUUID();

  // Approvals: sentA/approvedA/replacedA are visible in A; draftA never was
  // sent; approvalB belongs to Company B.
  const sentA = randomUUID(),
    draftA = randomUUID(),
    approvedA = randomUUID(),
    replacedA = randomUUID(),
    approvalB = randomUUID();

  let membershipU1 = '';
  let passwordHash = '';

  /** Links a person Contact to a company, the CA4 way. */
  async function crmLink(
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
    return personContactId;
  }

  /**
   * A complete, throwaway Company A member: identity, profile, membership
   * and CRM chain. Used by the cases that break one link of the chain, so
   * the shared U1/U2/U3 fixture is never mutated.
   */
  async function disposableMember(label: string) {
    const userId = randomUUID();
    const address = email(label);
    await db.query(
      `INSERT INTO user_security_settings
         (tenant_id,user_id,current_email,password_hash,two_factor_enabled,login_alerts_enabled)
       VALUES ($1,$2,$3,$4,false,false)`,
      [T, userId, address, passwordHash],
    );
    await db.query(
      `INSERT INTO user_profile (tenant_id,user_id,display_name,email)
       VALUES ($1,$2,$3,$4)`,
      [T, userId, `Cliente ${label}`, address],
    );
    await memberships.grant({
      tenantId: T,
      companyContextId: A,
      userId,
      role: 'client_viewer',
      grantedByUserId: OP,
    });
    const personContactId = await crmLink(userId, address, orgA);
    return { userId, token: await tokenFor(address), personContactId };
  }

  const http = () => request(app.getHttpServer());
  const authed = (path: string, token: string) =>
    http().get(path).set('Authorization', `Bearer ${token}`);
  const post = (path: string, token: string) =>
    http().post(path).set('Authorization', `Bearer ${token}`);
  const approvalsPath = (company: string, suffix = '') =>
    `/client-area/companies/${company}/approvals${suffix}`;

  async function tokenFor(address: string) {
    const response = await http()
      .post('/client-area/auth/login')
      .send({ email: address, password: PASSWORD })
      .expect(200);
    return (response.body as { accessToken: string }).accessToken;
  }

  /**
   * A real Planner subject behind the approval. The preview resolves the
   * immutable `subject_revision_id` against these rows, so an approval with
   * no backing plan/item/revision is not a shortcut — it simply has no
   * preview, and the detail route would fail exactly as it should.
   */
  async function seedPlannerSubject(
    companyContextId: string,
    agencyClientId: string,
    copy: string,
  ) {
    const [{ id: planId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO social_plans
         (tenant_id,workspace_id,agency_client_id,company_context_id,title,period_start,period_end,status)
       VALUES ($1,$2,$3,$4,'Plano AP3','2026-01-01','2026-01-31','active') RETURNING id`,
      [T, W, agencyClientId, companyContextId],
    );
    const [{ id: itemId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO social_content_items
         (tenant_id,workspace_id,agency_client_id,plan_id,title,planning_status)
       VALUES ($1,$2,$3,$4,'Conteúdo AP3','planned') RETURNING id`,
      [T, W, agencyClientId, planId],
    );
    const [{ id: revisionId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO social_content_revisions
         (tenant_id,workspace_id,agency_client_id,content_item_id,revision_number,copy)
       VALUES ($1,$2,$3,$4,2,$5) RETURNING id`,
      [T, W, agencyClientId, itemId, copy],
    );
    return { planId, itemId, revisionId };
  }

  async function seedApproval(
    id: string,
    companyContextId: string,
    agencyClientId: string,
    overrides: {
      status?: string;
      stage?: string;
      sentToClientAt?: string | null;
      approvedAt?: string | null;
      supersededAt?: string | null;
      title?: string;
      versionLabel?: string;
    } = {},
  ) {
    const subject = await seedPlannerSubject(
      companyContextId,
      agencyClientId,
      `Copy da revisão de ${overrides.title ?? 'Conteúdo'}`,
    );
    await db.query(
      `INSERT INTO social_approval_requests
         (id,tenant_id,workspace_id,agency_client_id,company_context_id,subject_type,subject_id,subject_revision_id,
          source_module,display_type,title,subject_version_label,status,current_stage,requested_by_user_id,
          requested_at,sent_to_client_at,approved_at,superseded_at)
       VALUES ($1,$2,$3,$4,$5,'planner_content_revision',$6,$7,'social_planner','content_revision',$8,$9,$10,$11,$12,
               now(),$13,$14,$15)`,
      [
        id,
        T,
        W,
        agencyClientId,
        companyContextId,
        subject.itemId,
        subject.revisionId,
        overrides.title ?? 'Conteúdo',
        overrides.versionLabel ?? 'r1',
        overrides.status ?? 'awaiting_client',
        overrides.stage ?? 'client',
        OP,
        // `??` would turn an intentional null into the default date, which is
        // exactly the "never sent" case these fixtures exist to express.
        overrides.sentToClientAt === undefined
          ? new Date('2026-01-02T10:00:00Z').toISOString()
          : overrides.sentToClientAt,
        overrides.approvedAt ?? null,
        overrides.supersededAt ?? null,
      ],
    );
  }

  /**
   * AP4 §32 — a genuine *same subject root, later revision* approval, as the
   * replacement resolver requires. Unlike `seedApproval` (which always seeds
   * a brand-new Planner item, i.e. a brand-new root), this reuses an existing
   * approval's `subject_id` with a fresh `subject_revision_id`, the way
   * `SocialApprovalsService.create()` actually produces a replacement.
   */
  async function seedReplacementRevision(
    id: string,
    of: string,
    overrides: {
      status?: string;
      stage?: string;
      sentToClientAt?: string | null;
      versionLabel?: string;
      createdAtOffset?: string;
    } = {},
  ) {
    const [existing] = await db.query<
      Array<{
        company_context_id: string;
        agency_client_id: string;
        subject_id: string;
        title: string;
      }>
    >(
      `SELECT company_context_id, agency_client_id, subject_id, title
         FROM social_approval_requests WHERE id = $1`,
      [of],
    );
    const [{ next_number: nextNumber }] = await db.query<
      Array<{ next_number: number }>
    >(
      `SELECT COALESCE(MAX(revision_number), 0) + 1 AS next_number
         FROM social_content_revisions WHERE content_item_id = $1`,
      [existing.subject_id],
    );
    const [{ id: revisionId }] = await db.query<Array<{ id: string }>>(
      `INSERT INTO social_content_revisions
         (tenant_id,workspace_id,agency_client_id,content_item_id,revision_number,copy)
       VALUES ($1,$2,$3,$4,$5,'Copy da revisão seguinte') RETURNING id`,
      [T, W, existing.agency_client_id, existing.subject_id, nextNumber],
    );
    await db.query(
      `INSERT INTO social_approval_requests
         (id,tenant_id,workspace_id,agency_client_id,company_context_id,subject_type,subject_id,subject_revision_id,
          source_module,display_type,title,subject_version_label,status,current_stage,requested_by_user_id,
          requested_at,sent_to_client_at,created_at)
       VALUES ($1,$2,$3,$4,$5,'planner_content_revision',$6,$7,'social_planner','content_revision',$8,$9,$10,$11,$12,
               now(),$13,now() + ($14)::interval)`,
      [
        id,
        T,
        W,
        existing.agency_client_id,
        existing.company_context_id,
        existing.subject_id,
        revisionId,
        existing.title,
        overrides.versionLabel ?? 'r2',
        overrides.status ?? 'awaiting_client',
        overrides.stage ?? 'client',
        OP,
        overrides.sentToClientAt === undefined
          ? new Date('2026-01-07T10:00:00Z').toISOString()
          : overrides.sentToClientAt,
        overrides.createdAtOffset ?? '1 hour',
      ],
    );
  }

  beforeAll(async () => {
    process.env.JWT_ACCESS_SECRET = AGENCY_SECRET;
    process.env.JWT_CLIENT_AREA_ACCESS_SECRET = CLIENT_SECRET;
    process.env.CLIENT_AREA_ENABLED = 'true';
    delete process.env.JWT_2FA_SECRET;

    const moduleRef = await Test.createTestingModule({
      imports: [
        ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
        // Both connections, as the real application has: the approvals module
        // pulls in PermissionsModule, whose entities live on the default
        // (core) connection while everything AP3 touches is on 'agency'.
        TypeOrmModule.forRoot(getTypeOrmConfig()),
        TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
        PassportModule,
        AgencyAuthModule,
        ClientAreaModule,
        ClientAreaApprovalsModule,
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
      // AP3 — the comment audience column and the client notification ledger.
      await new AddSocialApprovalCommentVisibility1797400000000().up(runner);
    } finally {
      await runner.release();
    }

    passwordHash = await argon2.hash(PASSWORD);
    await db.query(
      `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name) VALUES
        ($1,$3,$4,'organization','Empresa A'),($2,$3,$4,'organization','Empresa B')`,
      [orgA, orgB, T, W],
    );
    await db.query(
      `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name,managed_tenant_id) VALUES
        ($1,$3,$4,$5,'Interno X',$7),($2,$3,$4,$6,'Interno Y',$8)`,
      [X, Y, T, W, orgA, orgB, MX, MY],
    );
    await db.query(
      `INSERT INTO agency_client_company_contexts (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES
        ($1,$3,$4,$5,$7,'active',true),($2,$3,$4,$6,$8,'active',true)`,
      [A, B, T, W, X, Y, orgA, orgB],
    );
    await db.query(
      `INSERT INTO client_area_settings (tenant_id,workspace_id,enabled) VALUES ($1,$2,true)`,
      [T, W],
    );
    await db.query(
      `INSERT INTO client_area_company_settings (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,approvals_enabled) VALUES
        ($1,$2,$3,$5,true,true),($1,$2,$4,$6,true,true)`,
      [T, W, X, Y, A, B],
    );
    await db.query(
      `INSERT INTO tenant_product_entitlements (tenant_id,product_key,status,source) VALUES
        ($1,'social','active','manual'),($2,'social','active','manual')`,
      [MX, MY],
    );

    for (const [user, label] of [
      [U1, 'u1'],
      [U2, 'u2'],
      [U3, 'u3'],
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
      `INSERT INTO user_profile (tenant_id,user_id,display_name,email) VALUES
        ($1,$2,'Joana Cliente',$5),($1,$3,'Bruno Cliente',$6),($1,$4,'Operadora Agência',$7)`,
      [T, U1, U2, OP, email('u1'), email('u2'), email('op')],
    );
    await db.query(
      `INSERT INTO user_profile (tenant_id,user_id,display_name,email) VALUES ($1,$2,'Carla Cliente',$3)`,
      [T, U3, email('u3')],
    );
    await db.query(
      `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES ($1,$2,$3,'Operadora',$4,'owner','active')`,
      [T, W, OP, email('op')],
    );

    const grant = (companyContextId: string, userId: string, role: string) =>
      memberships.grant({
        tenantId: T,
        companyContextId,
        userId,
        role,
        grantedByUserId: OP,
      });
    membershipU1 = (await grant(A, U1, 'client_viewer')).id;
    await grant(A, U2, 'client_operator');
    await grant(B, U3, 'client_admin');

    await crmLink(U1, email('u1'), orgA);
    await crmLink(U2, email('u2'), orgA);
    await crmLink(U3, email('u3'), orgB);

    await seedApproval(sentA, A, X, { title: 'Enviado A', versionLabel: 'r2' });
    await seedApproval(draftA, A, X, {
      title: 'Rascunho interno A',
      status: 'draft',
      stage: 'internal',
      sentToClientAt: null,
    });
    await seedApproval(approvedA, A, X, {
      title: 'Aprovado A',
      status: 'approved',
      approvedAt: new Date('2026-01-05T10:00:00Z').toISOString(),
    });
    await seedApproval(replacedA, A, X, {
      title: 'Substituído A',
      status: 'superseded',
      supersededAt: new Date('2026-01-06T10:00:00Z').toISOString(),
    });
    await seedApproval(approvalB, B, Y, { title: 'Peça da Empresa B' });
  }, 60_000);

  beforeEach(() => app.get(ClientAreaRateLimitService).reset());

  afterAll(async () => {
    try {
      if (db?.isInitialized) {
        assertSafePostgresTarget();
        // AP1 makes approval history append-only with a BEFORE DELETE
        // trigger. That guarantee is the point in production and simply has
        // to be lifted to clean a disposable test database; the guard above
        // has already proved which database this is.
        for (const [table, trigger] of [
          [
            'social_approval_stage_decisions',
            'TRG_social_approval_decisions_append_only',
          ],
          [
            'social_approval_comments',
            'TRG_social_approval_comments_append_only',
          ],
        ]) {
          await db.query(`ALTER TABLE "${table}" DISABLE TRIGGER "${trigger}"`);
          await db.query(
            `DELETE FROM "${table}" WHERE approval_request_id IN
               (SELECT id FROM social_approval_requests WHERE tenant_id = $1)`,
            [T],
          );
          await db.query(`ALTER TABLE "${table}" ENABLE TRIGGER "${trigger}"`);
        }
        for (const table of [
          'client_area_approval_notifications',
          'client_area_member_events',
          'client_area_invitations',
          'client_area_identity_contacts',
          'contact_company_links',
          'contact_methods',
          'client_area_memberships',
          'client_area_company_settings',
          'client_area_settings',
          'social_approval_requests',
          'social_content_revisions',
          'social_content_items',
          'social_plans',
          'user_sessions',
          'user_login_events',
          'user_security_settings',
          'user_profile',
          'workspace_users',
          'agency_client_company_contexts',
          'agency_clients',
          'contacts',
        ]) {
          await db.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [T]);
        }
        await db.query(
          `DELETE FROM tenant_product_entitlements WHERE tenant_id = ANY($1::uuid[])`,
          [[MX, MY]],
        );
      }
    } finally {
      await app?.close();
      process.env = { ...savedEnv };
    }
  });

  describe('§60 visibility and company isolation', () => {
    it('U1 lists only Company A approvals that actually reached the client', async () => {
      const token = await tokenFor(email('u1'));
      const body = (await authed(approvalsPath(A), token).expect(200))
        .body as ListBody;

      const ids = body.items.map((item) => item.id);
      expect(ids).toContain(sentA);
      expect(ids).toContain(approvedA);
      expect(ids).toContain(replacedA);
      // Never sent: invisible whatever its id.
      expect(ids).not.toContain(draftA);
      // Another company entirely.
      expect(ids).not.toContain(approvalB);
    });

    it('U1 cannot reach Company B at all', async () => {
      const token = await tokenFor(email('u1'));
      await authed(approvalsPath(B), token).expect(404);
    });

    it('U3 cannot reach Company A', async () => {
      const token = await tokenFor(email('u3'));
      await authed(approvalsPath(A), token).expect(404);
    });

    it('a forged approval id does not authorize, and neither does a real id from another company', async () => {
      const token = await tokenFor(email('u1'));
      await authed(approvalsPath(A, `/${randomUUID()}`), token).expect(404);
      // A genuine approval, but of Company B, requested through Company A.
      await authed(approvalsPath(A, `/${approvalB}`), token).expect(404);
      // The real id of Company B's approval through Company B still fails:
      // U1 has no membership there.
      await authed(approvalsPath(B, `/${approvalB}`), token).expect(404);
    });

    it('an unsent approval is not readable by id either', async () => {
      const token = await tokenFor(email('u1'));
      await authed(approvalsPath(A, `/${draftA}`), token).expect(404);
    });

    /**
     * Each revocation case gets a throwaway identity. Mutating the shared
     * U1/U2/U3 fixture would leak into every later test in declaration order,
     * and re-granting is not a clean undo (a new membership id, a dead
     * session, a fresh audit trail).
     */
    it('a revoked membership stops working immediately', async () => {
      const { token } = await disposableMember('revoked');
      await authed(approvalsPath(A), token).expect(200);

      const [row] = await db.query<Array<{ id: string }>>(
        `SELECT id FROM client_area_memberships
          WHERE tenant_id = $1 AND user_id = (
            SELECT user_id FROM user_security_settings
             WHERE tenant_id = $1 AND current_email = $2)
            AND status = 'active'`,
        [T, email('revoked')],
      );
      await memberships.revoke({
        tenantId: T,
        membershipId: row.id,
        revokedByUserId: OP,
      });

      // 401, not 404: revoking the person's last membership also revokes
      // their Client Area sessions (CA2), so the token dies before the
      // company check is even reached. Either way the approvals are gone.
      await authed(approvalsPath(A), token).expect(401);
    });

    it('an archived CRM person fails even with an active membership', async () => {
      const { token, personContactId } = await disposableMember('archived');
      await authed(approvalsPath(A), token).expect(200);

      await db.query(`UPDATE contacts SET status = 'archived' WHERE id = $1`, [
        personContactId,
      ]);

      await authed(approvalsPath(A), token).expect(404);
    });

    it('removing the PF↔company relationship fails the request', async () => {
      const { token, personContactId } = await disposableMember('unlinked');
      await authed(approvalsPath(A), token).expect(200);

      // `unlinked_at` is required for any non-active status
      // (CK_contact_company_links_validity).
      await db.query(
        `UPDATE contact_company_links
            SET status = 'inactive', unlinked_at = now()
          WHERE tenant_id = $1 AND person_contact_id = $2`,
        [T, personContactId],
      );

      await authed(approvalsPath(A), token).expect(404);
    });

    it('rejects a request with no Client Area token', async () => {
      await http().get(approvalsPath(A)).expect(401);
    });
  });

  describe('§60 permissions by role', () => {
    it('a viewer may view and comment but may not decide', async () => {
      const token = await tokenFor(email('u1'));

      await authed(approvalsPath(A, `/${sentA}`), token).expect(200);
      await post(approvalsPath(A, `/${sentA}/comments`), token)
        .send({ body: 'Comentário do visualizador' })
        .expect(201);
      await post(approvalsPath(A, `/${sentA}/approve`), token).expect(403);
      await post(approvalsPath(A, `/${sentA}/request-changes`), token)
        .send({ body: 'Trocar imagem' })
        .expect(403);
    });

    it('the detail tells a viewer it cannot decide', async () => {
      const token = await tokenFor(email('u1'));
      const detail = (
        await authed(approvalsPath(A, `/${sentA}`), token).expect(200)
      ).body as DetailBody;

      expect(detail.actions).toEqual({ canComment: true, canDecide: false });
    });

    it('an operator of the same company may decide', async () => {
      const token = await tokenFor(email('u2'));
      const detail = (
        await authed(approvalsPath(A, `/${sentA}`), token).expect(200)
      ).body as DetailBody;

      expect(detail.actions).toEqual({ canComment: true, canDecide: true });
    });
  });

  describe('§64 view tracking', () => {
    it('records first/last viewed and the viewer without changing status', async () => {
      const token = await tokenFor(email('u1'));

      await post(approvalsPath(A, `/${sentA}/view`), token).expect(201);
      const [first] = await db.query<
        Array<{
          client_first_viewed_at: Date;
          client_last_viewed_at: Date;
          client_viewed_by_user_id: string;
          status: string;
        }>
      >(
        `SELECT client_first_viewed_at, client_last_viewed_at, client_viewed_by_user_id, status
           FROM social_approval_requests WHERE id = $1`,
        [sentA],
      );

      expect(first.client_first_viewed_at).not.toBeNull();
      expect(first.client_viewed_by_user_id).toBe(U1);
      // A view is not a decision.
      expect(first.status).toBe('awaiting_client');

      await post(approvalsPath(A, `/${sentA}/view`), token).expect(201);
      const [second] = await db.query<
        Array<{ client_first_viewed_at: Date; client_last_viewed_at: Date }>
      >(
        `SELECT client_first_viewed_at, client_last_viewed_at
           FROM social_approval_requests WHERE id = $1`,
        [sentA],
      );

      // First is sticky, last moves forward.
      expect(second.client_first_viewed_at.toISOString()).toBe(
        first.client_first_viewed_at.toISOString(),
      );
      expect(second.client_last_viewed_at.getTime()).toBeGreaterThanOrEqual(
        first.client_last_viewed_at.getTime(),
      );

      const decisions = await db.query<Array<{ id: string }>>(
        `SELECT id FROM social_approval_stage_decisions WHERE approval_request_id = $1`,
        [sentA],
      );
      expect(decisions).toHaveLength(0);
    });
  });

  describe('§61 comment visibility', () => {
    it('hides an Agency internal comment written during awaiting_client', async () => {
      await db.query(
        `INSERT INTO social_approval_comments
           (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
         VALUES ($1,'client','internal','user',$2,$3)`,
        [sentA, OP, 'NOTA INTERNA: renegociar prazo'],
      );

      const token = await tokenFor(email('u1'));
      const detail = (
        await authed(approvalsPath(A, `/${sentA}`), token).expect(200)
      ).body as DetailBody;

      const bodies = detail.comments.map((comment) => comment.body);
      expect(bodies).not.toContain('NOTA INTERNA: renegociar prazo');
      expect(JSON.stringify(detail)).not.toContain('NOTA INTERNA');
    });

    it('a client comment is stored as client-visible and attributed to the real user', async () => {
      const token = await tokenFor(email('u1'));
      await post(approvalsPath(A, `/${sentA}/comments`), token)
        .send({ body: 'Comentário visível do cliente' })
        .expect(201);

      const [row] = await db.query<
        Array<{
          visibility: string;
          stage: string;
          actor_type: string;
          actor_user_id: string;
        }>
      >(
        `SELECT visibility, stage, actor_type, actor_user_id
           FROM social_approval_comments
          WHERE approval_request_id = $1 AND body = $2`,
        [sentA, 'Comentário visível do cliente'],
      );

      expect(row).toMatchObject({
        visibility: 'client',
        stage: 'client',
        actor_type: 'user',
        actor_user_id: U1,
      });
    });

    it('shows the client its own comment and labels an agency reply without naming the operator', async () => {
      await db.query(
        `INSERT INTO social_approval_comments
           (approval_request_id,stage,visibility,actor_type,actor_user_id,body)
         VALUES ($1,'client','client','user',$2,$3)`,
        [sentA, OP, 'Resposta pública da agência'],
      );

      const token = await tokenFor(email('u1'));
      const detail = (
        await authed(approvalsPath(A, `/${sentA}`), token).expect(200)
      ).body as DetailBody;

      const reply = detail.comments.find(
        (comment) => comment.body === 'Resposta pública da agência',
      );
      expect(reply?.author).toEqual({
        name: 'Equipe da agência',
        side: 'agency',
      });
      expect(JSON.stringify(detail)).not.toContain('Operadora Agência');
      expect(JSON.stringify(detail)).not.toContain(OP);
    });
  });

  describe('§65 decisions', () => {
    it('approve moves awaiting_client to approved and closes the actions', async () => {
      const target = randomUUID();
      await seedApproval(target, A, X, { title: 'Para aprovar' });

      const token = await tokenFor(email('u2'));
      const detail = (
        await post(approvalsPath(A, `/${target}/approve`), token).expect(201)
      ).body as DetailBody;

      expect(detail.status).toBe('approved');
      expect(detail.actions).toEqual({ canComment: false, canDecide: false });

      const [row] = await db.query<
        Array<{ status: string; approved_at: Date }>
      >(
        `SELECT status, approved_at FROM social_approval_requests WHERE id = $1`,
        [target],
      );
      expect(row.status).toBe('approved');
      expect(row.approved_at).not.toBeNull();

      const [decision] = await db.query<
        Array<{ stage: string; decision: string; actor_user_id: string }>
      >(
        `SELECT stage, decision, actor_user_id FROM social_approval_stage_decisions
          WHERE approval_request_id = $1`,
        [target],
      );
      expect(decision).toMatchObject({
        stage: 'client',
        decision: 'approved',
        actor_user_id: U2,
      });
    });

    it('a second decision on the same approval is refused', async () => {
      const target = randomUUID();
      await seedApproval(target, A, X, { title: 'Decidir uma vez' });
      const token = await tokenFor(email('u2'));

      await post(approvalsPath(A, `/${target}/approve`), token).expect(201);
      await post(approvalsPath(A, `/${target}/approve`), token).expect(409);
      await post(approvalsPath(A, `/${target}/request-changes`), token)
        .send({ body: 'Tarde demais' })
        .expect(409);
    });

    it('request-changes requires a reason and records it as client-visible', async () => {
      const target = randomUUID();
      await seedApproval(target, A, X, { title: 'Para ajustar' });
      const token = await tokenFor(email('u2'));

      await post(approvalsPath(A, `/${target}/request-changes`), token)
        .send({})
        .expect(400);
      await post(approvalsPath(A, `/${target}/request-changes`), token)
        .send({ body: '   ' })
        .expect(400);

      const detail = (
        await post(approvalsPath(A, `/${target}/request-changes`), token)
          .send({ body: 'Trocar a foto principal' })
          .expect(201)
      ).body as DetailBody;

      // The customer sees "the agency is working on it", not the internal state.
      expect(detail.status).toBe('in_revision');
      expect(
        detail.comments.some(
          (comment) => comment.body === 'Trocar a foto principal',
        ),
      ).toBe(true);

      const [comment] = await db.query<Array<{ visibility: string }>>(
        `SELECT visibility FROM social_approval_comments
          WHERE approval_request_id = $1 AND body = $2`,
        [target, 'Trocar a foto principal'],
      );
      expect(comment.visibility).toBe('client');
    });

    it('refuses a decision on a terminal or unsent approval', async () => {
      const token = await tokenFor(email('u2'));

      await post(approvalsPath(A, `/${approvedA}/approve`), token).expect(409);
      await post(approvalsPath(A, `/${replacedA}/approve`), token).expect(409);
      // Never sent: not found rather than conflict — it does not exist here.
      await post(approvalsPath(A, `/${draftA}/approve`), token).expect(404);
    });

    it('refuses a comment on a terminal approval', async () => {
      const token = await tokenFor(email('u1'));
      await post(approvalsPath(A, `/${approvedA}/comments`), token)
        .send({ body: 'Tarde demais' })
        .expect(409);
    });
  });

  describe('§8/§66 client projection', () => {
    it('projects the client vocabulary and leaks no internal identifier', async () => {
      const token = await tokenFor(email('u1'));
      const list = (await authed(approvalsPath(A), token).expect(200))
        .body as ListBody;

      const statuses = list.items.map((item) => item.status);
      expect(statuses).toEqual(
        expect.arrayContaining([
          'awaiting_your_review',
          'approved',
          'replaced',
        ]),
      );
      for (const raw of [
        'awaiting_client',
        'draft',
        'superseded',
        'cancelled',
      ]) {
        expect(statuses).not.toContain(raw);
      }

      const serialized = JSON.stringify(list);
      for (const secret of [T, W, X, A, OP]) {
        expect(serialized).not.toContain(secret);
      }
    });

    it('previews the immutable revision with the stored version label', async () => {
      const token = await tokenFor(email('u1'));
      const detail = (
        await authed(approvalsPath(A, `/${sentA}`), token).expect(200)
      ).body as DetailBody;

      expect(detail.versionLabel).toBe('r2');
      expect(detail.preview.format).toBe('text');
    });
  });

  describe('§32 AP4 replacement resolution security', () => {
    it('rev1 Company A superseded by rev2 Company A: the link is offered and resolves', async () => {
      const replacementId = randomUUID();
      await seedReplacementRevision(replacementId, replacedA);

      const token = await tokenFor(email('u1'));
      const detail = (
        await authed(approvalsPath(A, `/${replacedA}`), token).expect(200)
      ).body as DetailBody & { replacementApprovalId?: string };

      expect(detail.status).toBe('replaced');
      expect(detail.replacementApprovalId).toBe(replacementId);

      // The link actually navigates: opening the replacement id succeeds and
      // is itself visible to the same client.
      const next = (
        await authed(approvalsPath(A, `/${replacementId}`), token).expect(200)
      ).body as DetailBody;
      expect(next.id).toBe(replacementId);

      await db.query(`DELETE FROM social_approval_requests WHERE id = $1`, [
        replacementId,
      ]);
    });

    it('rev1 Company A is not linked to an unrelated approval of Company A', async () => {
      // `sentA` exists in Company A but shares no subject root with
      // `replacedA` — it must never be offered as a replacement.
      const token = await tokenFor(email('u1'));
      const detail = (
        await authed(approvalsPath(A, `/${replacedA}`), token).expect(200)
      ).body as DetailBody & { replacementApprovalId?: string };

      expect(detail.status).toBe('replaced');
      expect(detail.replacementApprovalId).toBeUndefined();
      expect(JSON.stringify(detail)).not.toContain(sentA);
    });

    it('rev1 Company A is never linked to a revision of Company B, even sharing a tenant', async () => {
      // `approvalB` lives entirely in Company B; proves the scope tuple, not
      // just subject type, gates the lookup.
      const token = await tokenFor(email('u1'));
      const detail = (
        await authed(approvalsPath(A, `/${replacedA}`), token).expect(200)
      ).body as DetailBody & { replacementApprovalId?: string };

      expect(detail.replacementApprovalId).not.toBe(approvalB);
      expect(JSON.stringify(detail)).not.toContain(approvalB);
    });

    it('a replacement that was never sent to the client is not offered', async () => {
      const internalOnlyId = randomUUID();
      await seedReplacementRevision(internalOnlyId, replacedA, {
        status: 'awaiting_internal_review',
        stage: 'internal',
        sentToClientAt: null,
      });

      const token = await tokenFor(email('u1'));
      const detail = (
        await authed(approvalsPath(A, `/${replacedA}`), token).expect(200)
      ).body as DetailBody & { replacementApprovalId?: string };

      expect(detail.replacementApprovalId).toBeUndefined();

      await db.query(`DELETE FROM social_approval_requests WHERE id = $1`, [
        internalOnlyId,
      ]);
    });

    it('a forged replacementApprovalId from the client is ignored: it is just another approval id, re-validated on its own merits', async () => {
      // The projection never trusts a client-supplied id — there is no route
      // that accepts one. The only way a client reaches any approval is by
      // id through `findVisible`, which re-proves scope + sent-to-client
      // every time, so "forging" a replacement id buys nothing beyond what a
      // guessed approval id already would.
      const token = await tokenFor(email('u1'));
      const tokenB = await tokenFor(email('u3'));

      // A Company-A client cannot open Company B's approval by guessing its
      // id, whether or not it was ever presented as a "replacement".
      await authed(approvalsPath(A, `/${approvalB}`), token).expect(404);
      // And Company B's own member cannot reach it through Company A's path.
      await authed(approvalsPath(A, `/${approvalB}`), tokenB).expect(404);
    });
  });

  describe('§63 support preview', () => {
    const previewPath = (suffix = '') =>
      `/agency/client-area-management/clients/${X}/companies/${A}/preview/${membershipU1}/approvals${suffix}`;

    it('refuses an unauthenticated Agency preview read', async () => {
      await http().get(previewPath()).expect(401);
    });

    it('never accepts a Client Area token on the preview boundary', async () => {
      const clientToken = await tokenFor(email('u1'));
      await authed(previewPath(), clientToken).expect(401);
    });

    it('exposes no mutation route under the preview boundary', async () => {
      const clientToken = await tokenFor(email('u1'));
      for (const suffix of [
        `/${sentA}/approve`,
        `/${sentA}/request-changes`,
        `/${sentA}/comments`,
        `/${sentA}/view`,
      ]) {
        // 404: no such handler exists at all (structurally read-only).
        await http()
          .post(previewPath(suffix))
          .set('Authorization', `Bearer ${clientToken}`)
          .expect(404);
      }
    });
  });
});
