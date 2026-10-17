import { Test } from '@nestjs/testing';
import { getDataSourceToken, getRepositoryToken } from '@nestjs/typeorm';
import { AgencyContactsService } from '../agency/agency-contacts.service';
import { FilesService } from '../../common/files/files.service';
import { AgencyClientCompanyContextService } from './services/agency-client-company-context.service';
import { ContactCompanyLinkEntity } from '../contacts/entities/contact-company-link.entity';
import { randomUUID } from 'node:crypto';
import { DataSource, type DataSourceOptions } from 'typeorm';
import {
  agencyEntities,
  getAgencyTypeOrmConfig,
} from '../../config/typeorm.config';
import { describePostgresIntegration } from '../../testing/postgres-integration';
import { CreateAgencyClientCompanyProducts1799600000000 } from '../../database/migrations/1799600000000-create-agency-client-company-products';
import { CompanyProductRegistry } from '../../common/company-products/company-product.registry';
import { CompanyProductWriteInterceptor } from '../../common/company-products/company-product-write.interceptor';
import { ManagedContextDirectoryService } from '../../common/context/managed-context-directory.service';
import { AgencyClientAccessEntity } from '../permissions/entities/agency-client-access.entity';
import { AgencyClientProductAccessEntity } from '../permissions/entities/agency-client-product-access.entity';
import { AgencyClient } from './entities/agency-client.entity';
import { AgencyClientCompanyContext } from './entities/agency-client-company-context.entity';
import { AgencyClientCompanyProduct } from './entities/agency-client-company-product.entity';
import { ContactEntity } from '../contacts/entities/contact.entity';
import { PlatformAccountEntity } from '../platform/entities/platform-account.entity';
import { TenantProductEntitlementEntity } from '../platform/entities/tenant-product-entitlement.entity';
import { ClientManagedTenantProvisioningService } from './services/client-managed-tenant-provisioning.service';
import { ClientCompanyProductsService } from './services/client-company-products.service';
import { ClientNotificationPublisher } from './services/client-notification.publisher';
import { ClientsService } from './services/clients.service';
import { AgencyClientLifecycleHooks } from './agency-client-lifecycle-hooks';
import { SocialPublicationCompanyProductParticipant } from '../social-organic/publication/social-publication-company-product.participant';
import { SocialApprovalsCompanyProductParticipant } from '../social-approvals/social-approvals-company-product.participant';
import { SocialPublicationService } from '../social-organic/publication/social-publication.service';
import { SocialApprovalsService } from '../social-approvals/social-approvals.service';
import { SocialPublicationEntity } from '../social-organic/publication/entities/social-publication.entity';
import { SocialContentItemEntity } from '../social-planner/entities/social-content-item.entity';
import { SocialContentDestinationEntity } from '../social-planner/entities/social-content-destination.entity';
import { SocialOrganicAssetEntity } from '../social-organic/entities/social-organic-asset.entity';
import {
  SocialApprovalRequestEntity,
  SocialApprovalCommentEntity,
  SocialApprovalStageDecisionEntity,
} from '../social-approvals/entities';
import { LeadFlowCompanyProductParticipant } from '../leadflow-settings/leadflow-company-product.participant';
import { LeadFlowAgentsCompanyProductParticipant } from '../leadflow-agents/leadflow-agents-company-product.participant';
import { LeadFlowAutomationsCompanyProductParticipant } from '../leadflow-automations/leadflow-automations-company-product.participant';
import { LeadFlowAgendaCompanyProductParticipant } from '../leadflow-agenda/leadflow-agenda-company-product.participant';
import { LeadFlowClientSettingsService } from '../leadflow-settings/services/leadflow-client-settings.service';
import { LeadFlowBusinessModeTemplateService } from '../leadflow-settings/services/leadflow-business-mode-template.service';
import { CompanyContextService } from '../leadflow-settings/services/company-context.service';
import {
  LeadFlowClientSettingsEntity,
  LeadFlowBusinessModeTemplateEntity,
} from '../leadflow-settings/entities';
import { lastValueFrom, of, defer } from 'rxjs';
import type { ExecutionContext } from '@nestjs/common';

