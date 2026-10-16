import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { Test, type TestingModule } from '@nestjs/testing';
import { getDataSourceToken, TypeOrmModule } from '@nestjs/typeorm';
import { randomUUID } from 'crypto';
import { type DataSource } from 'typeorm';
import { FilesService } from '../../common/files/files.service';
import {
  agencyEntities,
  getAgencyTypeOrmConfig,
} from '../../config/typeorm.config';
import { DisableClientAreaOnInactiveClients1799500000000 } from '../../database/migrations/1799500000000-disable-client-area-on-inactive-clients';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { AgencyContactsService } from '../agency/agency-contacts.service';
import { AgencyUserSessionEntity } from '../agency/entities/agency-auth.entities';
import { AgencyClientLifecycleHooks } from '../clients/agency-client-lifecycle-hooks';
import { AgencyClient, AgencyClientCompanyContext } from '../clients/entities';
import { AgencyClientStatus } from '../clients/enums';
import { AgencyClientCompanyContextService } from '../clients/services/agency-client-company-context.service';
import { ClientCompanySetupService } from '../clients/services/client-company-setup.service';
import { ClientCostCenterService } from '../clients/services/client-cost-center.service';
import { ClientNotificationPublisher } from '../clients/services/client-notification.publisher';
import { ClientsProfitabilityService } from '../clients/services/clients-profitability.service';
import { ClientsService } from '../clients/services/clients.service';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { EmailModule } from '../email/email.module';
import { EmailService } from '../email/email.service';
import { ClientAreaModule } from './client-area.module';
import { ClientAreaInvitationEntity } from './entities/client-area-invitation.entity';
import { ClientAreaMemberEventEntity } from './entities/client-area-member-event.entity';
import { ClientAreaMembershipEntity } from './entities/client-area-membership.entity';
import { ClientAreaCompanySettingsEntity } from './entities/client-area-settings.entity';
import { ClientAreaEligibilityService } from './services/client-area-eligibility.service';
import { ClientAreaInvitationService } from './services/client-area-invitation.service';
import { ClientAreaLifecycleService } from './services/client-area-lifecycle.service';
import { ClientAreaManagementService } from './services/client-area-management.service';
import { ClientAreaMemberAuditService } from './services/client-area-member-audit.service';

jest.mock('otplib', () => ({ verify: jest.fn() }));
@Module({
  providers: [{ provide: EmailService, useValue: { sendEmail: jest.fn() } }],
  exports: [EmailService],
})
class FakeEmailModule {}

