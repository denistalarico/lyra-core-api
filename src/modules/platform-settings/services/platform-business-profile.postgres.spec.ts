// Equivalence spec for S1.4.0 (D-3): the same `businessModeKey` change, run
// through the LeadFlow call shape and through the Platform call shape, must
// produce the same shared state — because both shapes call the exact same
// `LeadFlowClientSettingsService` methods. There is deliberately no second
// service implementation to instantiate here: this file proves that fact by
// only ever constructing `LeadFlowClientSettingsService` once and driving it
// through both call shapes, plus `PlatformBusinessProfileService` wrapping
// it. If a future change introduces a parallel write path, this spec still
// passes for the wrong reason unless the parallel path is what is under
// test — so treat any second service class touching
// `leadflow_client_settings` as a signal to extend this file first.

import { randomUUID } from 'node:crypto';
import { In } from 'typeorm';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { AgencyClient } from '../../clients/entities';
import { TenantProductEntitlementEntity } from '../../platform';
import { LeadFlowClientSettingsEntity } from '../../leadflow-settings/entities';
import { LeadFlowBusinessMode } from '../../leadflow-settings/enums/leadflow-business-mode.enum';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { CompanyContextService } from '../../leadflow-settings/services/company-context.service';
import { LeadFlowBusinessModeTemplateSeederService } from '../../leadflow-settings/services/leadflow-business-mode-template-seeder.service';
import { LeadFlowBusinessModeTemplateService } from '../../leadflow-settings/services/leadflow-business-mode-template.service';
import { LeadFlowClientSettingsService } from '../../leadflow-settings/services/leadflow-client-settings.service';
import { LeadFlowBusinessModeTemplateEntity } from '../../leadflow-settings/entities';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { PlatformBusinessProfileService } from './platform-business-profile.service';
import { mapBusinessProfileResponse } from '../dto/business-profile.view';

const run = describePostgresIntegration();

