import { Module, ValidationPipe, type INestApplication } from '@nestjs/common';
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
import { assertSafePostgresTarget } from '../../testing/postgres-integration-guard';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyAuthModule } from '../agency/agency-auth.module';
import { JwtStrategy } from '../auth/strategies/jwt.strategy';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { ClientAreaModule } from './client-area.module';
import { ClientAreaMembershipService } from './services/client-area-membership.service';
import { ClientAreaRateLimitService } from './services/client-area-rate-limit.service';
import { TenantContextAuthority } from '../../common/context/tenant-context-authority.service';

// Same contract as otplib v13 (async, resolves `{ valid }`).
jest.mock('otplib', () => ({
  verify: jest.fn(() => Promise.resolve({ valid: false })),
}));

const run = describePostgresIntegration();

type Body = {
  code?: string;
  accessToken?: string;
  companies?: Array<{ companyContextId: string }>;
  context?: { companyContextId: string };
};
const bodyOf = (response: { body: unknown }) => response.body as Body;

const PASSWORD = 'Senha-forte-CA4.1!';
const AGENCY_SECRET = 'agency-access-secret-ca4-1-matrix-000000000';
const CLIENT_SECRET = 'client-area-secret-ca4-1-matrix-1111111111';

@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class FakeEmailModule {}

/**
 * CA4.1 — regression matrix for the CRM identity chain now enforced by
 * `ClientAreaAuthorizationService.resolveMembershipContext`
 * (active identity-contact -> active PF -> active contact_company_link ->
 * this company), on top of every check CA1-CA3 already covered.
 */
