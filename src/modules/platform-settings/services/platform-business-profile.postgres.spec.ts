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
    // Shared across the file so both `platformService` and the equivalence
    // assertions below hash with the exact same `CompanyContextService`
    // instance `PlatformBusinessProfileService` uses internally (S1.4.3b) —
    // a second `new CompanyContextService()` would be behaviorally
    // identical (the service is stateless) but naming one instance keeps the
    // intent — "the same hashing the service performs" — visible at the call
    // site, rather than incidental.
    let companyContextService: CompanyContextService;

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
      companyContextService = new CompanyContextService();
      settingsService = new LeadFlowClientSettingsService(
        AgencyDataSource,
        AgencyDataSource.getRepository(AgencyClient),
        AgencyDataSource.getRepository(LeadFlowClientSettingsEntity),
        AgencyDataSource.getRepository(TenantProductEntitlementEntity),
        templateService,
        companyContextService,
      );
      platformService = new PlatformBusinessProfileService(
        settingsService,
        companyContextService,
      );
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
        const expectedDraftHash = companyContextService.hash(
          companyContextService.normalizePersisted(
            leadflowView.companyContextDraft ?? {},
          ),
        );

        expect(platformView).toEqual(
          mapBusinessProfileResponse(leadflowView, expectedDraftHash),
        );
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

    // S1.4.3a — neutral publish of the shared company context.
    describe('company context publish (S1.4.3a)', () => {
      let clientId: string;
      let settingsId: string;
      const companyContextService = new CompanyContextService();

      const draftWithLeadFlowOnlyFields = companyContextService.normalize({
        identity: { publicName: 'Acme', legalName: 'Acme Ltda' },
        qualification: { conversionGoal: 'book_meeting' },
        service: {
          businessHours: 'Mon-Fri 9-18',
          handoffRules: 'transfer if angry',
        },
        contact: { website: 'https://example.com' },
        offers: ['Consulting'],
      });

      beforeAll(async () => {
        const client = await AgencyDataSource.getRepository(AgencyClient).save({
          tenantId,
          workspaceId,
          displayName: 'Client Publish',
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
          companyContextDraft: draftWithLeadFlowOnlyFields,
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

      it('publishing through the Platform path produces the same published document as the LeadFlow path would', async () => {
        const published = await platformService.publishCompanyContext(
          ctx(),
          clientId,
          undefined,
        );

        const persisted = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });

        // The full document is persisted — LeadFlow-only fields included —
        // because this goes through the exact same
        // `LeadFlowClientSettingsService.publishCompanyContext`.
        expect(persisted.companyContextPublished).toEqual(
          companyContextService.normalizePersisted(draftWithLeadFlowOnlyFields),
        );
        expect(persisted.companyContextPublishedVersion).toBe(1);
        expect(persisted.companyContextPublishedHash).toBeTruthy();

        // But the Platform response stays sanitized.
        expect(published.companyContextPublished.qualification).toBeUndefined();
        expect(
          (
            published.companyContextPublished.identity as Record<
              string,
              unknown
            >
          ).legalName,
        ).toBeUndefined();
        expect(
          (published.companyContextPublished.service as Record<string, unknown>)
            .handoffRules,
        ).toBeUndefined();
      });

      it('a correct expectedDraftHash publishes', async () => {
        const preview = await settingsService.previewCompanyContext(
          ctx(),
          clientId,
        );

        const published = await platformService.publishCompanyContext(
          ctx(),
          clientId,
          preview.hash,
        );

        expect(published.companyContextPublishedVersion).toBe(2);
      });

      it('a mismatched expectedDraftHash fails exactly like the LeadFlow path would, and does not publish', async () => {
        const before = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });

        await expect(
          platformService.publishCompanyContext(
            ctx(),
            clientId,
            'not-the-real-hash',
          ),
        ).rejects.toThrow();

        const after = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });

        expect(after.companyContextPublishedVersion).toBe(
          before.companyContextPublishedVersion,
        );
        expect(after.companyContextPublishedHash).toBe(
          before.companyContextPublishedHash,
        );
      });

      it('publish does not erase qualification or any other LeadFlow-only field from the persisted document', async () => {
        const persisted = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });
        const published = persisted.companyContextPublished as Record<
          string,
          unknown
        >;

        expect(published.qualification).toEqual({
          conversionGoal: 'book_meeting',
        });
        expect(
          (published.service as Record<string, unknown>).handoffRules,
        ).toBe('transfer if angry');
        expect((published.identity as Record<string, unknown>).legalName).toBe(
          'Acme Ltda',
        );
      });

      it('after a Platform publish, the LeadFlow endpoint sees the same full companyContextPublished', async () => {
        const leadflowView = await settingsService.getSettings(ctx(), clientId);

        expect(leadflowView.companyContextPublished).toEqual(
          companyContextService.normalizePersisted(draftWithLeadFlowOnlyFields),
        );
      });

      it('publishing the agency row works the same way as publishing a client row', async () => {
        const before = await platformService.getBusinessProfile(ctx(), null);
        const published = await platformService.publishCompanyContext(
          ctx(),
          null,
          undefined,
        );

        expect(published.companyContextPublishedVersion).toBeGreaterThan(
          before.companyContextPublishedVersion,
        );
      });
    });

    describe('draft hash (S1.4.3b)', () => {
      let clientId: string;
      let settingsId: string;
      const companyContextService = new CompanyContextService();

      beforeAll(async () => {
        const client = await AgencyDataSource.getRepository(AgencyClient).save({
          tenantId,
          workspaceId,
          displayName: 'Client Draft Hash',
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
          companyContextDraft: companyContextService.normalize({
            identity: { publicName: 'Acme' },
          }),
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

      it('GET returns companyContextDraftHash equal to the hash of the full persisted draft', async () => {
        const profile = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );
        const settings = await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });
        const expectedHash = companyContextService.hash(
          companyContextService.normalizePersisted(
            settings.companyContextDraft ?? {},
          ),
        );

        expect(profile.companyContextDraftHash).toBe(expectedHash);
        // The two hashes are of different documents (draft vs. published) and
        // must never be confused — see `BusinessProfileResponse` doc comment.
        expect(profile.companyContextDraftHash).not.toBe(
          profile.companyContextPublishedHash,
        );
      });

      it('PATCH returns a new companyContextDraftHash reflecting the change', async () => {
        const before = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );

        const after = await platformService.updateBusinessProfile(
          ctx(),
          clientId,
          {
            companyContextDraft: { identity: { publicName: 'Acme Renamed' } },
          },
        );

        expect(after.companyContextDraftHash).not.toBe(
          before.companyContextDraftHash,
        );
      });

      it('companyContextDraftHash returned by GET is accepted as expectedDraftHash by publish', async () => {
        const profile = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );

        const published = await platformService.publishCompanyContext(
          ctx(),
          clientId,
          profile.companyContextDraftHash,
        );

        expect(published.companyContextPublishedVersion).toBe(1);
      });

      it('using companyContextPublishedHash as expectedDraftHash is rejected as a stale draft (the bug this phase fixes)', async () => {
        // At this point draft and published are identical (previous test just
        // published), so `companyContextPublishedHash` happens to be a real,
        // current hash — but it is the hash of the *published* document, and
        // `publishCompanyContext` checks `expectedDraftHash` against the
        // *draft*'s hash. Change the draft so the two diverge and prove the
        // old (wrong) field is no longer usable as `expectedDraftHash`.
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: { identity: { publicName: 'Acme Once More' } },
        });
        const profile = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );

        expect(profile.companyContextPublishedHash).not.toBe(
          profile.companyContextDraftHash,
        );

        await expect(
          platformService.publishCompanyContext(
            ctx(),
            clientId,
            profile.companyContextPublishedHash ?? undefined,
          ),
        ).rejects.toThrow();
      });
    });

    describe('shared-surface publish (S1.4.3d)', () => {
      let clientId: string;
      let settingsId: string;
      const companyContextService = new CompanyContextService();

      const initialDraft = companyContextService.normalize({
        identity: { publicName: 'Acme', legalName: 'Acme Ltda' },
        qualification: { conversionGoal: 'book_meeting' },
        service: { businessHours: 'Mon-Fri 9-18' },
        contact: { website: 'https://example.com' },
        offers: ['Consulting'],
      });

      beforeEach(async () => {
        const client = await AgencyDataSource.getRepository(AgencyClient).save({
          tenantId,
          workspaceId,
          displayName: 'Client Shared Surface Publish',
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
          companyContextDraft: initialDraft,
        });
        settingsId = settings.id;
      });

      afterEach(async () => {
        await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).delete({ id: settingsId });
        await AgencyDataSource.getRepository(AgencyClient).delete({
          id: clientId,
        });
      });

      async function readPersisted() {
        return AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).findOneOrFail({ where: { id: settingsId } });
      }

      // ── A. Existing published ──────────────────────────────────────────

      it('publishes a shared-only draft change through the Platform path', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            contact: { website: 'https://updated.example.com' },
          },
        });

        const profile = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );
        const published = await platformService.publishCompanyContext(
          ctx(),
          clientId,
          profile.companyContextDraftHash,
        );

        expect(
          (published.companyContextPublished.contact as Record<string, unknown>)
            .website,
        ).toBe('https://updated.example.com');
      });

      it('a LeadFlow-only pending change (qualification) is NOT promoted by the Platform publish', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        // The LeadFlow product edits `qualification` and saves a draft without
        // publishing — the scenario the review flagged. The Platform endpoint
        // must never ship it, but must not be blocked by it either.
        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            qualification: { conversionGoal: 'request_demo' },
          },
        });

        await expect(
          platformService.publishCompanyContext(ctx(), clientId, undefined),
        ).resolves.toBeDefined();

        const persisted = await readPersisted();
        expect(
          (persisted.companyContextPublished as Record<string, unknown>)
            .qualification,
        ).toEqual({ conversionGoal: 'book_meeting' });
      });

      it('a LeadFlow-only pending change (service.handoffRules) is NOT promoted by the Platform publish', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            service: {
              businessHours: 'Mon-Fri 9-18',
              handoffRules: 'transfer immediately if the caller is angry',
            },
          },
        });

        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        const persisted = await readPersisted();
        expect(
          (persisted.companyContextPublished.service as Record<string, unknown>)
            .handoffRules,
        ).toBeUndefined();
      });

      it('a shared change alongside a pending LeadFlow-only change publishes the shared half only', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        // LeadFlow changes `qualification` and saves — never publishes.
        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            qualification: { conversionGoal: 'request_demo' },
          },
        });
        // Social then changes a shared field and saves.
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            contact: { website: 'https://updated.example.com' },
          },
        });

        const profile = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );
        await platformService.publishCompanyContext(
          ctx(),
          clientId,
          profile.companyContextDraftHash,
        );

        const persisted = await readPersisted();
        // The shared edit went out...
        expect(
          (persisted.companyContextPublished.contact as Record<string, unknown>)
            .website,
        ).toBe('https://updated.example.com');
        // ...and the hidden one nobody on the Social side saw did not.
        expect(
          (persisted.companyContextPublished as Record<string, unknown>)
            .qualification,
        ).toEqual({ conversionGoal: 'book_meeting' });
      });

      it('leaves the full draft intact after a Platform publish — the hidden pending change is still there', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            qualification: { conversionGoal: 'request_demo' },
          },
        });
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        const persisted = await readPersisted();
        // Draft is NOT truncated to what was published — LeadFlow must still
        // see its own pending change and be able to publish it later.
        expect(
          (persisted.companyContextDraft as Record<string, unknown>)
            .qualification,
        ).toEqual({ conversionGoal: 'request_demo' });
        expect(
          (persisted.companyContextDraft.identity as Record<string, unknown>)
            .legalName,
        ).toBe('Acme Ltda');
      });

      // ── B. First publish ───────────────────────────────────────────────

      it('first publish with untouched template defaults succeeds', async () => {
        const before = await readPersisted();
        expect(before.companyContextPublishedAt).toBeNull();

        const published = await platformService.publishCompanyContext(
          ctx(),
          clientId,
          undefined,
        );

        expect(published.companyContextPublishedVersion).toBe(1);
      });

      it('first publish after a shared-only edit succeeds and publishes that edit', async () => {
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            contact: { website: 'https://first.example.com' },
          },
        });

        const published = await platformService.publishCompanyContext(
          ctx(),
          clientId,
          undefined,
        );

        expect(
          (published.companyContextPublished.contact as Record<string, unknown>)
            .website,
        ).toBe('https://first.example.com');
      });

      it('first publish does NOT promote a LeadFlow-only edit made before it; the published document takes the canonical Business Mode default', async () => {
        // A human edits a hidden field before any publish ever happened —
        // exactly the gap S1.4.3c identified, where no baseline exists to
        // tell this apart from a legitimate seeded default.
        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            qualification: { conversionGoal: 'HUMAN_EDIT_BEFORE_PUBLISH' },
          },
        });

        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        const persisted = await readPersisted();
        const publishedQualification = (
          persisted.companyContextPublished as Record<string, unknown>
        ).qualification as Record<string, unknown>;

        // The human's hidden edit was not promoted...
        expect(publishedQualification?.conversionGoal).not.toBe(
          'HUMAN_EDIT_BEFORE_PUBLISH',
        );
        // ...and it is still in the draft for LeadFlow to publish later.
        expect(
          (
            (persisted.companyContextDraft as Record<string, unknown>)
              .qualification as Record<string, unknown>
          ).conversionGoal,
        ).toBe('HUMAN_EDIT_BEFORE_PUBLISH');
      });

      it('first publish takes the canonical Business Mode default for hidden fields while publishing the shared edit', async () => {
        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            qualification: { conversionGoal: 'HUMAN_EDIT_BEFORE_PUBLISH' },
          },
        });
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            contact: { website: 'https://shared-edit.example.com' },
          },
        });

        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        const persisted = await readPersisted();
        expect(
          (persisted.companyContextPublished.contact as Record<string, unknown>)
            .website,
        ).toBe('https://shared-edit.example.com');
        expect(
          (
            (persisted.companyContextPublished as Record<string, unknown>)
              .qualification as Record<string, unknown>
          )?.conversionGoal,
        ).not.toBe('HUMAN_EDIT_BEFORE_PUBLISH');
      });

      it('the canonical Business Mode defaults actually populate the hidden surface on a first publish', async () => {
        const defaults = await settingsService.getBusinessModeContextDefaults(
          ctx(),
          LeadFlowBusinessMode.AgencyServices,
        );

        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        const persisted = await readPersisted();
        // Whatever the mode ships for `qualification` is what a first Platform
        // publish writes — proving the base is the canonical default document,
        // not an empty object that would strand LeadFlow with no config.
        expect(
          (persisted.companyContextPublished as Record<string, unknown>)
            .qualification,
        ).toEqual(defaults.qualification);
      });

      // ── C. LeadFlow ────────────────────────────────────────────────────

      it('the LeadFlow endpoint still publishes the full draft, hidden fields included', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            qualification: { conversionGoal: 'request_demo' },
          },
        });

        // The shared-surface restriction is Platform-only (D-11 §9).
        const published = await settingsService.publishCompanyContext(
          ctx(),
          clientId,
          undefined,
        );

        expect(
          (published.companyContextPublished as Record<string, unknown>)
            .qualification,
        ).toEqual({ conversionGoal: 'request_demo' });
      });

      it('after a Platform publish preserved the old hidden value, a later LeadFlow publish promotes the draft one', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            qualification: { conversionGoal: 'request_demo' },
          },
        });

        // Platform publishes: hidden stays at the old published value.
        await platformService.publishCompanyContext(ctx(), clientId, undefined);
        let persisted = await readPersisted();
        expect(
          (persisted.companyContextPublished as Record<string, unknown>)
            .qualification,
        ).toEqual({ conversionGoal: 'book_meeting' });

        // LeadFlow then publishes: hidden catches up to the draft.
        await settingsService.publishCompanyContext(ctx(), clientId, undefined);
        persisted = await readPersisted();
        expect(
          (persisted.companyContextPublished as Record<string, unknown>)
            .qualification,
        ).toEqual({ conversionGoal: 'request_demo' });
      });

      // ── D. Concurrency ─────────────────────────────────────────────────

      it('a stale draft hash conflicts even when the concurrent change was hidden-only', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        const profile = await platformService.getBusinessProfile(
          ctx(),
          clientId,
        );

        // A concurrent LeadFlow edit touching ONLY a hidden field still moves
        // the full-draft hash — publishing a subset does not narrow what
        // counts as a concurrent change (S1.4.3d §6).
        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            qualification: { conversionGoal: 'request_demo' },
          },
        });

        await expect(
          platformService.publishCompanyContext(
            ctx(),
            clientId,
            profile.companyContextDraftHash,
          ),
        ).rejects.toThrow();
      });

      // ── E. Projection ──────────────────────────────────────────────────

      it('the Platform response after publish still exposes no hidden fields', async () => {
        const published = await platformService.publishCompanyContext(
          ctx(),
          clientId,
          undefined,
        );

        expect(published.companyContextPublished.qualification).toBeUndefined();
        expect(
          (
            published.companyContextPublished.identity as Record<
              string,
              unknown
            >
          ).legalName,
        ).toBeUndefined();
        expect(
          (published.companyContextPublished.service as Record<string, unknown>)
            ?.handoffRules,
        ).toBeUndefined();
      });

      it('publishedHash stays the hash of the FULL published document, not of the sanitized projection', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        const persisted = await readPersisted();
        expect(persisted.companyContextPublishedHash).toBe(
          companyContextService.hash(
            companyContextService.normalizePersisted(
              persisted.companyContextPublished,
            ),
          ),
        );
      });

      // ── F. Business mode ───────────────────────────────────────────────

      it('an existing published document does not have its hidden fields reset just because Business Mode defaults exist', async () => {
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        // LeadFlow deliberately publishes a custom hidden value.
        await settingsService.updateSettings(ctx(), clientId, {
          companyContextDraft: {
            ...initialDraft,
            qualification: { conversionGoal: 'CUSTOM_PUBLISHED' },
          },
        });
        await settingsService.publishCompanyContext(ctx(), clientId, undefined);

        // A later Platform publish must carry that custom value over — never
        // reset it back to the mode's canonical default.
        await platformService.updateBusinessProfile(ctx(), clientId, {
          companyContextDraft: {
            contact: { website: 'https://later.example.com' },
          },
        });
        await platformService.publishCompanyContext(ctx(), clientId, undefined);

        const persisted = await readPersisted();
        expect(
          (persisted.companyContextPublished as Record<string, unknown>)
            .qualification,
        ).toEqual({ conversionGoal: 'CUSTOM_PUBLISHED' });
      });
    });

    // S1.4.3a — D-15: publish must respect the same product/entitlement
    // fence as every other Platform Business Profile operation. This spec
    // constructs the resolved-context shape the guard would have produced;
    // it does not re-test the guard itself (covered by S1.4.0's guard specs)
    // — it proves that once a `clientId` reaches `publishCompanyContext`,
    // `LeadFlowClientSettingsService.findSettings` still enforces tenant
    // scoping identically for the Platform call shape.
    describe('publish respects tenant isolation exactly like read/update do', () => {
      it('publish for a client belonging to a different tenant is rejected', async () => {
        const foreignClient = await AgencyDataSource.getRepository(
          AgencyClient,
        ).save({
          tenantId: otherTenantId,
          workspaceId: otherWorkspaceId,
          displayName: 'Foreign Client',
        } as Partial<AgencyClient>);

        await AgencyDataSource.getRepository(LeadFlowClientSettingsEntity).save(
          {
            tenantId: otherTenantId,
            workspaceId: otherWorkspaceId,
            contextType: LeadFlowSettingsContextType.Client,
            agencyClientId: foreignClient.id,
            businessModeKey: LeadFlowBusinessMode.AgencyServices,
          },
        );

        await expect(
          platformService.publishCompanyContext(
            ctx(),
            foreignClient.id,
            undefined,
          ),
        ).rejects.toThrow();

        await AgencyDataSource.getRepository(
          LeadFlowClientSettingsEntity,
        ).delete({ agencyClientId: foreignClient.id });
        await AgencyDataSource.getRepository(AgencyClient).delete({
          id: foreignClient.id,
        });
      });
    });
  },
);
