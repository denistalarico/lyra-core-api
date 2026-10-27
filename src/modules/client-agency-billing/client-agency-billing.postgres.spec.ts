import { ActorDirectoryService } from '../client-area/services/actor-directory.service';
import { AgencyUserProfileEntity } from '../agency/entities/agency-settings.entities';
import { UnauthorizedException } from '@nestjs/common';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { ContactCompanyLinkEntity } from '../contacts/entities/contact-company-link.entity';
import { ClientAreaIdentityContactEntity } from '../client-area/entities/client-area-identity-contact.entity';
import { ClientAreaMembershipEntity } from '../client-area/entities/client-area-membership.entity';
import { ClientAreaSelfAccessEntity } from '../client-area/entities/client-area-self-access.entity';
import { ClientAreaCompanySettingsEntity } from '../client-area/entities/client-area-settings.entity';
import {
  AgencyUserSessionEntity,
  AgencyUserSecuritySettingsEntity,
} from '../agency/entities/agency-auth.entities';
import { AgencyWorkspaceUserEntity } from '../agency/entities/agency-settings.entities';
import { ClientAreaSessionService } from '../client-area/services/client-area-session.service';
import { ClientAreaAuthorizationService } from '../client-area/services/client-area-authorization.service';
import { ClientAreaEligibilityService } from '../client-area/services/client-area-eligibility.service';
import {
  NotificationRecipientSurface,
  NotificationDeliveryChannel,
  NotificationDeliveryStatus,
} from '../notifications/enums';
import { ConfigService } from '@nestjs/config';
import {
  NotificationEntity,
  NotificationRecipientEntity,
  NotificationDeliveryEntity,
} from '../notifications/entities';
import { NotificationEventProcessorService } from '../notifications/services/notification-event-processor.service';
import { NotificationCatalogService } from '../notifications/catalog';
import { NotificationRecipientResolverService } from '../notifications/services/notification-recipient-resolver.service';
import { SelfNotificationPolicy } from '../notifications/policies';
import { ClientNotificationSurfaceRegistry } from '../notifications/ports/client-notification-surface.port';
import { ClientAgencyBillingNotificationsService } from './client-agency-billing-notifications.service';
import {
  ContractRecord,
  ContractDocument,
  ContractDefaults,
} from '../contracts/entities';
import {
  FinanceInvoiceLine,
  FinancePayment,
  FinancePaymentAllocation,
} from '../finance/entities';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import { NotFoundException, ForbiddenException } from '@nestjs/common';
import { getAgencyTypeOrmConfig } from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { FinanceInvoice } from '../finance/entities';
import { AgencyClient } from '../clients/entities/agency-client.entity';
import { AgencyClientCompanyContext } from '../clients/entities/agency-client-company-context.entity';
import { ClientInvoiceOwnershipResolver } from '../finance/services/client-invoice-ownership.resolver';
import type { ClientAreaContext } from '../client-area/client-area.types';
import { ClientAgencyBillingService } from './client-agency-billing.service';
import { ProjectsClientAreaScopeService } from '../projects/client-area/projects-client-area-scope.service';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import { ProjectBoardsService } from '../projects/services/project-boards.service';
import { ProjectsCrudService } from '../projects/services/projects-crud.service';
import {
  AgencyProject,
  AgencyProjectStage,
  AgencyTask,
  AgencyProjectEvent,
  AgencyProjectFollower,
  AgencyProjectAttachment,
} from '../projects/entities';
import { TasksCrudService } from '../projects/services/tasks-crud.service';
import {
  AgencyTaskStage,
  AgencyPersonalTaskStage,
  AgencyTaskAttachment,
  AgencyTaskChecklistItem,
  AgencyTaskComment,
  AgencyTaskTimeEntry,
} from '../projects/entities';