describePostgresIntegration()(
  'CA5 transactional lifecycle and PF/PJ (lyra_agency_test only)',
  () => {
    let ref: TestingModule;
    let db: DataSource;
    let clients: ClientsService;
    let lifecycle: ClientAreaLifecycleService;
    let companies: AgencyClientCompanyContextService;
    const tenantId = randomUUID(),
      workspaceId = randomUUID(),
      actorUserId = randomUUID();
    const scope = { tenantId, workspaceId, userId: actorUserId };
    const migration = new DisableClientAreaOnInactiveClients1799500000000();
    const savedEnv = { ...process.env };

    beforeAll(async () => {
      if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
        throw new Error('CA5 requires lyra_agency_test');
      process.env.CLIENT_AREA_ENABLED = 'true';
      process.env.JWT_CLIENT_AREA_ACCESS_SECRET =
        'ca5-client-area-access-secret-000000000000';
      ref = await Test.createTestingModule({
        imports: [
          ConfigModule.forRoot({ ignoreEnvFile: true, isGlobal: true }),
          TypeOrmModule.forRoot(getAgencyTypeOrmConfig()),
          TypeOrmModule.forFeature(agencyEntities, 'agency'),
          ClientAreaModule,
        ],
        providers: [
          ClientsService,
          ClientCompanySetupService,
          AgencyClientCompanyContextService,
          AgencyClientLifecycleHooks,
          AgencyContactsService,
          { provide: FilesService, useValue: {} },
          { provide: ClientsProfitabilityService, useValue: {} },
          { provide: ClientNotificationPublisher, useValue: {} },
          {
            provide: ClientCostCenterService,
            useValue: { ensureForClientSafe: jest.fn() },
          },
        ],
      })
        .overrideModule(EmailModule)
        .useModule(FakeEmailModule)
        .compile();
      await ref.init();
      db = ref.get<DataSource>(getDataSourceToken('agency'));
      const runner = db.createQueryRunner();
      try {
        await migration.up(runner);
      } finally {
        await runner.release();
      }
      clients = ref.get(ClientsService);
      companies = ref.get(AgencyClientCompanyContextService);
      lifecycle = ref.get(ClientAreaLifecycleService);
      ref.get(AgencyClientLifecycleHooks).register(lifecycle);
      await db.query(
        `INSERT INTO workspace_users (tenant_id,workspace_id,user_id,email,name,role,status) VALUES ($1,$2,$3,$4,'CA5','owner','active')`,
        [tenantId, workspaceId, actorUserId, `ca5-${tenantId}@example.test`],
      );
    }, 60000);

    afterAll(async () => {
      if (db?.isInitialized) {
        // Only this run's random tenant. Never TRUNCATE or reset shared fixtures.
        for (const table of [
          'client_area_member_events',
          'client_area_invitations',
          'client_area_memberships',
          'client_area_company_settings',
          'client_area_identity_contacts',
          'agency_client_company_contexts',
          'agency_clients',
          'contact_company_links',
          'contact_methods',
          'contacts',
          'user_sessions',
          'workspace_users',
        ]) {
          await db.query(`DELETE FROM ${table} WHERE tenant_id = $1`, [
            tenantId,
          ]);
        }
      }
      if (ref) await ref.close();
      process.env = savedEnv;
    });

    async function contact(
      type: 'person' | 'organization',
      overrides: Partial<ContactEntity> = {},
    ) {
      return db.getRepository(ContactEntity).save(
        db.getRepository(ContactEntity).create({
          tenantId,
          workspaceId,
          type,
          displayName: `CA5 ${type}`,
          ...overrides,
        }),
      );
    }
    async function create(contactId?: string, companyContactIds?: string[]) {
      return clients.create(scope, {
        displayName: 'CA5 Client',
        contactId,
        companyContactIds,
      });
    }
    async function contexts(clientId: string) {
      return db.getRepository(AgencyClientCompanyContext).find({
        where: { tenantId, agencyClientId: clientId },
        order: { isPrimary: 'DESC' },
      });
    }
    async function enable(company: AgencyClientCompanyContext) {
      await db.getRepository(ClientAreaCompanySettingsEntity).save({
        tenantId,
        workspaceId,
        agencyClientId: company.agencyClientId,
        companyContextId: company.id,
        enabled: true,
      });
    }
    async function member(
      company: AgencyClientCompanyContext,
      userId = randomUUID(),
    ) {
      return db.getRepository(ClientAreaMembershipEntity).save({
        tenantId,
        workspaceId,
        agencyClientId: company.agencyClientId,
        companyContextId: company.id,
        userId,
        role: 'client_viewer',
        status: 'active',
      });
    }
    async function session(
      userId: string,
      surface: 'agency' | 'client_area' = 'client_area',
    ) {
      return db.getRepository(AgencyUserSessionEntity).save({
        tenantId,
        userId,
        title: 'CA5',
        browser: 'test',
        status: 'active',
        surface,
      });
    }

    it('PJ creates its own primary company atomically and ignores selected companies; legacy remains accepted', async () => {
      const pj = await contact('organization');
      const saved = await create(pj.id, [randomUUID()]);
      expect(await contexts(saved.id)).toEqual([
        expect.objectContaining({ companyContactId: pj.id, isPrimary: true }),
      ]);
      expect(saved.companySetupPending).toBe(false);
      expect(await contexts((await create()).id)).toHaveLength(0);
    });

    it('PF with zero links returns 422, then creates a canonical CRM link and eligible primary company', async () => {
      const pf = await contact('person'),
        pj = await contact('organization');
      const before = await db
        .getRepository(AgencyClient)
        .count({ where: { tenantId } });
      await expect(create(pf.id)).rejects.toMatchObject({
        response: { statusCode: 422, code: 'client_company_required' },
      });
      expect(
        await db.getRepository(AgencyClient).count({ where: { tenantId } }),
      ).toBe(before);
      const saved = await create(pf.id, [pj.id]);
      expect(saved.companySetupPending).toBe(false);
      const eligible = await ref
        .get(ClientAreaEligibilityService)
        .listEligibleCompaniesForContact(
          db.manager,
          tenantId,
          workspaceId,
          pf.id,
        );
      expect(eligible).toEqual([
        expect.objectContaining({ organizationContactId: pj.id }),
      ]);
      const [link] = await db.query<
        Array<{ status: string; unlinked_at: Date | null }>
      >(
        `SELECT status,unlinked_at FROM contact_company_links WHERE person_contact_id=$1 AND company_contact_id=$2`,
        [pf.id, pj.id],
      );
      expect(link).toMatchObject({ status: 'active', unlinked_at: null });
    });

    it('PF with one active link selects it automatically; multiple links require an explicit selection', async () => {
      const pf = await contact('person'),
        a = await contact('organization'),
        b = await contact('organization');
      const crm = ref.get(AgencyContactsService);
      await crm.addCompanyLink(scope, pf.id, a.id);
      expect((await contexts((await create(pf.id)).id))[0]).toMatchObject({
        companyContactId: a.id,
        isPrimary: true,
      });
      const pfMulti = await contact('person');
      await crm.addCompanyLink(scope, pfMulti.id, a.id);
      await crm.addCompanyLink(scope, pfMulti.id, b.id);
      await expect(create(pfMulti.id)).rejects.toMatchObject({
        response: { code: 'client_company_selection_required' },
      });
      await expect(create(pfMulti.id, [randomUUID()])).rejects.toMatchObject({
        response: { code: 'client_company_selection_required' },
      });
      const result = await contexts(
        (await create(pfMulti.id, [b.id, a.id])).id,
      );
      expect(result).toHaveLength(2);
      expect(result[0]).toMatchObject({
        companyContactId: b.id,
        isPrimary: true,
      });
    });

    it('update contact validates PF/PJ transactionally; invalid/foreign companies return 404 without partial writes', async () => {
      const saved = await create(),
        pf = await contact('person'),
        pj = await contact('organization');
      await expect(
        clients.update(scope, saved.id, { contactId: pf.id }),
      ).rejects.toMatchObject({
        response: { code: 'client_company_required' },
      });
      expect(
        (await db.getRepository(AgencyClient).findOneByOrFail({ id: saved.id }))
          .contactId,
      ).toBeNull();
      await expect(create(pf.id, [randomUUID()])).rejects.toMatchObject({
        status: 404,
      });
      const foreign = await contact('organization', {
        workspaceId: randomUUID(),
      });
      await expect(create(pf.id, [foreign.id])).rejects.toMatchObject({
        status: 404,
      });
      await clients.update(scope, saved.id, {
        contactId: pf.id,
        companyContactIds: [pj.id],
      });
      expect((await contexts(saved.id))[0]).toMatchObject({
        companyContactId: pj.id,
        isPrimary: true,
      });
      await companies.archive(
        scope,
        saved.id,
        (await contexts(saved.id))[0].id,
      );
      expect(
        (await clients.findOneWithProducts(scope, saved.id))
          .companySetupPending,
      ).toBe(true);
    });

    it('removes access atomically, retains other-company/Agency sessions, and is idempotent', async () => {
      const pj = await contact('organization'),
        other = await contact('organization');
      const a = (await contexts((await create(pj.id)).id))[0],
        b = (await contexts((await create(other.id)).id))[0];
      await enable(a);
      await enable(b);
      const first = await member(a),
        second = await member(a);
      await member(b, second.userId);
      const firstSession = await session(first.userId),
        secondSession = await session(second.userId),
        agencySession = await session(first.userId, 'agency');
      await db.getRepository(ClientAreaInvitationEntity).save({
        tenantId,
        workspaceId,
        agencyClientId: a.agencyClientId,
        companyContextId: a.id,
        email: 'ca5@example.test',
        emailNormalized: 'ca5@example.test',
        role: 'client_viewer',
        tokenHash: 'a'.repeat(64),
        expiresAt: new Date(Date.now() + 3600000),
        invitedByUserId: actorUserId,
        status: 'pending',
      });
      const input = {
        tenantId,
        workspaceId,
        agencyClientId: a.agencyClientId,
        companyContextId: a.id,
        actorUserId,
        reason: 'access_removed' as const,
      };
      await expect(
        lifecycle.removeCompanyAccess({ ...input, workspaceId: randomUUID() }),
      ).rejects.toMatchObject({ status: 404 });
      expect(await lifecycle.removeCompanyAccess(input)).toMatchObject({
        revokedMemberships: 2,
        revokedInvitations: 1,
        enabled: false,
      });
      const sessions = db.getRepository(AgencyUserSessionEntity);
      expect(
        (await sessions.findOneByOrFail({ id: firstSession.id })).revokedAt,
      ).not.toBeNull();
      expect(
        (await sessions.findOneByOrFail({ id: secondSession.id })).revokedAt,
      ).toBeNull();
      expect(
        (await sessions.findOneByOrFail({ id: agencySession.id })).revokedAt,
      ).toBeNull();
      const audit = db.getRepository(ClientAreaMemberEventEntity);
      const count = await audit.count({ where: { companyContextId: a.id } });
      expect(count).toBe(4);
      expect(await lifecycle.removeCompanyAccess(input)).toMatchObject({
        revokedMemberships: 0,
        revokedInvitations: 0,
      });
      expect(await audit.count({ where: { companyContextId: a.id } })).toBe(
        count,
      );
      await lifecycle.removeCompanyAccess({
        ...input,
        agencyClientId: b.agencyClientId,
        companyContextId: b.id,
      });
      expect(
        (await sessions.findOneByOrFail({ id: secondSession.id })).revokedAt,
      ).not.toBeNull();
    });

    it('archive/update/company hooks revoke; restore never restores access; automatic repair uses system actor', async () => {
      for (const mode of [
        'archive',
        'update',
        'company',
        'reconcile',
      ] as const) {
        const pj = await contact('organization'),
          saved = await create(pj.id),
          company = (await contexts(saved.id))[0];
        await enable(company);
        const membership = await member(company);
        await session(membership.userId);
        if (mode === 'archive') await clients.archiveEffective(scope, saved.id);
        if (mode === 'update')
          await clients.update(scope, saved.id, {
            status: AgencyClientStatus.Archived,
          });
        if (mode === 'company')
          await companies.archive(scope, saved.id, company.id);
        if (mode === 'reconcile') {
          await db.getRepository(AgencyClient).update(saved.id, {
            status: AgencyClientStatus.Archived,
            archivedAt: new Date(),
          });
          // Migration can disable the row first. Reconciliation must still revoke.
          const runner = db.createQueryRunner();
          try {
            await migration.up(runner);
          } finally {
            await runner.release();
          }
          await lifecycle.reconcile();
        }
        expect(
          (
            await db
              .getRepository(ClientAreaMembershipEntity)
              .findOneByOrFail({ id: membership.id })
          ).status,
        ).toBe('revoked');
        expect(
          (
            await db
              .getRepository(ClientAreaCompanySettingsEntity)
              .findOneByOrFail({ companyContextId: company.id })
          ).enabled,
        ).toBe(false);
        const events = await db
          .getRepository(ClientAreaMemberEventEntity)
          .find({ where: { companyContextId: company.id } });
        expect(events).toContainEqual(
          expect.objectContaining({
            action: 'membership_revoked',
            actorSurface: mode === 'reconcile' ? 'system' : 'agency',
            actorUserId: mode === 'reconcile' ? null : actorUserId,
          }),
        );
        if (mode !== 'company') await clients.unarchive(scope, saved.id);
        await lifecycle.reconcile();
        expect(
          (
            await db
              .getRepository(ClientAreaMembershipEntity)
              .findOneByOrFail({ id: membership.id })
          ).status,
        ).toBe('revoked');
        expect(
          await db
            .getRepository(ClientAreaMemberEventEntity)
            .count({ where: { companyContextId: company.id } }),
        ).toBe(events.length);
      }
    });

    it('first invitation is client_admin; subsequent invitations retain requested legacy role', async () => {
      const pf = await contact('person'),
        pj = await contact('organization'),
        pf2 = await contact('person');
      const saved = await create(pf.id, [pj.id]),
        company = (await contexts(saved.id))[0];
      await ref.get(AgencyContactsService).addCompanyLink(scope, pf2.id, pj.id);
      for (const [index, person] of [pf, pf2].entries()) {
        await db.query(
          `INSERT INTO contact_methods (tenant_id,workspace_id,contact_id,type,value,is_primary) VALUES ($1,$2,$3,'email',$4,true)`,
          [tenantId, workspaceId, person.id, `ca5-${person.id}@example.test`],
        );
        const result = await ref
          .get(ClientAreaInvitationService)
          .invite(
            { tenantId, workspaceId, userId: actorUserId },
            saved.id,
            company.id,
            { contactId: person.id, role: 'client_viewer' },
          );
        expect(result.invitation.role).toBe(
          index === 0 ? 'client_admin' : 'client_viewer',
        );
      }
    });

    it('excludes inactive clients/companies/organizations from lists and KPIs and rejects re-enablement', async () => {
      const pj = await contact('organization'),
        saved = await create(pj.id),
        company = (await contexts(saved.id))[0];
      await enable(company);
      const management = ref.get(ClientAreaManagementService);
      expect(
        await management.listCompanies(tenantId, workspaceId),
      ).toContainEqual(
        expect.objectContaining({ companyContextId: company.id }),
      );
      await db
        .getRepository(AgencyClient)
        .update(saved.id, { status: AgencyClientStatus.Archived });
      expect(
        await management.listCompanies(tenantId, workspaceId),
      ).not.toContainEqual(
        expect.objectContaining({ companyContextId: company.id }),
      );
      expect(
        await management.resolveCompanyModules({
          tenantId,
          workspaceId,
          agencyClientId: saved.id,
          companyContextId: company.id,
        }),
      ).toEqual({ approvals: false, conversations: false });
      await expect(
        management.patchCompanySettings(
          tenantId,
          workspaceId,
          saved.id,
          company.id,
          { enabled: true },
        ),
      ).rejects.toMatchObject({ status: 404 });
      await db
        .getRepository(AgencyClient)
        .update(saved.id, { status: AgencyClientStatus.Active });
      await db
        .getRepository(ContactEntity)
        .update(pj.id, { status: 'inactive' });
      expect(
        await management.listCompanies(tenantId, workspaceId),
      ).not.toContainEqual(
        expect.objectContaining({ companyContextId: company.id }),
      );
      const list = await management.listCompanies(tenantId, workspaceId);
      const overview = await management.overview(tenantId, workspaceId);
      expect(overview.metrics.enabledCompanies).toBe(
        list.filter((item) => item.enabled).length,
      );
      await db.getRepository(ContactEntity).update(pj.id, { status: 'active' });
      await db.getRepository(AgencyClientCompanyContext).update(company.id, {
        status: 'archived',
        isPrimary: false,
        archivedAt: new Date(),
      });
      expect(
        await management.listCompanies(tenantId, workspaceId),
      ).not.toContainEqual(
        expect.objectContaining({ companyContextId: company.id }),
      );
    });

    it('audit failure rolls removal back, including membership, invitation, settings and session', async () => {
      const pj = await contact('organization'),
        saved = await create(pj.id),
        company = (await contexts(saved.id))[0];
      await enable(company);
      const membership = await member(company);
      const live = await session(membership.userId);
      const audit = jest
        .spyOn(ref.get(ClientAreaMemberAuditService), 'record')
        .mockRejectedValueOnce(new Error('audit unavailable'));
      await expect(
        lifecycle.removeCompanyAccess({
          tenantId,
          workspaceId,
          agencyClientId: saved.id,
          companyContextId: company.id,
          actorUserId,
          reason: 'access_removed',
        }),
      ).rejects.toThrow('audit unavailable');
      audit.mockRestore();
      expect(
        (
          await db
            .getRepository(ClientAreaMembershipEntity)
            .findOneByOrFail({ id: membership.id })
        ).status,
      ).toBe('active');
      expect(
        (
          await db
            .getRepository(AgencyUserSessionEntity)
            .findOneByOrFail({ id: live.id })
        ).revokedAt,
      ).toBeNull();
      expect(
        (
          await db
            .getRepository(ClientAreaCompanySettingsEntity)
            .findOneByOrFail({ companyContextId: company.id })
        ).enabled,
      ).toBe(true);
    });

    it('concurrent removals of the last two companies close the identity session', async () => {
      const a = (
        await contexts((await create((await contact('organization')).id)).id)
      )[0];
      const b = (
        await contexts((await create((await contact('organization')).id)).id)
      )[0];
      const membership = await member(a);
      await member(b, membership.userId);
      const live = await session(membership.userId);
      await Promise.all(
        [a, b].map((company) =>
          lifecycle.removeCompanyAccess({
            tenantId,
            workspaceId,
            agencyClientId: company.agencyClientId,
            companyContextId: company.id,
            actorUserId,
            reason: 'access_removed',
          }),
        ),
      );
      expect(
        (
          await db
            .getRepository(AgencyUserSessionEntity)
            .findOneByOrFail({ id: live.id })
        ).revokedAt,
      ).not.toBeNull();
    });

    it('failed archive cleanup is retried before restore; restore cannot resurrect a membership', async () => {
      const pj = await contact('organization'),
        saved = await create(pj.id),
        company = (await contexts(saved.id))[0];
      await enable(company);
      const membership = await member(company);
      const hook = jest
        .spyOn(lifecycle, 'onClientArchived')
        .mockRejectedValueOnce(new Error('retry'));
      await clients.archive(scope, saved.id);
      expect(
        (await db.getRepository(AgencyClient).findOneByOrFail({ id: saved.id }))
          .status,
      ).toBe('archived');
      hook.mockRestore();
      await clients.unarchive(scope, saved.id);
      expect(
        (
          await db
            .getRepository(ClientAreaMembershipEntity)
            .findOneByOrFail({ id: membership.id })
        ).status,
      ).toBe('revoked');
    });

    it('migration up is idempotent; down preserves removals/history and restores legacy write constraints', async () => {
      const runner = db.createQueryRunner();
      try {
        const pj = await contact('organization'),
          saved = await create(pj.id),
          company = (await contexts(saved.id))[0];
        await enable(company);
        await db
          .getRepository(AgencyClient)
          .update(saved.id, { status: AgencyClientStatus.Archived });
        await migration.up(runner);
        await migration.up(runner);
        expect(
          (
            await db
              .getRepository(ClientAreaCompanySettingsEntity)
              .findOneByOrFail({ companyContextId: company.id })
          ).enabled,
        ).toBe(false);
        const before = await db
          .getRepository(ClientAreaMemberEventEntity)
          .count({ where: { tenantId } });
        await migration.down(runner);
        expect(
          await db
            .getRepository(ClientAreaMemberEventEntity)
            .count({ where: { tenantId } }),
        ).toBe(before);
        expect(
          (
            await db
              .getRepository(ClientAreaCompanySettingsEntity)
              .findOneByOrFail({ companyContextId: company.id })
          ).enabled,
        ).toBe(false);
        await expect(
          db.getRepository(ClientAreaMemberEventEntity).insert({
            tenantId,
            workspaceId,
            agencyClientId: saved.id,
            companyContextId: company.id,
            action: 'membership_revoked',
            actorSurface: 'system',
            actorUserId: null,
          }),
        ).rejects.toMatchObject({ driverError: { code: '23514' } });
      } finally {
        await migration.up(runner);
        await runner.release();
      }
    });
  },
);