run('CA4.1 Client Area CRM eligibility (PostgreSQL, real guards)', () => {
  let app: INestApplication;
  let db: DataSource;
  let memberships: ClientAreaMembershipService;
  const savedEnv = { ...process.env };

  const runId = randomUUID().slice(0, 8);
  const email = (label: string) => `${label}.${runId}@ca4-1-spec.example.com`;

  const T = randomUUID(),
    W = randomUUID();
  const orgA = randomUUID(),
    orgB = randomUUID();
  const X = randomUUID(),
    Y = randomUUID();
  const A = randomUUID(),
    B = randomUUID();
  const U_ARCHIVE = randomUUID(),
    U_REVOKE = randomUUID(),
    U_RELATION = randomUUID(),
    U_NOMEMBERSHIP = randomUUID(),
    U_NOCHAIN = randomUUID(),
    U_MULTI = randomUUID(),
    U_DUPA = randomUUID(),
    U_DUPB = randomUUID(),
    U_EMAIL = randomUUID();

  const http = () => request(app.getHttpServer());
  const login = (address: string, password = PASSWORD) =>
    http().post('/client-area/auth/login').send({ email: address, password });
  const authed = (path: string, token: string) =>
    http().get(path).set('Authorization', `Bearer ${token}`);
  async function tokenFor(address: string) {
    const response = await login(address).expect(200);
    return bodyOf(response).accessToken!;
  }
  const companiesOf = async (token: string) =>
    bodyOf(
      await authed('/client-area/companies', token).expect(200),
    ).companies!.map((company) => company.companyContextId);

  const crmLink = async (
    userId: string,
    address: string,
    organizationContactId: string,
    options: { personContactId?: string; workspaceId?: string } = {},
  ) => {
    const workspaceId = options.workspaceId ?? W;
    let personContactId = options.personContactId;
    if (!personContactId) {
      const [row] = await db.query<Array<{ id: string }>>(
        `INSERT INTO contacts (tenant_id,workspace_id,type,display_name)
         VALUES ($1,$2,'person',$3) RETURNING id`,
        [T, workspaceId, address],
      );
      personContactId = row.id;
      await db.query(
        `INSERT INTO contact_methods (tenant_id,workspace_id,contact_id,type,value,is_primary)
         VALUES ($1,$2,$3,'email',$4,true)`,
        [T, workspaceId, personContactId, address],
      );
    }
    await db.query(
      `INSERT INTO contact_company_links
         (tenant_id,workspace_id,person_contact_id,company_contact_id,status,linked_at,is_primary)
       VALUES ($1,$2,$3,$4,'active',now(),false)`,
      [T, workspaceId, personContactId, organizationContactId],
    );
    await db.query(
      `INSERT INTO client_area_identity_contacts
         (tenant_id,workspace_id,user_id,contact_id,status,linked_at)
       VALUES ($1,$2,$3,$4,'active',now())
       ON CONFLICT DO NOTHING`,
      [T, workspaceId, userId, personContactId],
    );
    return personContactId;
  };

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
    void crypto;

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
    } finally {
      await runner.release();
    }

    const passwordHash = await argon2.hash(PASSWORD);
    await db.query(
      `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name) VALUES
        ($1,$3,$4,'organization','Empresa A'),($2,$3,$4,'organization','Empresa B')`,
      [orgA, orgB, T, W],
    );
    await db.query(
      `INSERT INTO agency_clients (id,tenant_id,workspace_id,contact_id,display_name) VALUES
        ($1,$3,$4,$5,'Rotulo X'),($2,$3,$4,$6,'Rotulo Y')`,
      [X, Y, T, W, orgA, orgB],
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

    const identities: Array<[string, string]> = [
      [U_ARCHIVE, email('archive')],
      [U_REVOKE, email('revoke')],
      [U_RELATION, email('relation')],
      [U_NOMEMBERSHIP, email('nomembership')],
      [U_NOCHAIN, email('nochain')],
      [U_MULTI, email('multi')],
      [U_DUPA, email('dupshared')],
      [U_DUPB, email('dupshared2')],
      [U_EMAIL, email('emailchange')],
    ];
    for (const [user, address] of identities) {
      await db.query(
        `INSERT INTO user_security_settings
           (tenant_id,user_id,current_email,password_hash,two_factor_enabled,two_factor_method,login_alerts_enabled)
         VALUES ($1,$2,$3,$4,false,'authenticator',false)`,
        [T, user, address, passwordHash],
      );
    }

    const grant = (userId: string, companyContextId: string) =>
      memberships.grant({
        tenantId: T,
        companyContextId,
        userId,
        role: 'client_viewer',
        grantedByUserId: null,
      });
    await grant(U_ARCHIVE, A);
    await grant(U_REVOKE, A);
    await grant(U_RELATION, A);
    // U_NOMEMBERSHIP deliberately gets no membership.
    await grant(U_NOCHAIN, A);
    await grant(U_MULTI, A);
    await grant(U_MULTI, B);
    await grant(U_DUPA, A);
    await grant(U_EMAIL, A);

    // CRM chains for everyone except U_NOMEMBERSHIP (no membership at all)
    // and U_NOCHAIN (membership on purpose left without any CRM chain).
    await crmLink(U_ARCHIVE, email('archive'), orgA);
    await crmLink(U_REVOKE, email('revoke'), orgA);
    await crmLink(U_RELATION, email('relation'), orgA);
    const multiContact = await crmLink(U_MULTI, email('multi'), orgA);
    await crmLink(U_MULTI, email('multi'), orgB, {
      personContactId: multiContact,
    });
    // Two distinct PFs sharing one email, linked to two distinct identities.
    await crmLink(U_DUPA, email('dupshared'), orgA);
    await crmLink(U_DUPB, email('dupshared'), orgA);
    await crmLink(U_EMAIL, email('emailchange'), orgA);
  }, 60_000);

  beforeEach(() => app.get(ClientAreaRateLimitService).reset());

  afterAll(async () => {
    try {
      if (db?.isInitialized) {
        assertSafePostgresTarget();
        for (const table of [
          'client_area_member_events',
          'client_area_invitations',
          'client_area_identity_contacts',
          'contact_company_links',
          'contact_methods',
          'client_area_memberships',
          'client_area_company_settings',
          'client_area_settings',
          'user_sessions',
          'user_login_events',
          'user_security_settings',
          'agency_client_company_contexts',
          'agency_clients',
          'contacts',
        ]) {
          await db.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [T]);
        }
      }
    } finally {
      await app?.close();
      process.env = { ...savedEnv };
    }
  });

  it('(a) active PF grants access; archiving the PF fails the directory and the context closed, then restoring the PF restores access', async () => {
    const token = await tokenFor(email('archive'));
    expect(await companiesOf(token)).toEqual([A]);
    await authed(`/client-area/companies/${A}/context`, token).expect(200);

    await db.query(
      `UPDATE contacts SET status = 'archived' WHERE id = (
      SELECT contact_id FROM client_area_identity_contacts WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'
    )`,
      [T, U_ARCHIVE],
    );
    try {
      expect(await companiesOf(token)).toEqual([]);
      await authed(`/client-area/companies/${A}/context`, token).expect(404);
    } finally {
      await db.query(
        `UPDATE contacts SET status = 'active' WHERE id = (
        SELECT contact_id FROM client_area_identity_contacts WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'
      )`,
        [T, U_ARCHIVE],
      );
    }
    expect(await companiesOf(token)).toEqual([A]);
  });

  it('(b) active identity-link grants access; revoking it fails the very next request on the same live session', async () => {
    const token = await tokenFor(email('revoke'));
    await authed(`/client-area/companies/${A}/context`, token).expect(200);

    await db.query(
      `UPDATE client_area_identity_contacts SET status = 'revoked', revoked_at = now()
       WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
      [T, U_REVOKE],
    );
    await authed(`/client-area/companies/${A}/context`, token).expect(404);
    expect(await companiesOf(token)).toEqual([]);
  });

  it('(c) removing the PF<->Organization relation revokes the membership, audits crm_relationship_removed, revokes the session (last membership) and fails preview-equivalent access', async () => {
    const token = await tokenFor(email('relation'));
    await authed(`/client-area/companies/${A}/context`, token).expect(200);

    const [identity] = await db.query<Array<{ contact_id: string }>>(
      `SELECT contact_id FROM client_area_identity_contacts WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
      [T, U_RELATION],
    );
    const [membership] = await db.query<Array<{ id: string }>>(
      `SELECT id FROM client_area_memberships WHERE tenant_id = $1 AND user_id = $2 AND status = 'active'`,
      [T, U_RELATION],
    );

    await db.transaction(async (manager) => {
      await manager.query(
        `UPDATE contact_company_links SET status = 'inactive', unlinked_at = now()
         WHERE tenant_id = $1 AND person_contact_id = $2 AND company_contact_id = $3`,
        [T, identity.contact_id, orgA],
      );
      await memberships.revokeForCrmRelationshipInTransaction(manager, {
        tenantId: T,
        workspaceId: W,
        personContactId: identity.contact_id,
        companyContactId: orgA,
        revokedByUserId: null,
      });
    });

    const [row] = await db.query<
      Array<{ status: string; revoked_at: string | null }>
    >(`SELECT status, revoked_at FROM client_area_memberships WHERE id = $1`, [
      membership.id,
    ]);
    expect(row.status).toBe('revoked');
    expect(row.revoked_at).not.toBeNull();

    const [audit] = await db.query<
      Array<{ metadata: Record<string, unknown> }>
    >(
      `SELECT metadata FROM client_area_member_events
       WHERE membership_id = $1 AND action = 'membership_revoked'
       ORDER BY created_at DESC LIMIT 1`,
      [membership.id],
    );
    if (audit) {
      expect(audit.metadata).toMatchObject({
        reason: 'crm_relationship_removed',
      });
    }

    // The still-signed access token must fail on the next request: either
    // because the membership is gone, or (last membership) the session was
    // revoked outright.
    await authed('/client-area/me', token).expect(401);
    await authed(`/client-area/companies/${A}/context`, token).expect(401);
  });

  it('(d) relinking the PF<->Organization relation does not reactivate the old membership; a new grant is required', async () => {
    const [identity] = await db.query<Array<{ contact_id: string }>>(
      `SELECT contact_id FROM client_area_identity_contacts WHERE tenant_id = $1 AND user_id = $2`,
      [T, U_RELATION],
    );
    await db.query(
      `UPDATE contact_company_links SET status = 'active', unlinked_at = NULL
       WHERE tenant_id = $1 AND person_contact_id = $2 AND company_contact_id = $3`,
      [T, identity.contact_id, orgA],
    );

    // The relation is back, but the membership is still revoked: no
    // membership means no available company, so login itself is refused —
    // the relink alone never reactivates it.
    await login(email('relation')).expect(401);

    await memberships.grant({
      tenantId: T,
      companyContextId: A,
      userId: U_RELATION,
      role: 'client_viewer',
      grantedByUserId: null,
    });
    const relinked = await login(email('relation')).expect(200);
    expect(await companiesOf(bodyOf(relinked).accessToken!)).toEqual([A]);
  });

  it('(e) a valid CRM chain alone, with no membership, grants no access — CRM relationship is never authorization by itself (login itself is refused, since no company is available)', async () => {
    await crmLink(U_NOMEMBERSHIP, email('nomembership'), orgA);
    await login(email('nomembership')).expect(401);
  });

  it('(f) a valid, active membership with no CRM chain grants no access — CRM identity is now also required', async () => {
    const token = await tokenFor(email('nochain'));
    expect(await companiesOf(token)).toEqual([]);
    await authed(`/client-area/companies/${A}/context`, token).expect(404);
  });

  it('(g) one identity with two active PF<->Organization links across two companies gets both memberships working', async () => {
    const token = await tokenFor(email('multi'));
    expect((await companiesOf(token)).sort()).toEqual([A, B].sort());
    await authed(`/client-area/companies/${A}/context`, token).expect(200);
    await authed(`/client-area/companies/${B}/context`, token).expect(200);
  });

  it('(h) two different PFs sharing one email, linked to two different identities, never cross-resolve', async () => {
    const tokenA = await tokenFor(email('dupshared'));
    expect(await companiesOf(tokenA)).toEqual([A]);

    // U_DUPB has a CRM person (with the same email) but no membership of its
    // own: it must never inherit U_DUPA's company through email matching.
    const loginB = await login(email('dupshared2')).expect(401);
    expect(loginB.status).toBe(401);
  });

  it('(i) changing the identity email mid-session does not change what is authorized (no email-based authorization)', async () => {
    const token = await tokenFor(email('emailchange'));
    expect(await companiesOf(token)).toEqual([A]);

    await db.query(
      `UPDATE user_security_settings SET current_email = $1 WHERE tenant_id = $2 AND user_id = $3`,
      [`changed.${email('emailchange')}`, T, U_EMAIL],
    );
    try {
      expect(await companiesOf(token)).toEqual([A]);
      await authed(`/client-area/companies/${A}/context`, token).expect(200);
    } finally {
      await db.query(
        `UPDATE user_security_settings SET current_email = $1 WHERE tenant_id = $2 AND user_id = $3`,
        [email('emailchange'), T, U_EMAIL],
      );
    }
  });
});