run(
  'Platform business-profile / LeadFlow domain equivalence (PostgreSQL)',
  () => {
    const tenantId = randomUUID();
    const workspaceId = randomUUID();
    const otherTenantId = randomUUID();
    const otherWorkspaceId = randomUUID();

    let settingsService: LeadFlowClientSettingsService;
    let platformService: PlatformBusinessProfileService;
    let templateService: LeadFlowBusinessModeTemplateService;

    const ctx = (
      overrides: { tenantId?: string; workspaceId?: string } = {},
    ) => ({
      tenantId: overrides.tenantId ?? tenantId,
      workspaceId: overrides.workspaceId ?? workspaceId,
      userId: randomUUID(),
    });

    beforeAll(async () => {
      if (!AgencyDataSource.isInitialized) await AgencyDataSource.initialize();

      // The disposable test database has no boot-time seed. The official
      // catalog (tenant_id IS NULL) is shared, idempotent fixture data — not
      // something this spec owns — so it is seeded through the same service
      // production boot uses, never inserted by hand.
      const templatesRepository = AgencyDataSource.getRepository(
        LeadFlowBusinessModeTemplateEntity,
      );
      await new LeadFlowBusinessModeTemplateSeederService(
        templatesRepository,
      ).seedOfficialTemplates();

      templateService = new LeadFlowBusinessModeTemplateService(
        templatesRepository,
      );
      settingsService = new LeadFlowClientSettingsService(
        AgencyDataSource,
        AgencyDataSource.getRepository(AgencyClient),
        AgencyDataSource.getRepository(LeadFlowClientSettingsEntity),
        AgencyDataSource.getRepository(TenantProductEntitlementEntity),
        templateService,
        new CompanyContextService(),
      );
      platformService = new PlatformBusinessProfileService(settingsService);
    });

    afterAll(async () => {
      // Sweeps by tenant rather than relying on nested `describe` blocks having
      // already cleaned up their own fixtures — cleanup here must be safe to
      // run regardless of Jest's hook ordering.
      await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete(
        { tenantId },
      );
      await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).delete(
        { tenantId: otherTenantId },
      );
      await AgencyDataSource.getRepository(AgencyClient).delete({ tenantId });
      await AgencyDataSource.destroy();
    });

    describe('agency context', () => {
      let settingsId: string;

      beforeAll(async () => {
        const settings = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).save({
          tenantId,
          workspaceId,
          contextType: LeadFlowSettingsContextType.Agency,
          businessModeKey: LeadFlowBusinessMode.AgencyServices,
        });
        settingsId = settings.id;
      });

      it('GET /platform/business-profile returns the same row as GET /leadflow/agency/settings', async () => {
        const leadflowView = await settingsService.getAgencySettings(ctx());
        const platformView = await platformService.getBusinessProfile(
          ctx(),
          null,
        );

        expect(platformView).toEqual(mapBusinessProfileResponse(leadflowView));
        expect(leadflowView.id).toBe(settingsId);
      });

      it('changing businessModeKey through the Platform path produces the same shared state as through the LeadFlow path', async () => {
        // Baseline via the LeadFlow call shape.
        const viaLeadFlow = await settingsService.updateAgencySettings(ctx(), {
          businessModeKey: LeadFlowBusinessMode.LocalServices,
        });

        // Revert, then repeat via the Platform call shape.
        await settingsService.updateAgencySettings(ctx(), {
          businessModeKey: LeadFlowBusinessMode.AgencyServices,
        });

        const viaPlatform = await platformService.updateBusinessProfile(
          ctx(),
          null,
          { businessModeKey: LeadFlowBusinessMode.LocalServices },
        );

        const persisted = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });

        // Same template reapointment.
        expect(persisted.businessModeTemplateId).toBe(
          viaLeadFlow.businessModeTemplateId,
        );
        // Same company-context draft seeding (contextDefaults applied once,
        // idempotently, by the same `withDefaults` call in both paths).
        expect(persisted.companyContextDraft).toEqual(
          viaLeadFlow.companyContextDraft,
        );
        expect(viaPlatform.businessModeKey).toBe(viaLeadFlow.businessModeKey);
        expect(viaPlatform.companyContextDraft).toEqual(
          viaLeadFlow.companyContextDraft,
        );

        // Restore the fixture's starting mode for isolation from other tests.
        await settingsService.updateAgencySettings(ctx(), {
          businessModeKey: LeadFlowBusinessMode.AgencyServices,
        });
      });

      it('rejects an unknown businessModeKey with 400 through the Platform path', async () => {
        await expect(
          platformService.updateBusinessProfile(ctx(), null, {
            businessModeKey: 'not_a_real_mode',
          }),
        ).rejects.toThrow();
      });
    });

    describe('client context and isolation', () => {
      let clientAId: string;
      let clientBId: string;
      let settingsAId: string;

      beforeAll(async () => {
        const clientA = await AgencyDataSource.getRepository(AgencyClient).save(
          {
            tenantId,
            workspaceId,
            displayName: 'Client A',
          } as Partial<AgencyClient>,
        );
        const clientB = await AgencyDataSource.getRepository(AgencyClient).save(
          {
            tenantId,
            workspaceId,
            displayName: 'Client B',
          } as Partial<AgencyClient>,
        );
        clientAId = clientA.id;
        clientBId = clientB.id;

        const settingsA = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).save({
          tenantId,
          workspaceId,
          contextType: LeadFlowSettingsContextType.Client,
          agencyClientId: clientAId,
          businessModeKey: LeadFlowBusinessMode.AgencyServices,
        });
        settingsAId = settingsA.id;

        await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).save(
          {
            tenantId,
            workspaceId,
            contextType: LeadFlowSettingsContextType.Client,
            agencyClientId: clientBId,
            businessModeKey: LeadFlowBusinessMode.LocalServices,
          },
        );
      });

      afterAll(async () => {
        await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).delete({ agencyClientId: In([clientAId, clientBId]) });
        await AgencyDataSource.getRepository(AgencyClient).delete({
          id: clientAId,
        });
        await AgencyDataSource.getRepository(AgencyClient).delete({
          id: clientBId,
        });
      });

      it('resolves the row for the requested client, not a different one', async () => {
        const profileA = await platformService.getBusinessProfile(
          ctx(),
          clientAId,
        );
        const profileB = await platformService.getBusinessProfile(
          ctx(),
          clientBId,
        );

        expect(profileA.agencyClientId).toBe(clientAId);
        expect(profileA.businessModeKey).toBe(
          LeadFlowBusinessMode.AgencyServices,
        );
        expect(profileB.agencyClientId).toBe(clientBId);
        expect(profileB.businessModeKey).toBe(
          LeadFlowBusinessMode.LocalServices,
        );
      });

      it('writing client A never touches client B', async () => {
        await platformService.updateBusinessProfile(ctx(), clientAId, {
          businessModeKey: LeadFlowBusinessMode.RetailStore,
        });

        const untouchedB = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { agencyClientId: clientBId } });

        expect(untouchedB.businessModeKey).toBe(
          LeadFlowBusinessMode.LocalServices,
        );

        const touchedA = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsAId } });
        expect(touchedA.businessModeKey).toBe(LeadFlowBusinessMode.RetailStore);
      });

      it('a different tenant cannot read this tenant client row through the Platform path', async () => {
        await expect(
          platformService.getBusinessProfile(
            ctx({ tenantId: otherTenantId, workspaceId: otherWorkspaceId }),
            clientAId,
          ),
        ).rejects.toThrow();
      });
    });

    describe('company context shared-field boundary and merge safety', () => {
      let clientId: string;
      let settingsId: string;
      const companyContextService = new CompanyContextService();

      const fullContext = companyContextService.normalize({
        identity: {
          publicName: 'Acme',
          legalName: 'Acme Ltda',
          summary: 'Old summary',
        },
        service: {
          businessHours: 'Mon-Fri 9-18',
          handoffRules: 'transfer if angry',
          serviceLevel: '24h SLA',
          emergencyRules: 'call the on-call line',
          unsupportedRequests: 'refunds after 90 days',
        },
        qualification: {
          conversionGoal: 'book_meeting',
          preferredCta: 'Schedule a call',
        },
        contact: {
          website: 'https://old.example.com',
          phone: '123',
          socialProfiles: [
            { network: 'instagram', url: 'https://instagram.com/acme' },
          ],
          address: {
            city: 'São Paulo',
            stateRegion: 'SP',
            country: 'BR',
          },
        },
        offers: ['Consulting'],
        policies: 'no refunds',
      });

      beforeAll(async () => {
        const client = await AgencyDataSource.getRepository(AgencyClient).save({
          tenantId,
          workspaceId,
          displayName: 'Client Context Boundary',
        } as Partial<AgencyClient>);
        clientId = client.id;

        const settings = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).save({
          tenantId,
          workspaceId,
          contextType: LeadFlowSettingsContextType.Client,
          agencyClientId: clientId,
          businessModeKey: LeadFlowBusinessMode.AgencyServices,
          companyContextDraft: fullContext,
        });
        settingsId = settings.id;
      });

      afterAll(async () => {
        await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).delete({ id: settingsId });
        await AgencyDataSource.getRepository(AgencyClient).delete({
          id: clientId,
        });
      });

      it('GET does not return qualification.*', async () => {
        const profile = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );

        expect(profile.companyContextDraft.qualification).toBeUndefined();
      });

      it('GET does not return LeadFlow-only fields inside service', async () => {
        const profile = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );
        const service = profile.companyContextDraft.service as Record<
          string,
          unknown
        >;

        expect(service.handoffRules).toBeUndefined();
        expect(service.serviceLevel).toBeUndefined();
        expect(service.emergencyRules).toBeUndefined();
        expect(service.unsupportedRequests).toBeUndefined();
        expect(service.businessHours).toBe('Mon-Fri 9-18');
      });

      it('GET returns contact through the Platform projection', async () => {
        const profile = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );

        expect(profile.companyContextDraft.contact).toEqual({
          website: 'https://old.example.com',
          phone: '123',
          socialProfiles: [
            { network: 'instagram', url: 'https://instagram.com/acme' },
          ],
          address: {
            city: 'São Paulo',
            stateRegion: 'SP',
            country: 'BR',
          },
        });
        expect(profile.companyContextDraft.qualification).toBeUndefined();
      });

      it('PATCH cannot modify qualification via the Platform path', async () => {
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            // Attempting to smuggle a qualification change through the
            // Platform DTO — mergeSharedCompanyContext must discard it.
            qualification: { conversionGoal: 'buy_now' },
          } as never,
        });

        const persisted = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });

        expect(persisted.companyContextDraft.qualification).toEqual({
          conversionGoal: 'book_meeting',
          preferredCta: 'Schedule a call',
        });
      });

      it('PATCH cannot modify handoffRules/serviceLevel/emergencyRules/unsupportedRequests', async () => {
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            service: {
              businessHours: 'Mon-Fri 9-18',
              handoffRules: 'never transfer',
              serviceLevel: '1h SLA',
              emergencyRules: 'ignore',
              unsupportedRequests: 'nothing',
            },
          },
        });

        const persisted = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });
        const service = persisted.companyContextDraft.service as Record<
          string,
          unknown
        >;

        expect(service.handoffRules).toBe('transfer if angry');
        expect(service.serviceLevel).toBe('24h SLA');
        expect(service.emergencyRules).toBe('call the on-call line');
        expect(service.unsupportedRequests).toBe('refunds after 90 days');
      });

      it('a PATCH of a shared field preserves qualification untouched', async () => {
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            identity: { publicName: 'Acme', summary: 'New summary' },
          },
        });

        const persisted = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });

        expect(persisted.companyContextDraft.qualification).toEqual({
          conversionGoal: 'book_meeting',
          preferredCta: 'Schedule a call',
        });
        expect(
          (persisted.companyContextDraft.identity as Record<string, unknown>)
            .summary,
        ).toBe('New summary');
      });

      it('a PATCH of service.businessHours preserves the other LeadFlow-only service fields', async () => {
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            service: { businessHours: 'Mon-Sat 8-20' },
          },
        });

        const persisted = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });
        const service = persisted.companyContextDraft.service as Record<
          string,
          unknown
        >;

        expect(service.businessHours).toBe('Mon-Sat 8-20');
        expect(service.handoffRules).toBe('transfer if angry');
        expect(service.serviceLevel).toBe('24h SLA');
        expect(service.emergencyRules).toBe('call the on-call line');
        expect(service.unsupportedRequests).toBe('refunds after 90 days');
      });

      it('a partial PATCH of contact preserves its siblings and all LeadFlow-only fields', async () => {
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            contact: {
              website: 'https://new.example.com',
              address: { city: 'Campinas' },
            },
          },
        });

        const persisted = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });

        expect(persisted.companyContextDraft.contact).toEqual({
          website: 'https://new.example.com',
          phone: '123',
          socialProfiles: [
            { network: 'instagram', url: 'https://instagram.com/acme' },
          ],
          address: {
            city: 'Campinas',
            stateRegion: 'SP',
            country: 'BR',
          },
        });
        expect(persisted.companyContextDraft.qualification).toEqual({
          conversionGoal: 'book_meeting',
          preferredCta: 'Schedule a call',
        });
        expect(persisted.companyContextDraft.service).toEqual({
          businessHours: 'Mon-Sat 8-20',
          handoffRules: 'transfer if angry',
          serviceLevel: '24h SLA',
          emergencyRules: 'call the on-call line',
          unsupportedRequests: 'refunds after 90 days',
        });
      });

      it('the LeadFlow endpoint still sees every field intact after Platform-made changes', async () => {
        const leadflowView = await settingsService.getSettings(ctx(), clientId);

        expect(leadflowView.companyContextDraft).toEqual({
          schemaVersion: 1,
          identity: {
            publicName: 'Acme',
            legalName: 'Acme Ltda',
            summary: 'New summary',
          },
          service: {
            businessHours: 'Mon-Sat 8-20',
            handoffRules: 'transfer if angry',
            serviceLevel: '24h SLA',
            emergencyRules: 'call the on-call line',
            unsupportedRequests: 'refunds after 90 days',
          },
          qualification: {
            conversionGoal: 'book_meeting',
            preferredCta: 'Schedule a call',
          },
          contact: {
            website: 'https://new.example.com',
            phone: '123',
            socialProfiles: [
              { network: 'instagram', url: 'https://instagram.com/acme' },
            ],
            address: {
              city: 'Campinas',
              stateRegion: 'SP',
              country: 'BR',
            },
          },
          offers: ['Consulting'],
          policies: 'no refunds',
        });
      });
    });
  },
);