describePostgresIntegration()(
  'CA9 isolated PostgreSQL contracts (lyra_agency_test only)',
  () => {
    let db: DataSource,
      admin: DataSource,
      billing: ClientAgencyBillingService,
      adapter: ProjectsClientAreaScopeService,
      projects: ProjectsCrudService,
      tasks: TasksCrudService;
    const schema = `ca9_${randomUUID().replaceAll('-', '')}`;
    const tenant = randomUUID(),
      workspace = randomUUID(),
      client = randomUUID(),
      foreignClient = randomUUID(),
      company = randomUUID(),
      otherCompany = randomUUID(),
      contact = randomUUID(),
      foreignContact = randomUUID(),
      user = randomUUID();
    const invoice = randomUUID(),
      foreignInvoice = randomUUID(),
      draft = randomUUID(),
      project = randomUUID(),
      foreignProject = randomUUID(),
      card = randomUUID(),
      foreignCard = randomUUID(),
      privateCard = randomUUID(),
      contract = randomUUID(),
      foreignContract = randomUUID(),
      doc = randomUUID(),
      foreignDoc = randomUUID();
    const context = () =>
      ({
        tenantId: tenant,
        workspaceId: workspace,
        agencyClientId: client,
        companyContextId: company,
        userId: user,
        role: 'client_owner',
        memberAccess: { agency_projects: { level: 'operator' } },
      }) as ClientAreaContext;
    beforeAll(async () => {
      if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
        throw new Error('CA9 requires lyra_agency_test');
      const config = getAgencyTypeOrmConfig();
      admin = await new DataSource({
        ...config,
        name: 'ca9-admin',
        synchronize: false,
        migrationsRun: false,
      } as DataSourceOptions).initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      db = await new DataSource({
        ...config,
        name: 'ca9',
        schema,
        entities: [
          AgencyUserProfileEntity,
          ContactEntity,
          ContactCompanyLinkEntity,
          ClientAreaIdentityContactEntity,
          ClientAreaMembershipEntity,
          ClientAreaSelfAccessEntity,
          ClientAreaCompanySettingsEntity,
          AgencyUserSessionEntity,
          AgencyUserSecuritySettingsEntity,
          AgencyWorkspaceUserEntity,
          NotificationEntity,
          NotificationRecipientEntity,
          NotificationDeliveryEntity,
          AgencyClient,
          AgencyClientCompanyContext,
          FinanceInvoice,
          FinanceInvoiceLine,
          FinancePayment,
          FinancePaymentAllocation,
          ContractRecord,
          ContractDocument,
          ContractDefaults,
          AgencyProject,
          AgencyProjectStage,
          AgencyTask,
          AgencyProjectEvent,
          AgencyProjectFollower,
          AgencyProjectAttachment,
          AgencyTaskStage,
          AgencyPersonalTaskStage,
          AgencyTaskAttachment,
          AgencyTaskChecklistItem,
          AgencyTaskComment,
          AgencyTaskTimeEntry,
        ],
        synchronize: false,
        migrationsRun: false,
        extra: { options: `-c search_path=${schema},public` },
      } as DataSourceOptions).initialize();
      // Entity schema only in this disposable CA9 schema; no public schema migration or production access.
      await db.synchronize();
      for (const [id, contactId] of [
        [client, contact],
        [foreignClient, foreignContact],
      ])
        await db.query(
          `INSERT INTO agency_clients(id,tenant_id,workspace_id,display_name,contact_id) VALUES($1,$2,$3,'Client',$4)`,
          [id, tenant, workspace, contactId],
        );
      await db.query(
        `INSERT INTO agency_client_company_contexts(id,tenant_id,workspace_id,agency_client_id,company_contact_id) VALUES($1,$2,$3,$4,$5)`,
        [company, tenant, workspace, client, contact],
      );
      for (const [id, customer, status] of [
        [invoice, contact, 'issued'],
        [foreignInvoice, foreignContact, 'issued'],
        [draft, contact, 'draft'],
      ])
        await db.query(
          `INSERT INTO finance_invoices(id,tenant_id,workspace_id,customer_id,invoice_number,status,total_amount,metadata,notes) VALUES($1,$2,$3,$4,$5,$6,123.45,'{"secret":"private"}','internal')`,
          [id, tenant, workspace, customer, id, status],
        );
      for (const [id, c] of [
        [project, client],
        [foreignProject, foreignClient],
      ])
        await db.query(
          `INSERT INTO agency_projects(id,tenant_id,workspace_id,client_id,name) VALUES($1,$2,$3,$4,'Project')`,
          [id, tenant, workspace, c],
        );
      for (const [id, c, p, v] of [
        [card, client, project, 'workspace'],
        [foreignCard, foreignClient, foreignProject, 'workspace'],
        [privateCard, client, project, 'private'],
      ])
        await db.query(
          `INSERT INTO agency_tasks(id,tenant_id,workspace_id,client_id,project_id,title,created_by_id,visibility) VALUES($1,$2,$3,$4,$5,'Card',$6,$7)`,
          [id, tenant, workspace, c, p, randomUUID(), v],
        );
      for (const [id, c] of [
        [contract, client],
        [foreignContract, foreignClient],
      ])
        await db.query(
          `INSERT INTO agency_contract_records(id,tenant_id,workspace_id,target_type,target_id,title,status,signature_provider,valid_from,valid_until) VALUES($1,$2,$3,'client',$4,'Signed','completed','autentique','2026-01-01','2027-01-01')`,
          [id, tenant, workspace, c],
        );
      for (const [id, c] of [
        [doc, contract],
        [foreignDoc, foreignContract],
      ])
        await db.query(
          `INSERT INTO agency_contract_documents(id,tenant_id,workspace_id,contract_id,type,file_name,mime_type,file_key) VALUES($1,$2,$3,$4,'signed_pdf','signed.pdf','application/pdf','private-key')`,
          [id, tenant, workspace, c],
        );
      const ownership = new ClientInvoiceOwnershipResolver(
        db.getRepository(AgencyClient),
        db.getRepository(AgencyClientCompanyContext),
      );
      billing = new ClientAgencyBillingService(
        db,
        ownership,
        {} as never,
        {} as never,
        {
          getContractDocumentFile: () =>
            Promise.resolve({
              buffer: Buffer.from('%PDF-test'),
              fileName: 'signed.pdf',
            }),
        } as never,
        {} as never,
      );
      adapter = new ProjectsClientAreaScopeService(
        db,
        new ClientAreaBridgeRegistry(),
      );
      projects = new ProjectsCrudService(
        db.getRepository(AgencyProject),
        db.getRepository(AgencyProjectEvent),
        db.getRepository(AgencyTask),
        db.getRepository(AgencyProjectFollower),
        db.getRepository(AgencyProjectAttachment),
      );
      tasks = new TasksCrudService(
        db.getRepository(AgencyTask),
        db.getRepository(AgencyProjectEvent),
        db.getRepository(AgencyProject),
        db.getRepository(AgencyTaskStage),
        db.getRepository(AgencyPersonalTaskStage),
        db.getRepository(AgencyTaskAttachment),
        db.getRepository(AgencyTaskChecklistItem),
        db.getRepository(AgencyTaskComment),
        db.getRepository(AgencyTaskTimeEntry),
        {} as never,
        { publishAssigned: jest.fn().mockResolvedValue(undefined) } as never,
      );
    });
    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.destroy();
      }
    });
    it('confines emitted invoices by tenant/client, shares Agency billing across same-client companies, denies drafts and non-Owner', async () => {
      expect(
        (await billing.invoices(context())).invoices.map((row) => row.id),
      ).toEqual([invoice]);
      expect(
        (
          await billing.invoice(
            { ...context(), companyContextId: otherCompany },
            invoice,
          )
        ).invoice.id,
      ).toBe(invoice);
      await expect(
        billing.invoice(context(), foreignInvoice),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(billing.invoice(context(), draft)).rejects.toBeInstanceOf(
        NotFoundException,
      );
      await expect(
        billing.invoice({ ...context(), tenantId: randomUUID() }, invoice),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        billing.invoices({ ...context(), role: 'client_member' }),
      ).rejects.toBeInstanceOf(ForbiddenException);
      expect(
        JSON.stringify(await billing.invoice(context(), invoice)),
      ).not.toContain('private');
    });
    it('returns signed current/history and streams only a signed document of this client', async () => {
      const result = await billing.contractHistory(context());
      expect(result.current?.contractId).toBe(contract);
      expect(result.history.map((row) => row.id)).toEqual([contract]);
      expect(
        (await billing.contractPdf(context(), contract, doc)).buffer.toString(),
      ).toBe('%PDF-test');
      await expect(
        billing.contractPdf(context(), contract, foreignDoc),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        billing.contractPdf(context(), foreignContract, foreignDoc),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
    it('resolves only client work and filters real collections before returning rows', async () => {
      const ctx = {
        tenantId: tenant,
        workspaceId: workspace,
        userId: user,
        role: 'client_area_actor',
        clientArea: context(),
      };
      expect((await projects.list(ctx, {})).map((row) => row.id)).toEqual([
        project,
      ]);
      expect(
        (await tasks.listWorkspaceTasks(ctx, {})).map((row) => row.id),
      ).toEqual([card]);
      for (const id of [foreignCard, privateCard])
        expect(
          await adapter.resolve(context(), '', {
            method: 'GET',
            routePath: '/agency/projects/tasks/:id',
            params: { id },
          }),
        ).toBeNull();
      expect(
        await adapter.resolve(context(), '', {
          method: 'PATCH',
          routePath: '/agency/projects/tasks/:id',
          params: { id: card },
          body: { status: 'archived' },
        }),
      ).toBeNull();
      expect(
        await adapter.resolve(context(), '', {
          method: 'PATCH',
          routePath: '/agency/projects/tasks/:id',
          params: { id: card },
          body: { title: 'Client edit' },
        }),
      ).not.toBeNull();
    });
    it('excludes foreign-client tasks from project totals even with an inconsistent legacy project link', async () => {
      const boards = new ProjectBoardsService(
        db.getRepository(AgencyProject),
        db.getRepository(AgencyProjectStage),
        db.getRepository(AgencyTask),
        db.getRepository(AgencyTaskStage),
        db.getRepository(AgencyPersonalTaskStage),
      );
      const ctx = {
        tenantId: tenant,
        workspaceId: workspace,
        userId: user,
        clientArea: context(),
      };
      await db.query('UPDATE agency_tasks SET project_id=$1 WHERE id=$2', [
        project,
        foreignCard,
      ]);
      try {
        const board = await boards.getProjectsBoard(ctx);
        const cards = [
          ...board.columns.flatMap((column) => column.cards),
          ...board.unassigned.cards,
        ];
        expect(cards).toHaveLength(1);
        expect(cards[0].taskCount).toBe(1);
      } finally {
        await db.query('UPDATE agency_tasks SET project_id=$1 WHERE id=$2', [
          foreignProject,
          foreignCard,
        ]);
      }
    });
    it('writes client-created tasks into the same Agency table, forcing client and creator', async () => {
      const ctx = {
        tenantId: tenant,
        workspaceId: workspace,
        userId: user,
        role: 'client_area_actor',
        clientArea: context(),
      };
      const created = await tasks.createWorkspaceTask(ctx, {
        title: 'Created',
        clientId: foreignClient,
      });
      const [row] = await db.query<
        Array<{ client_id: string; created_by_id: string }>
      >('SELECT client_id,created_by_id FROM agency_tasks WHERE id=$1', [
        created.id,
      ]);
      expect(row).toEqual({ client_id: client, created_by_id: user });
      await db.getRepository(AgencyTask).delete(created.id);
    });
    it('persists each source once through real NTF-C1 under concurrent scans, with feed and email', async () => {
      await db.query(
        'UPDATE finance_invoices SET issued_at=now() WHERE id=$1',
        [invoice],
      );
      const surface = new ClientNotificationSurfaceRegistry();
      const recipient = {
        userId: user,
        membershipId: randomUUID(),
        companyContextId: company,
        email: 'owner@example.test',
      };
      surface.register({
        resolveAudience: () => Promise.resolve([recipient]),
        revalidate: () => Promise.resolve(recipient),
      });
      const catalog = new NotificationCatalogService();
      catalog.onModuleInit();
      const sendEmail = jest.fn().mockResolvedValue(undefined);
      const processor = new NotificationEventProcessorService(
        db,
        { find: () => Promise.resolve([]) } as never,
        {} as never,
        { findOne: () => Promise.resolve(null) } as never,
        catalog,
        new NotificationRecipientResolverService(),
        new SelfNotificationPolicy(),
        { emitCreatedForRecipient: () => Promise.resolve() } as never,
        { sendEmail } as never,
        {} as never,
        new ConfigService(),
        {} as never,
        surface,
      );
      const ownership = new ClientInvoiceOwnershipResolver(
        db.getRepository(AgencyClient),
        db.getRepository(AgencyClientCompanyContext),
      );
      const scheduler = new ClientAgencyBillingNotificationsService(
        db,
        ownership,
        processor,
      );
      const scope = {
        tenantId: tenant,
        workspaceId: workspace,
        agencyClientId: client,
        companyContextId: company,
        ownerSince: new Date('2026-01-01'),
      };
      await Promise.all([scheduler.scan(scope), scheduler.scan(scope)]);
      const notifications = await db.getRepository(NotificationEntity).find();
      expect(notifications.map((row) => row.eventType).sort()).toEqual([
        'agency.contract.document_available',
        'agency.invoice.issued',
      ]);
      const recipients = await db
        .getRepository(NotificationRecipientEntity)
        .find();
      expect(recipients).toHaveLength(2);
      expect(
        recipients.every(
          (row) =>
            row.userId === user &&
            row.recipientSurface === NotificationRecipientSurface.CLIENT_AREA,
        ),
      ).toBe(true);
      const deliveries = await db
        .getRepository(NotificationDeliveryEntity)
        .find();
      expect(
        deliveries.filter(
          (row) =>
            row.channel === NotificationDeliveryChannel.IN_APP &&
            row.status === NotificationDeliveryStatus.SENT,
        ),
      ).toHaveLength(2);
      expect(
        deliveries.filter(
          (row) =>
            row.channel === NotificationDeliveryChannel.EMAIL &&
            row.status === NotificationDeliveryStatus.SENT,
        ),
      ).toHaveLength(2);
      expect(sendEmail).toHaveBeenCalledTimes(2);
      expect(
        notifications.every(
          (row) =>
            row.metadata?.clientActionUrl ===
            `/client-area/c/${company}/agency/billing`,
        ),
      ).toBe(true);
    });
    it('revalidates real sessions, CRM/membership scope and archived client state before billing', async () => {
      const person = randomUUID(),
        memberId = randomUUID(),
        sessionId = randomUUID();
      await db.query(
        `INSERT INTO contacts(id,tenant_id,workspace_id,type,display_name) VALUES($1,$3,$4,'organization','Company'),($2,$3,$4,'person','Owner')`,
        [contact, person, tenant, workspace],
      );
      await db.query(
        `INSERT INTO contact_company_links(tenant_id,workspace_id,person_contact_id,company_contact_id,linked_at) VALUES($1,$2,$3,$4,now())`,
        [tenant, workspace, person, contact],
      );
      await db.query(
        `INSERT INTO client_area_identity_contacts(tenant_id,workspace_id,user_id,contact_id,linked_at) VALUES($1,$2,$3,$4,now())`,
        [tenant, workspace, user, person],
      );
      await db.query(
        `INSERT INTO client_area_memberships(id,tenant_id,workspace_id,agency_client_id,company_context_id,user_id,role,granted_at) VALUES($1,$2,$3,$4,$5,$6,'client_owner',now())`,
        [memberId, tenant, workspace, client, company, user],
      );
      await db.query(
        `INSERT INTO user_security_settings(tenant_id,user_id,current_email) VALUES($1,$2,'owner@example.test')`,
        [tenant, user],
      );
      await db.query(
        `INSERT INTO user_sessions(id,tenant_id,user_id,title,browser,status,surface) VALUES($1,$2,$3,'Test','Test','active','client_area')`,
        [sessionId, tenant, user],
      );
      const sessions = new ClientAreaSessionService(
        db.getRepository(AgencyUserSessionEntity),
        db.getRepository(AgencyUserSecuritySettingsEntity),
        db.getRepository(AgencyWorkspaceUserEntity),
        db.getRepository(ClientAreaSelfAccessEntity),
      );
      const authorization = new ClientAreaAuthorizationService(
        db.getRepository(ClientAreaMembershipEntity),
        db.getRepository(AgencyClientCompanyContext),
        db.getRepository(ContactEntity),
        db.getRepository(AgencyClient),
        {
          assertAgencyEnabled: () => Promise.resolve(),
          resolveCompanyAccess: () =>
            Promise.resolve({
              modules: { agency_billing: true, agency_projects: true },
              analyticsProducts: [],
            }),
        } as never,
        new ClientAreaEligibilityService(),
      );
      const payload = {
        sub: user,
        tenantId: tenant,
        sessionId,
        typ: 'client_area' as const,
      };
      const identity = await sessions.authenticate(payload);
      const ctx = await authorization.authorize({
        identity,
        companyContextId: company,
        module: 'agency_billing',
      });
      expect(
        (await billing.invoices(ctx)).invoices.map((row) => row.id),
      ).toEqual([invoice]);
      await expect(
        authorization.authorize({
          identity,
          companyContextId: otherCompany,
          module: 'agency_billing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await expect(
        authorization.authorize({
          identity: { ...identity, tenantId: randomUUID() },
          companyContextId: company,
          module: 'agency_billing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await db.query(
        `UPDATE agency_clients SET status='archived',archived_at=now() WHERE id=$1`,
        [client],
      );
      await expect(
        authorization.authorize({
          identity,
          companyContextId: company,
          module: 'agency_billing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await db.query(
        `UPDATE agency_clients SET status='active',archived_at=NULL WHERE id=$1`,
        [client],
      );
      await db.query(
        `UPDATE client_area_memberships SET status='revoked',revoked_at=now() WHERE id=$1`,
        [memberId],
      );
      await expect(
        authorization.authorize({
          identity,
          companyContextId: company,
          module: 'agency_billing',
        }),
      ).rejects.toBeInstanceOf(NotFoundException);
      await db
        .getRepository(AgencyUserProfileEntity)
        .save({ tenantId: tenant, userId: user, displayName: 'Client Author' });
      await db.getRepository(AgencyTaskComment).save({
        tenantId: tenant,
        workspaceId: workspace,
        taskId: card,
        authorId: user,
        body: 'Client comment',
      });
      const actors = new ActorDirectoryService(
        db.getRepository(AgencyUserProfileEntity),
        db.getRepository(ClientAreaMembershipEntity),
        db.getRepository(AgencyWorkspaceUserEntity),
      );
      expect(await actors.resolveNames(tenant, [user])).toEqual({
        [user]: 'Client Author (cliente)',
      });
      await sessions.revokeAll(tenant, user);
      await expect(sessions.authenticate(payload)).rejects.toBeInstanceOf(
        UnauthorizedException,
      );
    });
    it('downloads only the canonical signed manual principal attachment, including legacy records', async () => {
      const recordId = randomUUID(),
        fileId = randomUUID();
      await db.query(
        `INSERT INTO agency_contract_records(id,tenant_id,workspace_id,target_type,target_id,title,status,signature_provider,metadata) VALUES($1,$2,$3,'client',$4,'Legacy','draft','none',$5)`,
        [
          recordId,
          tenant,
          workspace,
          client,
          {
            clientContract: {
              mode: 'manual',
              attachedPdf: { documentId: fileId },
            },
          },
        ],
      );
      await db.query(
        `INSERT INTO agency_contract_documents(id,tenant_id,workspace_id,contract_id,type,attachment_kind,file_name,mime_type,file_key) VALUES($1,$2,$3,$4,'attachment','contract_pdf','legacy.pdf','application/pdf','legacy-private-key')`,
        [fileId, tenant, workspace, recordId],
      );
      try {
        expect(
          (await billing.contractHistory(context())).history
            .find((row) => row.id === recordId)
            ?.documents.map((row) => row.id),
        ).toEqual([fileId]);
        expect(
          (
            await billing.contractPdf(context(), recordId, fileId)
          ).buffer.toString(),
        ).toBe('%PDF-test');
        await db.query(
          `UPDATE agency_contract_records SET metadata=jsonb_set(metadata,'{clientContract,attachedPdf,signed}','false') WHERE id=$1`,
          [recordId],
        );
        await expect(
          billing.contractPdf(context(), recordId, fileId),
        ).rejects.toBeInstanceOf(NotFoundException);
      } finally {
        await db.getRepository(ContractDocument).delete(fileId);
        await db.getRepository(ContractRecord).delete(recordId);
      }
    });
  },
);