describePostgresIntegration()(
  'CA6 company products (lyra_agency_test only)',
  () => {
    let db: DataSource;
    let admin: DataSource;
    let service: ClientCompanyProductsService;
    let provisioning: ClientManagedTenantProvisioningService;
    let settings: LeadFlowClientSettingsService;
    let directory: ManagedContextDirectoryService;
    const schema = `ca6_${randomUUID().replaceAll('-', '')}`;
    const ctx = {
      tenantId: randomUUID(),
      workspaceId: randomUUID(),
      userId: randomUUID(),
    };
    const migration = new CreateAgencyClientCompanyProducts1799600000000();
    const notify = {
      publishManagedTenantConnected: jest.fn(),
      publishProductRemovalBlocked: jest.fn(),
    };
    const archived = jest.fn();
    beforeAll(async () => {
      if (process.env.AGENCY_DB_NAME !== 'lyra_agency_test')
        throw new Error('CA6 requires lyra_agency_test');
      const options = getAgencyTypeOrmConfig();
      admin = await new DataSource({
        ...options,
        name: 'ca6-admin',
        migrationsRun: false,
        synchronize: false,
      } as DataSourceOptions).initialize();
      await admin.query(`CREATE SCHEMA "${schema}"`);
      // Isolated schema, real schema shapes; public/test fixtures stay untouched.
      for (const table of [
        'contact_company_links',
        'agency_clients',
        'agency_client_company_contexts',
        'contacts',
        'platform_accounts',
        'tenant_product_entitlements',
        'social_plans',
        'social_content_items',
        'social_content_destinations',
        'social_publications',
        'social_publication_media',
        'social_organic_assets',
        'social_organic_connections',
        'social_approval_requests',
        'social_approval_comments',
        'social_approval_stage_decisions',
        'leadflow_client_settings',
        'leadflow_business_mode_templates',
        'leadflow_agents',
        'leadflow_agent_channel_bindings',
        'leadflow_automations',
        'scheduled_items',
      ]) {
        await admin.query(
          `CREATE TABLE "${schema}"."${table}" (LIKE public."${table}" INCLUDING ALL)`,
        );
      }
      db = await new DataSource({
        ...options,
        name: 'ca6',
        schema,
        entities: agencyEntities,
        migrationsRun: false,
        synchronize: false,
        extra: { options: `-c search_path=${schema},public` },
      } as DataSourceOptions).initialize();
      const runner = db.createQueryRunner();
      await runner.connect();
      try {
        await migration.up(runner);
        await migration.down(runner);
        await migration.up(runner);
      } finally {
        await runner.release();
      }
      const registry = new CompanyProductRegistry();
      const hooks = new AgencyClientLifecycleHooks();
      hooks.register({
        onClientArchived: archived,
        onCompanyContextArchived: jest.fn(),
      });
      const clients = new ClientsService(
        db.getRepository(AgencyClient),
        {} as never,
        {} as never,
        {} as never,
        {} as never,
        db.getRepository(TenantProductEntitlementEntity),
        {} as never,
        notify as unknown as ClientNotificationPublisher,
        {} as never,
        hooks,
        {} as never,
      );
      provisioning = new ClientManagedTenantProvisioningService(
        db,
        notify as unknown as ClientNotificationPublisher,
      );
      service = new ClientCompanyProductsService(
        db,
        registry,
        provisioning,
        notify as unknown as ClientNotificationPublisher,
        clients,
      );
      const publications = new SocialPublicationService(
        db.getRepository(SocialPublicationEntity),
        db.getRepository(SocialContentItemEntity),
        db.getRepository(SocialContentDestinationEntity),
        db.getRepository(SocialOrganicAssetEntity),
        {} as never,
        {} as never,
      );
      const approvals = new SocialApprovalsService(
        db.getRepository(SocialApprovalRequestEntity),
        db.getRepository(SocialApprovalCommentEntity),
        db.getRepository(SocialApprovalStageDecisionEntity),
        db,
        {} as never,
      );
      settings = new LeadFlowClientSettingsService(
        db,
        db.getRepository(AgencyClient),
        db.getRepository(LeadFlowClientSettingsEntity),
        db.getRepository(TenantProductEntitlementEntity),
        new LeadFlowBusinessModeTemplateService(
          db.getRepository(LeadFlowBusinessModeTemplateEntity),
        ),
        new CompanyContextService(),
      );
      for (const participant of [
        new SocialPublicationCompanyProductParticipant(registry, publications),
        new SocialApprovalsCompanyProductParticipant(registry, approvals),
        new LeadFlowCompanyProductParticipant(registry, settings),
        new LeadFlowAgentsCompanyProductParticipant(registry),
        new LeadFlowAutomationsCompanyProductParticipant(registry),
        new LeadFlowAgendaCompanyProductParticipant(registry),
      ])
        participant.onModuleInit();
      directory = new ManagedContextDirectoryService(
        db.getRepository(AgencyClient),
        db.getRepository(AgencyClientCompanyContext),
        db.getRepository(ContactEntity),
        db.getRepository(TenantProductEntitlementEntity),
        db.getRepository(AgencyClientAccessEntity),
        db.getRepository(AgencyClientProductAccessEntity),
        db.getRepository(AgencyClientCompanyProduct),
      );
      await db.query(
        `INSERT INTO leadflow_business_mode_templates(id,key,name,category,status,is_official,version,recommended_apps,supported_integrations) VALUES ($1,'agency_services','CA6','services','active',true,1,'[]','{}')`,
        [randomUUID()],
      );
    }, 60000);
    afterAll(async () => {
      if (db?.isInitialized) await db.destroy();
      if (admin?.isInitialized) {
        await admin.query(`DROP SCHEMA IF EXISTS "${schema}" CASCADE`);
        await admin.destroy();
      }
    });

    async function fixture() {
      const client = await db.getRepository(AgencyClient).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        displayName: 'CA6',
      });
      const contact = await db.getRepository(ContactEntity).save({
        ...ctx,
        type: 'organization',
        displayName: 'CA6 Company',
        status: 'active',
      });
      const company = await db.getRepository(AgencyClientCompanyContext).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        agencyClientId: client.id,
        companyContactId: contact.id,
        status: 'active',
      });
      return { client, company };
    }
    async function post(
      clientId: string,
      companyId: string,
      status = 'scheduled',
    ) {
      const plan = randomUUID(),
        content = randomUUID(),
        id = randomUUID();
      const asset = await db.getRepository(SocialOrganicAssetEntity).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        agencyClientId: clientId,
        companyContextId: companyId,
        provider: 'test',
        assetType: 'page',
        connectionId: randomUUID(),
        externalAssetId: randomUUID(),
        status: 'active',
        isPublishEnabled: true,
      });
      await db.query(
        `INSERT INTO social_plans(id,tenant_id,workspace_id,agency_client_id,company_context_id,title,period_start,period_end) VALUES($1,$2,$3,$4,$5,'CA6','2026-10-01','2026-10-31')`,
        [plan, ctx.tenantId, ctx.workspaceId, clientId, companyId],
      );
      await db.query(
        `INSERT INTO social_content_items(id,tenant_id,workspace_id,agency_client_id,plan_id,title) VALUES($1,$2,$3,$4,$5,'CA6')`,
        [content, ctx.tenantId, ctx.workspaceId, clientId, plan],
      );
      await db.query(
        `INSERT INTO social_publications(id,tenant_id,workspace_id,agency_client_id,content_item_id,provider,connection_id,asset_id,external_asset_id,status,scheduled_at,available_at,payload_snapshot,payload_hash,idempotency_key) VALUES($1,$2,$3,$4,$5,'test',$6,$7,'CA6',$8,now(),now(),'{}','hash',$9)`,
        [
          id,
          ctx.tenantId,
          ctx.workspaceId,
          clientId,
          content,
          asset.connectionId,
          asset.id,
          status,
          randomUUID(),
        ],
      );
      return id;
    }
    async function write(clientId: string, companyId: string) {
      const interceptor = new CompanyProductWriteInterceptor(db);
      const req = {
        method: 'POST',
        user: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
        managedContext: {
          operatingMode: 'client',
          clientId,
          companyContextId: companyId,
          productKey: 'social',
        },
      };
      return lastValueFrom<unknown>(
        interceptor.intercept(
          {
            switchToHttp: () => ({ getRequest: () => req }),
          } as ExecutionContext,
          { handle: () => of('written') },
        ),
      );
    }
    it('runs migration up/down/up with scoped FK, live uniqueness and append-only events', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      await expect(
        db.query(
          `UPDATE agency_client_company_product_events SET action='changed'`,
        ),
      ).rejects.toThrow('append-only');
      await expect(
        db.query(
          `INSERT INTO agency_client_company_products(tenant_id,workspace_id,agency_client_id,company_context_id,product_key,status) VALUES($1,$2,$3,$4,'leadflow','active')`,
          [randomUUID(), ctx.workspaceId, client.id, company.id],
        ),
      ).rejects.toThrow();
      await expect(
        db.query(
          `INSERT INTO agency_client_company_products(tenant_id,workspace_id,agency_client_id,company_context_id,product_key,status) VALUES($1,$2,$3,$4,'social','active')`,
          [ctx.tenantId, ctx.workspaceId, client.id, company.id],
        ),
      ).rejects.toThrow();
    });
    it('provisions once under concurrent ensure and concurrent activation', async () => {
      const { client, company } = await fixture();
      const tenants = await Promise.all(
        Array.from({ length: 4 }, () => provisioning.ensure(ctx, client.id)),
      );
      expect(new Set(tenants.map((c) => c.managedTenantId)).size).toBe(1);
      expect(
        await db
          .getRepository(PlatformAccountEntity)
          .countBy({ tenantId: tenants[0].managedTenantId! }),
      ).toBe(1);
      const result = await Promise.all([
        service.activate(ctx, client.id, company.id, 'social'),
        service.activate(ctx, client.id, company.id, 'social'),
      ]);
      expect(result[0].id).toBe(result[1].id);
    });
    it('rejects foreign scopes as 404 and removes a company without a product from the directory', async () => {
      const { client, company } = await fixture();
      await provisioning.ensure(ctx, client.id);
      await expect(
        service.activate(
          { ...ctx, tenantId: randomUUID() },
          client.id,
          company.id,
          'social',
        ),
      ).rejects.toMatchObject({ status: 404 });
      await service.activate(ctx, client.id, company.id, 'social');
      const check = {
        ...ctx,
        clientId: client.id,
        companyContextId: company.id,
        productKey: 'social',
        role: 'owner',
      };
      expect(await directory.canAccessClientProduct(check)).toBe(true);
      await service.remove(ctx, client.id, company.id, 'social', 'immediate');
      expect(await directory.canAccessClientProduct(check)).toBe(false);
      expect(
        (
          await directory.listAuthorizedClients(
            { ...ctx, role: 'owner' },
            'social',
          )
        ).find((c) => c.clientId === client.id),
      ).toBeUndefined();
    });
    it.each(['scheduled', 'queued'])(
      'cancels %s publications through the existing service on immediate removal',
      async (status) => {
        const { client, company } = await fixture();
        await service.activate(ctx, client.id, company.id, 'social');
        const id = await post(client.id, company.id, status);
        await service.remove(ctx, client.id, company.id, 'social', 'immediate');
        expect(
          (
            await db
              .getRepository(SocialPublicationEntity)
              .findOneByOrFail({ id })
          ).status,
        ).toBe('cancelled');
        expect(
          await service.remove(
            ctx,
            client.id,
            company.id,
            'social',
            'immediate',
          ),
        ).toMatchObject({ status: 'removed' });
      },
    );
    it('rejects immediate removal while processing, without disabling the product', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      await post(client.id, company.id, 'processing');
      await expect(
        service.remove(ctx, client.id, company.id, 'social', 'immediate'),
      ).rejects.toMatchObject({
        response: { code: 'company_product_publication_processing' },
      });
      expect(
        await db
          .getRepository(AgencyClientCompanyProduct)
          .findOneBy({ companyContextId: company.id, status: 'active' }),
      ).not.toBeNull();
    });
    it('keeps scheduled removal readable, blocks writes with 409 and waits for processing to finish', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      const id = await post(client.id, company.id, 'processing');
      await service.remove(
        ctx,
        client.id,
        company.id,
        'social',
        'after_last_publication',
      );
      expect(
        await directory.canAccessClientProduct({
          ...ctx,
          clientId: client.id,
          companyContextId: company.id,
          productKey: 'social',
          role: 'owner',
        }),
      ).toBe(true);
      await expect(write(client.id, company.id)).rejects.toMatchObject({
        response: { code: 'company_product_removal_scheduled' },
      });
      await service.reconcilePending();
      expect(
        await db.getRepository(AgencyClientCompanyProduct).findOneBy({
          companyContextId: company.id,
          status: 'removal_scheduled',
        }),
      ).not.toBeNull();
      await db
        .getRepository(SocialPublicationEntity)
        .update(id, { status: 'published' });
      await service.reconcilePending();
      expect(
        await db
          .getRepository(AgencyClientCompanyProduct)
          .findOneBy({ companyContextId: company.id, status: 'removed' }),
      ).not.toBeNull();
    });
    it('blocks on a tracked failure, notifies once and supports cancellation', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      const id = await post(client.id, company.id);
      await service.remove(
        ctx,
        client.id,
        company.id,
        'social',
        'after_last_publication',
      );
      await db
        .getRepository(SocialPublicationEntity)
        .update(id, { status: 'failed' });
      const before = notify.publishProductRemovalBlocked.mock.calls.length;
      await service.reconcilePending();
      await service.reconcilePending();
      expect(notify.publishProductRemovalBlocked.mock.calls.length).toBe(
        before + 1,
      );
      expect(
        await service.action(
          ctx,
          client.id,
          company.id,
          'social',
          'cancel-removal',
        ),
      ).toMatchObject({ status: 'active' });
      expect(await write(client.id, company.id)).toBe('written');
    });
    it('ignores historical failures outside the scheduled removal snapshot', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      await post(client.id, company.id, 'failed');
      const id = await post(client.id, company.id);
      await service.remove(
        ctx,
        client.id,
        company.id,
        'social',
        'after_last_publication',
      );
      await db
        .getRepository(SocialPublicationEntity)
        .update(id, { status: 'published' });
      await service.reconcilePending();
      expect(
        await db
          .getRepository(AgencyClientCompanyProduct)
          .findOneBy({ companyContextId: company.id, status: 'removed' }),
      ).not.toBeNull();
    });
    it('archives only after the last publication and calls the CA5 effective archive path', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      const id = await post(client.id, company.id);
      await service.archive(ctx, client.id, 'after_last_publication');
      expect(
        await db.getRepository(AgencyClient).findOneBy({ id: client.id }),
      ).toMatchObject({ status: 'active', archiveStatus: 'scheduled' });
      await expect(write(client.id, company.id)).rejects.toMatchObject({
        response: { code: 'client_archive_scheduled' },
      });
      await db
        .getRepository(SocialPublicationEntity)
        .update(id, { status: 'published' });
      await service.reconcilePending();
      expect(
        await db.getRepository(AgencyClient).findOneBy({ id: client.id }),
      ).toMatchObject({ status: 'archived', archiveStatus: 'none' });
      expect(archived).toHaveBeenCalledWith(
        expect.objectContaining({
          agencyClientId: client.id,
          actorUserId: null,
        }),
      );
    });
    it('creates LeadFlow wizard settings, counts two companies of one client separately and pauses its robots', async () => {
      const { client, company } = await fixture();
      const first = await service.activate(
        ctx,
        client.id,
        company.id,
        'leadflow',
      );
      expect(first.leadflowSettingsId).toBeTruthy();
      const org = await db.getRepository(ContactEntity).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: 'organization',
        displayName: 'CA6 Second',
      });
      const second = await db.getRepository(AgencyClientCompanyContext).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        agencyClientId: client.id,
        companyContactId: org.id,
      });
      await service.activate(ctx, client.id, second.id, 'leadflow');
      expect((await settings.getCapacity(ctx)).activeCompanies).toBe(2);
      const agent = randomUUID(),
        automation = randomUUID();
      await db.query(
        `INSERT INTO leadflow_agents(id,tenant_id,workspace_id,agency_client_id,company_context_id,context_type,business_mode_key,name,status) VALUES($1,$2,$3,$4,$5,'client','agency_services','CA6','active')`,
        [agent, ctx.tenantId, ctx.workspaceId, client.id, company.id],
      );
      await db.query(
        `INSERT INTO leadflow_automations(id,tenant_id,workspace_id,agency_client_id,company_context_id,context_type,business_mode_key,recipe_key,name,category,status) VALUES($1,$2,$3,$4,$5,'client','agency_services','test','CA6','test','active')`,
        [automation, ctx.tenantId, ctx.workspaceId, client.id, company.id],
      );
      await service.remove(ctx, client.id, company.id, 'leadflow', 'immediate');
      expect(
        (
          await db.query<Array<{ status: string }>>(
            `SELECT status FROM leadflow_agents WHERE id=$1`,
            [agent],
          )
        )[0].status,
      ).toBe('paused');
      expect(
        (
          await db.query<Array<{ status: string }>>(
            `SELECT status FROM leadflow_automations WHERE id=$1`,
            [automation],
          )
        )[0].status,
      ).toBe('paused');
      expect(
        await db
          .getRepository(LeadFlowClientSettingsEntity)
          .findOneBy({ id: first.leadflowSettingsId! }),
      ).toMatchObject({ status: 'archived' });
      expect((await settings.getCapacity(ctx)).activeCompanies).toBe(1);
    });
    it('retries a failed scheduled removal with a new publication attempt and supports remove-now', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      const original = await post(client.id, company.id);
      await service.remove(
        ctx,
        client.id,
        company.id,
        'social',
        'after_last_publication',
      );
      await db
        .getRepository(SocialPublicationEntity)
        .update(original, { status: 'failed' });
      await service.reconcilePending();
      expect(
        await service.action(ctx, client.id, company.id, 'social', 'retry'),
      ).toMatchObject({ status: 'removal_scheduled' });
      const current = await service.pending(
        ctx,
        client.id,
        company.id,
        'social',
      );
      expect(current.counts.publication).toBe(1);
      expect(current.items[0].id).not.toBe(original);
      expect(
        await service.action(
          ctx,
          client.id,
          company.id,
          'social',
          'remove-now',
        ),
      ).toMatchObject({ status: 'removed' });
      expect(
        await db
          .getRepository(SocialPublicationEntity)
          .findOneBy({ id: original }),
      ).toMatchObject({ status: 'failed' });
    });
    it.each([
      'draft',
      'awaiting_internal_review',
      'awaiting_client',
      'changes_requested',
    ])('cancels open AP1 approvals in %s state', async (status) => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      const id = randomUUID();
      await db.query(
        `INSERT INTO social_approval_requests(id,tenant_id,workspace_id,agency_client_id,company_context_id,subject_type,subject_id,subject_revision_id,source_module,display_type,title,subject_version_label,status,current_stage,requested_by_user_id,requested_at) VALUES($1,$2,$3,$4,$5,'content',$6,$7,'planner','post','CA6','1',$8,'internal',$9,now())`,
        [
          id,
          ctx.tenantId,
          ctx.workspaceId,
          client.id,
          company.id,
          randomUUID(),
          randomUUID(),
          status,
          ctx.userId,
        ],
      );
      expect(
        (await service.pending(ctx, client.id, company.id, 'social')).counts
          .approval,
      ).toBe(1);
      await service.remove(ctx, client.id, company.id, 'social', 'immediate');
      expect(
        await db.getRepository(SocialApprovalRequestEntity).findOneBy({ id }),
      ).toMatchObject({ status: 'cancelled' });
    });
    it('pauses archival on failure and supports cancel, retry, and remove-now', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      const id = await post(client.id, company.id);
      await service.archive(ctx, client.id, 'after_last_publication');
      await db
        .getRepository(SocialPublicationEntity)
        .update(id, { status: 'failed' });
      await service.reconcilePending();
      expect(
        await db.getRepository(AgencyClient).findOneBy({ id: client.id }),
      ).toMatchObject({ status: 'active', archiveStatus: 'blocked' });
      await service.archiveAction(ctx, client.id, 'retry');
      expect(
        (await service.pending(ctx, client.id, company.id, 'social')).counts
          .publication,
      ).toBe(1);
      await service.archiveAction(ctx, client.id, 'cancel-removal');
      expect(await write(client.id, company.id)).toBe('written');
      await service.archive(ctx, client.id, 'after_last_publication');
      await service.archiveAction(ctx, client.id, 'remove-now');
      expect(
        await db.getRepository(AgencyClient).findOneBy({ id: client.id }),
      ).toMatchObject({ status: 'archived', archiveStatus: 'none' });
    });
    it('suspends entitlement only after the last company is removed and reactivates without restoring robots', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      const org = await db.getRepository(ContactEntity).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: 'organization',
        displayName: 'CA6 sibling',
      });
      const sibling = await db.getRepository(AgencyClientCompanyContext).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        agencyClientId: client.id,
        companyContactId: org.id,
      });
      await service.activate(ctx, client.id, sibling.id, 'social');
      await service.remove(ctx, client.id, company.id, 'social', 'immediate');
      const tenant = (
        await db.getRepository(AgencyClient).findOneByOrFail({ id: client.id })
      ).managedTenantId!;
      expect(
        await db
          .getRepository(TenantProductEntitlementEntity)
          .findOneBy({ tenantId: tenant, productKey: 'social' as never }),
      ).toMatchObject({ status: 'active' });
      const listed = (
        await directory.listAuthorizedClients(
          { ...ctx, role: 'owner' },
          'social',
        )
      ).find((c) => c.clientId === client.id)!;
      expect(listed.companies.map((c) => c.companyContextId)).toEqual([
        sibling.id,
      ]);
      await service.remove(ctx, client.id, sibling.id, 'social', 'immediate');
      expect(
        await db
          .getRepository(TenantProductEntitlementEntity)
          .findOneBy({ tenantId: tenant, productKey: 'social' as never }),
      ).toMatchObject({ status: 'suspended' });
      expect(
        await service.activate(ctx, client.id, company.id, 'social'),
      ).toMatchObject({ status: 'active' });
    });
    it('enforces capacity even with no entitlement row and under concurrent company activations', async () => {
      const limit = (await settings.getCapacity(ctx)).activeCompanies + 1;
      await db.query(
        `INSERT INTO tenant_product_entitlements(tenant_id,product_key,status,source,settings) VALUES($1,'leadflow','active','manual',$2) ON CONFLICT(tenant_id,product_key) DO UPDATE SET settings=excluded.settings`,
        [ctx.tenantId, JSON.stringify({ maxManagedClients: limit })],
      );
      const a = await fixture(),
        b = await fixture();
      const results = await Promise.allSettled([
        service.activate(ctx, a.client.id, a.company.id, 'leadflow'),
        service.activate(ctx, b.client.id, b.company.id, 'leadflow'),
      ]);
      expect(results.filter((r) => r.status === 'fulfilled')).toHaveLength(1);
      expect(results.filter((r) => r.status === 'rejected')).toHaveLength(1);
      expect((await settings.getCapacity(ctx)).activeCompanies).toBe(limit);
    });
    it('backfills active entitled companies only and does not resurrect removed products', async () => {
      const { client, company } = await fixture();
      const managed = await provisioning.ensure(ctx, client.id);
      await db.query(
        `INSERT INTO tenant_product_entitlements(tenant_id,product_key,status,source) VALUES($1,'social','active','manual')`,
        [managed.managedTenantId],
      );
      const runner = db.createQueryRunner();
      await runner.connect();
      try {
        await migration.up(runner);
        await migration.up(runner);
      } finally {
        await runner.release();
      }
      expect(
        await db
          .getRepository(AgencyClientCompanyProduct)
          .countBy({ companyContextId: company.id, status: 'active' }),
      ).toBe(1);
      await service.remove(ctx, client.id, company.id, 'social', 'immediate');
      await db.query(
        `UPDATE tenant_product_entitlements SET status='active' WHERE tenant_id=$1 AND product_key='social'`,
        [managed.managedTenantId],
      );
      const again = db.createQueryRunner();
      await again.connect();
      try {
        await migration.up(again);
      } finally {
        await again.release();
      }
      expect(
        await db
          .getRepository(AgencyClientCompanyProduct)
          .countBy({ companyContextId: company.id, status: 'active' }),
      ).toBe(0);
    });

    it('associates a PF company and its canonical CRM link atomically (CA5 D-FE-2)', async () => {
      const person = await db.getRepository(ContactEntity).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: 'person',
        displayName: 'CA6 PF',
        status: 'active',
      });
      const client = await db.getRepository(AgencyClient).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        contactId: person.id,
        displayName: 'CA6 PF',
      });
      const company = await db.getRepository(ContactEntity).save({
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
        type: 'organization',
        displayName: 'CA6 PJ',
        status: 'active',
      });
      const ref = await Test.createTestingModule({
        providers: [
          AgencyClientCompanyContextService,
          AgencyContactsService,
          AgencyClientLifecycleHooks,
          { provide: FilesService, useValue: {} },
          { provide: getDataSourceToken('agency'), useValue: db },
          ...agencyEntities.map((e) => ({
            provide: getRepositoryToken(e, 'agency'),
            useValue: db.getRepository(e),
          })),
        ],
      }).compile();
      try {
        const companies = ref.get(AgencyClientCompanyContextService);
        await companies.create(ctx, client.id, {
          companyContactId: company.id,
        });
        expect(
          await db.getRepository(ContactCompanyLinkEntity).findOneBy({
            tenantId: ctx.tenantId,
            workspaceId: ctx.workspaceId,
            personContactId: person.id,
            companyContactId: company.id,
          }),
        ).toMatchObject({ status: 'active' });
        const next = await db.getRepository(ContactEntity).save({
          tenantId: ctx.tenantId,
          workspaceId: ctx.workspaceId,
          type: 'organization',
          displayName: 'CA6 failed PJ',
          status: 'active',
        });
        jest
          .spyOn(ref.get(AgencyContactsService), 'addCompanyLink')
          .mockRejectedValueOnce(new Error('CRM failed'));
        await expect(
          companies.create(ctx, client.id, { companyContactId: next.id }),
        ).rejects.toThrow('CRM failed');
        expect(
          await db.getRepository(AgencyClientCompanyContext).findOneBy({
            agencyClientId: client.id,
            companyContactId: next.id,
          }),
        ).toBeNull();
      } finally {
        await ref.close();
      }
    });
    it('closes the INSERT race at the database even after a request passed preflight', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      const id = await post(client.id, company.id);
      const original = await db
        .getRepository(SocialPublicationEntity)
        .findOneByOrFail({ id });
      const lifecycle = db.createQueryRunner(),
        request = db.createQueryRunner();
      await lifecycle.connect();
      await request.connect();
      await lifecycle.startTransaction();
      await request.startTransaction();
      try {
        await lifecycle.manager.getRepository(AgencyClient).findOne({
          where: { id: client.id },
          lock: { mode: 'pessimistic_write' },
        });
        const insert = request.manager
          .getRepository(SocialPublicationEntity)
          .save({
            ...original,
            id: randomUUID(),
            idempotencyKey: randomUUID(),
          });
        // Attach a rejection handler before committing the lifecycle transaction.
        const rejected = expect(insert).rejects.toMatchObject({
          driverError: { code: 'P0409' },
        });
        await lifecycle.manager
          .getRepository(AgencyClientCompanyProduct)
          .update(
            { companyContextId: company.id },
            { status: 'removal_scheduled' },
          );
        await lifecycle.commitTransaction();
        await rejected;
      } finally {
        if (lifecycle.isTransactionActive)
          await lifecycle.rollbackTransaction();
        await request.rollbackTransaction();
        await lifecycle.release();
        await request.release();
      }
    });
    it('does not retain a pool connection while a product HTTP handler runs', async () => {
      const { client, company } = await fixture();
      await service.activate(ctx, client.id, company.id, 'social');
      const one = await new DataSource({
        ...db.options,
        name: 'ca6-one',
        extra: { options: `-c search_path=${schema},public`, max: 1 },
      } as DataSourceOptions).initialize();
      try {
        const gate = new CompanyProductWriteInterceptor(one);
        const req = {
          method: 'POST',
          user: { tenantId: ctx.tenantId, workspaceId: ctx.workspaceId },
          managedContext: {
            operatingMode: 'client',
            clientId: client.id,
            companyContextId: company.id,
            productKey: 'social',
          },
        };
        const result = await lastValueFrom<unknown>(
          gate.intercept(
            {
              switchToHttp: () => ({ getRequest: () => req }),
            } as ExecutionContext,
            {
              handle: () =>
                defer(() =>
                  one.query<Array<{ value: number }>>('SELECT 1 AS value'),
                ),
            },
          ),
        );
        expect(result).toEqual([{ value: 1 }]);
      } finally {
        await one.destroy();
      }
    });
  },
);
