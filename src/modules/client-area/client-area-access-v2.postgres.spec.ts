import { ConfigService } from '@nestjs/config';
import { ClientAreaMembershipEntity } from './entities/client-area-membership.entity';
import { ClientAreaMembershipService } from './services/client-area-membership.service';
import { ClientAreaMemberAuditService } from './services/client-area-member-audit.service';
import { ClientAreaMemberAccessService } from './services/client-area-member-access.service';
import { ClientAreaConsentService } from './services/client-area-consent.service';
import { AuditChangeService } from './services/audit-change.service';
import { AuditChangeEventEntity } from './entities/audit-change-event.entity';
import type { ClientAreaContext } from './client-area.types';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import {
  agencyEntities,
  getAgencyTypeOrmConfig,
} from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { ClientAreaAccessModelV21799700000000 } from '../../database/migrations/1799700000000-client-area-access-model-v2';

describePostgresIntegration()('CA7 PostgreSQL (lyra_agency_test only)', () => {
  let db: DataSource;
  let admin: DataSource;
  const schema = `ca7_${randomUUID().replaceAll('-', '')}`;
  const tenant = randomUUID(),
    workspace = randomUUID(),
    client = randomUUID(),
    company = randomUUID();
  const ownerUser = randomUUID(),
    agencyUser = randomUUID(),
    memberUser = randomUUID();
  let ownerId: string, memberId: string;
  let access: ClientAreaMemberAccessService,
    consentService: ClientAreaConsentService;
  const actor = {
    tenantId: tenant,
    workspaceId: workspace,
    userId: agencyUser,
  };
  const scope = {
    tenantId: tenant,
    workspaceId: workspace,
    agencyClientId: client,
    companyContextId: company,
  };
  const context = () =>
    ({
      ...scope,
      surface: 'client_area',
      userId: ownerUser,
      role: 'client_owner',
      membershipId: ownerId,
      sessionId: randomUUID(),
      companyDisplayName: 'Company',
      permissions: new Set(),
      modules: { approvals: false, conversations: true },
    }) as ClientAreaContext;
  const migration = new ClientAreaAccessModelV21799700000000();
  beforeAll(async () => {
    if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
      throw new Error('CA7 requires lyra_agency_test');
    const config = getAgencyTypeOrmConfig();
    admin = await new DataSource({
      ...config,
      name: 'ca7-admin',
      migrationsRun: false,
      synchronize: false,
    } as DataSourceOptions).initialize();
    await admin.query(`CREATE SCHEMA "${schema}"`);
    for (const table of [
      'client_area_memberships',
      'client_area_invitations',
      'client_area_company_settings',
      'client_area_member_events',
      'leadflow_telemetry_consents',
      'leadflow_telemetry_consent_notices',
      'agency_clients',
      'agency_client_company_contexts',
      'contacts',
      'workspace_users',
      'user_security_settings',
      'user_sessions',
    ])
      await admin.query(
        `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
      );
    db = await new DataSource({
      ...config,
      name: 'ca7',
      schema,
      entities: agencyEntities,
      migrationsRun: false,
      synchronize: false,
      extra: { options: `-c search_path=${schema},public` },
    } as DataSourceOptions).initialize();
    await db.query(
      "ALTER TABLE agency_clients ADD COLUMN IF NOT EXISTS archive_requested_at timestamptz, ADD COLUMN IF NOT EXISTS archive_requested_by uuid, ADD COLUMN IF NOT EXISTS archive_mode varchar(30), ADD COLUMN IF NOT EXISTS archive_status varchar(20) NOT NULL DEFAULT 'none'",
    );
    const runner = db.createQueryRunner();
    await runner.connect();
    try {
      await migration.up(runner);
      await migration.down(runner);
      await migration.up(runner);
      await migration.up(runner);
    } finally {
      await runner.release();
    }
    const organization = randomUUID();
    await db.query(
      `INSERT INTO contacts (id,tenant_id,workspace_id,type,display_name) VALUES ($1,$2,$3,'organization','Company')`,
      [organization, tenant, workspace],
    );
    await db.query(
      `INSERT INTO agency_clients (id,tenant_id,workspace_id,display_name) VALUES ($1,$2,$3,'Client')`,
      [client, tenant, workspace],
    );
    await db.query(
      `INSERT INTO agency_client_company_contexts (id,tenant_id,workspace_id,agency_client_id,company_contact_id,status,is_primary) VALUES ($1,$2,$3,$4,$5,'active',true)`,
      [company, tenant, workspace, client, organization],
    );
    await db.query(
      `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,name,email,role,status) VALUES ($1,$2,$3,'Agency','ca7@example.com','owner','active')`,
      [tenant, workspace, agencyUser],
    );
    await db.query(
      `INSERT INTO client_area_company_settings (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,module_settings) VALUES ($1,$2,$3,$4,true,'{"agency_projects":{"enabled":true,"defaultLevel":"viewer"},"conversations":{"enabled":true,"defaultLevel":"viewer"},"social_planner":{"enabled":false,"defaultLevel":"viewer"}}')`,
      [tenant, workspace, client, company],
    );
    const audit = new AuditChangeService(
      db.getRepository(AuditChangeEventEntity),
      new ConfigService(),
    );
    const memberAudit = new ClientAreaMemberAuditService();
    const memberships = new ClientAreaMembershipService(
      db,
      db.getRepository(ClientAreaMembershipEntity),
      { revokeAll: jest.fn() } as never,
      memberAudit,
    );
    access = new ClientAreaMemberAccessService(
      db,
      memberships,
      memberAudit,
      audit,
    );
    consentService = new ClientAreaConsentService(db, audit);
  });
  afterAll(async () => {
    if (db?.isInitialized) await db.destroy();
    if (admin?.isInitialized) {
      await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
      await admin.destroy();
    }
  });
  it('runs up/down/up and enforces single active Owner and module grants', async () => {
    const [owner] = await db.query<Array<{ id: string }>>(
      `INSERT INTO client_area_memberships (tenant_id,workspace_id,agency_client_id,company_context_id,user_id,role) VALUES ($1,$2,$3,$4,$5,'client_owner') RETURNING id`,
      [tenant, workspace, client, company, ownerUser],
    );
    ownerId = owner.id;
    await expect(
      db.query(
        `INSERT INTO client_area_memberships (tenant_id,workspace_id,agency_client_id,company_context_id,user_id,role) VALUES ($1,$2,$3,$4,$5,'client_owner')`,
        [tenant, workspace, client, company, randomUUID()],
      ),
    ).rejects.toMatchObject({ driverError: { code: '23505' } });
    await expect(
      db.query(
        `INSERT INTO client_area_member_module_access (membership_id,module_key,level,granted_by_surface) VALUES ($1,'automations','manager','agency')`,
        [owner.id],
      ),
    ).rejects.toThrow();
    await db.query(
      `INSERT INTO client_area_member_module_access (membership_id,module_key,level,granted_by_surface) VALUES ($1,'agency_projects','operator','agency')`,
      [owner.id],
    );
    await expect(
      db.query(
        `INSERT INTO client_area_member_module_access (membership_id,module_key,level,granted_by_surface) VALUES ($1,'agency_projects','manager','agency')`,
        [owner.id],
      ),
    ).rejects.toThrow();
  });
  it('seeds a hashed essential notice pending legal review', async () => {
    const [notice] = await db.query<
      Array<{ id: string; content_hash: string; legal_review_status: string }>
    >(
      `SELECT * FROM leadflow_telemetry_consent_notices WHERE purpose_key='client_area_essential_processing'`,
    );
    expect(notice.legal_review_status).toBe('pending');
    expect(notice.content_hash).toMatch(/^[a-f0-9]{64}$/);
  });
  it('keeps audit append-only, rejects forged purge flags and purges only expired events through the function', async () => {
    const ids: string[] = [];
    for (const time of ["now()-interval '13 months'", 'now()']) {
      const [event] = await db.query<Array<{ id: string }>>(
        `INSERT INTO audit_change_events (tenant_id,actor_surface,module_key,entity_type,action,occurred_at) VALUES ($1,'system','settings','test','update',${time}) RETURNING id`,
        [tenant],
      );
      ids.push(event.id);
    }
    await expect(
      db.query('UPDATE audit_change_events SET internal=true WHERE id=$1', [
        ids[0],
      ]),
    ).rejects.toThrow('append-only');
    await expect(
      db.query('DELETE FROM audit_change_events WHERE id=$1', [ids[0]]),
    ).rejects.toThrow('append-only');
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await runner.query("SELECT set_config('lyra.audit_purge','on',true)");
      await expect(
        runner.query('DELETE FROM audit_change_events WHERE id=$1', [ids[0]]),
      ).rejects.toThrow('append-only');
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    await db.query('SELECT audit_change_purge(12)');
    expect(
      await db.query('SELECT id FROM audit_change_events ORDER BY occurred_at'),
    ).toEqual([{ id: ids[1] }]);
  });
  it('replaces member levels transactionally and rejects disabled modules, self-change and foreign membership', async () => {
    const [member] = await db.query<Array<{ id: string }>>(
      `INSERT INTO client_area_memberships (tenant_id,workspace_id,agency_client_id,company_context_id,user_id,role) VALUES ($1,$2,$3,$4,$5,'client_member') RETURNING id`,
      [tenant, workspace, client, company, memberUser],
    );
    memberId = member.id;
    expect(
      await access.put(actor, client, company, memberId, {
        agency_projects: 'operator',
      }),
    ).toMatchObject({ moduleLevels: { agency_projects: 'operator' } });
    expect(
      await access.put(actor, client, company, memberId, {
        conversations: 'viewer',
      }),
    ).toMatchObject({ moduleLevels: { conversations: 'viewer' } });
    await expect(
      access.put(context(), client, company, ownerId, {
        conversations: 'viewer',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      access.put(context(), client, company, memberId, {
        social_planner: 'manager',
      }),
    ).rejects.toMatchObject({ status: 403 });
    await expect(
      access.put(context(), client, company, randomUUID(), {
        conversations: 'viewer',
      }),
    ).rejects.toMatchObject({ status: 404 });
    await expect(
      access.put(actor, randomUUID(), company, memberId, {}),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('accepts, revokes and reopens consent on version change with immutable company decisions', async () => {
    await db.query(
      `UPDATE leadflow_telemetry_consent_notices SET legal_review_status='approved' WHERE purpose_key='client_area_essential_processing'`,
    );
    const [notice] = await db.query<
      Array<{ id: string; content_hash: string; legal_review_status: string }>
    >(
      `SELECT id,content_hash FROM leadflow_telemetry_consent_notices WHERE purpose_key='client_area_essential_processing'`,
    );
    const dto = {
      purposeKey: 'client_area_essential_processing',
      decision: 'accept' as const,
      noticeId: notice.id,
      contentHash: notice.content_hash,
    };
    await expect(
      consentService.decide(
        {
          ...context(),
          userId: memberUser,
          membershipId: memberId,
          role: 'client_member',
        },
        dto,
      ),
    ).rejects.toMatchObject({ status: 403 });
    await consentService.decide(context(), dto);
    expect((await consentService.state(scope)).status).toBe('accepted');
    await expect(
      db.query(
        'DELETE FROM leadflow_telemetry_consents WHERE company_context_id=$1',
        [company],
      ),
    ).rejects.toThrow('append-only');
    await consentService.decide(context(), { ...dto, decision: 'revoke' });
    expect((await consentService.state(scope)).status).toBe('revoked');
    await consentService.decide(context(), dto);
    await db.query(
      `INSERT INTO leadflow_telemetry_consent_notices (purpose_key,version,locale,title,body,content_hash,categories,retention_days,k_anonymity_threshold,legal_review_status,status,effective_at) VALUES ('client_area_essential_processing',2,'pt-BR','New notice','New body',$1,'[]',365,5,'approved','active',now())`,
      ['b'.repeat(64)],
    );
    expect((await consentService.state(scope)).status).toBe('required');
    await expect(consentService.decide(context(), dto)).rejects.toMatchObject({
      status: 409,
    });
  });
  it('transfers ownership atomically, retaining one Owner and revoking the former Owner powers immediately', async () => {
    await access.transfer(context(), client, company, memberId);
    expect(
      await db.query(
        `SELECT id FROM client_area_memberships WHERE company_context_id=$1 AND status='active' AND role='client_owner'`,
        [company],
      ),
    ).toEqual([{ id: memberId }]);
    await expect(
      access.put(context(), client, company, memberId, {
        conversations: 'manager',
      }),
    ).rejects.toMatchObject({ status: 403 });
    const newOwner = {
      ...context(),
      membershipId: memberId,
      userId: memberUser,
    };
    await expect(access.revoke(newOwner, memberId)).rejects.toMatchObject({
      status: 403,
    });
    await expect(
      access.transfer(newOwner, client, company, randomUUID()),
    ).rejects.toMatchObject({ status: 404 });
  });
  it('migrates all legacy roles and enabled levels, retains history on down, and runs up again', async () => {
    const runner = db.createQueryRunner();
    await runner.connect();
    await runner.startTransaction();
    try {
      await migration.down(runner);
      const singleCompany = randomUUID(),
        multipleCompany = randomUUID();
      const legacyMembers = [
        { id: randomUUID(), company: singleCompany, role: 'client_admin' },
        ...['client_admin', 'client_operator', 'client_viewer'].map((role) => ({
          id: randomUUID(),
          company: multipleCompany,
          role,
        })),
      ];
      for (const id of [singleCompany, multipleCompany])
        await runner.query(
          `INSERT INTO client_area_company_settings (tenant_id,workspace_id,agency_client_id,company_context_id,enabled,approvals_enabled,conversations_enabled) VALUES ($1,$2,$3,$4,true,true,true)`,
          [tenant, workspace, client, id],
        );
      for (const entry of legacyMembers)
        await runner.query(
          `INSERT INTO client_area_memberships (id,tenant_id,workspace_id,agency_client_id,company_context_id,user_id,role) VALUES ($1,$2,$3,$4,$5,$6,$7)`,
          [
            entry.id,
            tenant,
            workspace,
            client,
            entry.company,
            randomUUID(),
            entry.role,
          ],
        );
      const invitation = randomUUID();
      await runner.query(
        `INSERT INTO client_area_invitations (id,tenant_id,workspace_id,agency_client_id,company_context_id,email,email_normalized,role,token_hash,expires_at,invited_by_user_id) VALUES ($1,$2,$3,$4,$5,'legacy@example.com','legacy@example.com','client_operator',$6,now()+interval '7 days',$7)`,
        [
          invitation,
          tenant,
          workspace,
          client,
          multipleCompany,
          'a'.repeat(64),
          agencyUser,
        ],
      );
      await migration.up(runner);
      expect(
        await runner.query(
          'SELECT role FROM client_area_memberships WHERE id=$1',
          [legacyMembers[0].id],
        ),
      ).toEqual([{ role: 'client_owner' }]);
      for (const [index, expected] of [
        'manager',
        'operator',
        'viewer',
      ].entries()) {
        expect(
          await runner.query(
            'SELECT role FROM client_area_memberships WHERE id=$1',
            [legacyMembers[index + 1].id],
          ),
        ).toEqual([{ role: 'client_member' }]);
        expect(
          await runner.query(
            `SELECT level FROM client_area_member_module_access WHERE membership_id=$1 AND module_key='approvals'`,
            [legacyMembers[index + 1].id],
          ),
        ).toEqual([{ level: expected }]);
      }
      expect(
        await runner.query(
          'SELECT role,module_levels FROM client_area_invitations WHERE id=$1',
          [invitation],
        ),
      ).toEqual([
        {
          role: 'client_member',
          module_levels: expect.objectContaining({
            approvals: 'operator',
            conversations: 'operator',
          }) as unknown,
        },
      ]);
      const before: unknown = await runner.query(
        'SELECT count(*) FROM audit_change_events',
      );
      await migration.down(runner);
      expect(
        await runner.query('SELECT count(*) FROM audit_change_events'),
      ).toEqual(before);
      await expect(
        runner.query('DELETE FROM audit_change_events'),
      ).rejects.toThrow('append-only');
      // The failed statement ends this test transaction; rollback restores its initial v2 schema/history.
    } finally {
      await runner.rollbackTransaction();
      await runner.release();
    }
    const runner2 = db.createQueryRunner();
    await runner2.connect();
    try {
      await migration.up(runner2);
    } finally {
      await runner2.release();
    }
  });
});
