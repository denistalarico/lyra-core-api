import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowSettingsStatus } from '../../leadflow-settings/enums/leadflow-settings-status.enum';
import type { LeadFlowClientSettingsService } from '../../leadflow-settings/services/leadflow-client-settings.service';
import { CompanyContextService } from '../../leadflow-settings/services/company-context.service';
import type { LeadFlowClientSettingsResponse } from '../../leadflow-settings/dto/leadflow-client-settings-response.dto';
import { PlatformBusinessProfileService } from './platform-business-profile.service';

function buildResponse(
  overrides: Partial<LeadFlowClientSettingsResponse> = {},
): LeadFlowClientSettingsResponse {
  return {
    id: 'settings-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    contextType: LeadFlowSettingsContextType.Agency,
    agencyClientId: null,
    managedTenantId: null,
    businessModeKey: 'agency_services',
    businessModeTemplateId: 'template-1',
    planKey: null,
    status: LeadFlowSettingsStatus.Active,
    developerModeEnabled: false,
    enabledApps: {},
    enabledIntegrations: {},
    permissionsConfig: {},
    brandingConfig: {},
    agentConfig: {},
    clientPromptConfig: {},
    companyContextSchemaVersion: 1,
    companyContextDraft: {},
    companyContextPublished: {},
    companyContextPublishedVersion: 0,
    companyContextPublishedHash: null,
    companyContextPublishedAt: null,
    companyContextPublishedBy: null,
    inboxConfig: {},
    inboxOverrides: {},
    handoffOverrides: {},
    leadsConfig: {},
    pipelineRef: {},
    businessModeOverrides: {},
    metadata: {},
    createdById: null,
    updatedById: null,
    createdAt: new Date(),
    updatedAt: new Date(),
    ...overrides,
  };
}

describe('PlatformBusinessProfileService', () => {
  const ctx: RequestContext = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    userId: 'user-1',
  };

  function setup() {
    const leadFlowService = {
      getSettings: jest.fn<
        ReturnType<LeadFlowClientSettingsService['getSettings']>,
        Parameters<LeadFlowClientSettingsService['getSettings']>
      >(),
      getAgencySettings: jest.fn<
        ReturnType<LeadFlowClientSettingsService['getAgencySettings']>,
        Parameters<LeadFlowClientSettingsService['getAgencySettings']>
      >(),
      updateSettings: jest.fn<
        ReturnType<LeadFlowClientSettingsService['updateSettings']>,
        Parameters<LeadFlowClientSettingsService['updateSettings']>
      >(),
      updateAgencySettings: jest.fn<
        ReturnType<LeadFlowClientSettingsService['updateAgencySettings']>,
        Parameters<LeadFlowClientSettingsService['updateAgencySettings']>
      >(),
      publishCompanyContext: jest.fn<
        ReturnType<LeadFlowClientSettingsService['publishCompanyContext']>,
        Parameters<LeadFlowClientSettingsService['publishCompanyContext']>
      >(),
      getBusinessModeContextDefaults: jest.fn<
        ReturnType<
          LeadFlowClientSettingsService['getBusinessModeContextDefaults']
        >,
        Parameters<
          LeadFlowClientSettingsService['getBusinessModeContextDefaults']
        >
      >(),
    };

    // Real, not mocked: `CompanyContextService` is a pure, dependency-free
    // hashing/normalization utility (S1.4.3b), and the whole point of these
    // tests is to prove `PlatformBusinessProfileService` hashes/compares with
    // the real semantics `publishCompanyContext` uses — a mock would let a
    // wrong hash pairing pass silently.
    const companyContextService = new CompanyContextService();

    const service = new PlatformBusinessProfileService(
      leadFlowService as unknown as LeadFlowClientSettingsService,
      companyContextService,
    );

    return { service, leadFlowService, companyContextService };
  }

  it('reads the agency row when no client id is resolved', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.getAgencySettings.mockResolvedValue(
      buildResponse({ agencyClientId: null }),
    );

    const result = await service.getBusinessProfile(ctx, null);

    expect(leadFlowService.getAgencySettings).toHaveBeenCalledWith(ctx);
    expect(leadFlowService.getSettings).not.toHaveBeenCalled();
    expect(result.agencyClientId).toBeNull();
  });

  it('reads the client row when a client id is resolved', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.getSettings.mockResolvedValue(
      buildResponse({
        contextType: LeadFlowSettingsContextType.Client,
        agencyClientId: 'client-a',
      }),
    );

    const result = await service.getBusinessProfile(ctx, 'client-a');

    expect(leadFlowService.getSettings).toHaveBeenCalledWith(ctx, 'client-a');
    expect(leadFlowService.getAgencySettings).not.toHaveBeenCalled();
    expect(result.agencyClientId).toBe('client-a');
  });

  it('never reads/writes a different client than the resolved context', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.getSettings.mockResolvedValue(
      buildResponse({ agencyClientId: 'client-a' }),
    );

    await service.getBusinessProfile(ctx, 'client-a');

    expect(leadFlowService.getSettings).toHaveBeenCalledWith(ctx, 'client-a');
    expect(leadFlowService.getSettings).not.toHaveBeenCalledWith(
      ctx,
      'client-b',
    );
  });

  it('writes the agency row via updateAgencySettings, not a parallel path', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.updateAgencySettings.mockResolvedValue(buildResponse());

    await service.updateBusinessProfile(ctx, null, {
      businessModeKey: 'agency_services',
    });

    expect(leadFlowService.updateAgencySettings).toHaveBeenCalledWith(ctx, {
      businessModeKey: 'agency_services',
    });
    expect(leadFlowService.updateSettings).not.toHaveBeenCalled();
  });

  it('writes the client row via updateSettings, not a parallel path', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.updateSettings.mockResolvedValue(
      buildResponse({ agencyClientId: 'client-a' }),
    );

    await service.updateBusinessProfile(ctx, 'client-a', {
      businessModeKey: 'agency_services',
    });

    expect(leadFlowService.updateSettings).toHaveBeenCalledWith(
      ctx,
      'client-a',
      { businessModeKey: 'agency_services' },
    );
    expect(leadFlowService.updateAgencySettings).not.toHaveBeenCalled();
  });

  it('sanitizes the response returned by the LeadFlow service', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.getAgencySettings.mockResolvedValue(
      buildResponse({
        agentConfig: { secretPrompt: 'do not leak' },
      }),
    );

    const result = await service.getBusinessProfile(ctx, null);

    expect(
      (result as unknown as Record<string, unknown>).agentConfig,
    ).toBeUndefined();
  });

  it('a companyContextDraft PATCH reads the current row first, then merges before writing', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.getAgencySettings.mockResolvedValue(
      buildResponse({
        companyContextDraft: {
          identity: { publicName: 'Acme', legalName: 'Acme Ltda' },
          qualification: { conversionGoal: 'book_meeting' },
        },
      }),
    );
    leadFlowService.updateAgencySettings.mockResolvedValue(buildResponse());

    await service.updateBusinessProfile(ctx, null, {
      companyContextDraft: { identity: { publicName: 'New Name' } },
    });

    expect(leadFlowService.getAgencySettings).toHaveBeenCalledWith(ctx);
    expect(leadFlowService.updateAgencySettings).toHaveBeenCalledWith(ctx, {
      companyContextDraft: {
        identity: { publicName: 'New Name', legalName: 'Acme Ltda' },
        qualification: { conversionGoal: 'book_meeting' },
      },
    });
  });

  it('a companyContextDraft PATCH on a client reads/merges/writes the same client row, never a different one', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.getSettings.mockResolvedValue(
      buildResponse({
        agencyClientId: 'client-a',
        companyContextDraft: {
          service: { businessHours: 'Mon-Fri', handoffRules: 'transfer' },
        },
      }),
    );
    leadFlowService.updateSettings.mockResolvedValue(
      buildResponse({ agencyClientId: 'client-a' }),
    );

    await service.updateBusinessProfile(ctx, 'client-a', {
      companyContextDraft: { service: { businessHours: 'Mon-Sat' } },
    });

    expect(leadFlowService.getSettings).toHaveBeenCalledWith(ctx, 'client-a');
    expect(leadFlowService.updateSettings).toHaveBeenCalledWith(
      ctx,
      'client-a',
      {
        companyContextDraft: {
          service: { businessHours: 'Mon-Sat', handoffRules: 'transfer' },
        },
      },
    );
  });

  it('a partial contact PATCH preserves contact siblings and LeadFlow-only subtrees', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.getAgencySettings.mockResolvedValue(
      buildResponse({
        companyContextDraft: {
          contact: {
            website: 'https://old.example.com',
            phone: '123',
            socialProfiles: [{ network: 'instagram', handle: '@acme' }],
            address: { city: 'São Paulo', stateRegion: 'SP', country: 'BR' },
          },
          qualification: { conversionGoal: 'book_meeting' },
          service: { businessHours: 'Mon-Fri', handoffRules: 'transfer' },
        },
      }),
    );
    leadFlowService.updateAgencySettings.mockResolvedValue(buildResponse());

    await service.updateBusinessProfile(ctx, null, {
      companyContextDraft: {
        contact: {
          website: 'https://new.example.com',
          address: { city: 'Campinas' },
        },
      },
    });

    expect(leadFlowService.updateAgencySettings).toHaveBeenCalledWith(ctx, {
      companyContextDraft: {
        contact: {
          website: 'https://new.example.com',
          phone: '123',
          socialProfiles: [{ network: 'instagram', handle: '@acme' }],
          address: { city: 'Campinas', stateRegion: 'SP', country: 'BR' },
        },
        qualification: { conversionGoal: 'book_meeting' },
        service: { businessHours: 'Mon-Fri', handoffRules: 'transfer' },
      },
    });
  });

  it('does not read the current row when the PATCH has no companyContextDraft', async () => {
    const { service, leadFlowService } = setup();
    leadFlowService.updateAgencySettings.mockResolvedValue(buildResponse());

    await service.updateBusinessProfile(ctx, null, {
      businessModeKey: 'local_services',
    });

    expect(leadFlowService.getAgencySettings).not.toHaveBeenCalled();
  });

  describe('publishCompanyContext', () => {
    it('publishes the agency row via the same LeadFlowClientSettingsService.publishCompanyContext, not a parallel path', async () => {
      const { service, leadFlowService } = setup();
      leadFlowService.publishCompanyContext.mockResolvedValue(
        buildResponse({ companyContextPublishedVersion: 1 }),
      );

      await service.publishCompanyContext(ctx, null, 'hash-1');

      expect(leadFlowService.publishCompanyContext).toHaveBeenCalledWith(
        ctx,
        undefined,
        'hash-1',
        expect.any(Function),
      );
    });

    it('publishes the client row by passing the client id through untouched', async () => {
      const { service, leadFlowService } = setup();
      leadFlowService.publishCompanyContext.mockResolvedValue(
        buildResponse({ agencyClientId: 'client-a' }),
      );

      await service.publishCompanyContext(ctx, 'client-a', 'hash-1');

      expect(leadFlowService.publishCompanyContext).toHaveBeenCalledWith(
        ctx,
        'client-a',
        'hash-1',
        expect.any(Function),
      );
    });

    it('publishes without expectedDraftHash when the caller omits it', async () => {
      const { service, leadFlowService } = setup();
      leadFlowService.publishCompanyContext.mockResolvedValue(buildResponse());

      await service.publishCompanyContext(ctx, null, undefined);

      expect(leadFlowService.publishCompanyContext).toHaveBeenCalledWith(
        ctx,
        undefined,
        undefined,
        expect.any(Function),
      );
    });

    it('sanitizes the published response the same way GET/PATCH do', async () => {
      const { service, leadFlowService } = setup();
      leadFlowService.publishCompanyContext.mockResolvedValue(
        buildResponse({
          agentConfig: { secretPrompt: 'do not leak' },
          companyContextPublished: {
            qualification: { conversionGoal: 'book_meeting' },
            identity: { publicName: 'Acme', legalName: 'Acme Ltda' },
          },
        }),
      );

      const result = await service.publishCompanyContext(ctx, null, undefined);

      expect(
        (result as unknown as Record<string, unknown>).agentConfig,
      ).toBeUndefined();
      expect(result.companyContextPublished.qualification).toBeUndefined();
      expect(
        (result.companyContextPublished.identity as Record<string, unknown>)
          .legalName,
      ).toBeUndefined();
    });

    it('exposes companyContextDraftHash on the published response, computed from the returned draft', async () => {
      const { service, leadFlowService, companyContextService } = setup();
      const publishedDraft = { identity: { publicName: 'Acme' } };
      leadFlowService.publishCompanyContext.mockResolvedValue(
        buildResponse({ companyContextDraft: publishedDraft }),
      );

      const result = await service.publishCompanyContext(ctx, null, undefined);

      expect(result.companyContextDraftHash).toBe(
        companyContextService.hash(
          companyContextService.normalizePersisted(publishedDraft),
        ),
      );
    });

    it('propagates a conflict from a mismatched expectedDraftHash instead of swallowing it', async () => {
      const { service, leadFlowService } = setup();
      leadFlowService.publishCompanyContext.mockRejectedValue(
        new Error('draft changed since preview'),
      );

      await expect(
        service.publishCompanyContext(ctx, null, 'stale-hash'),
      ).rejects.toThrow('draft changed since preview');
    });
  });

  describe('shared-surface publish document (S1.4.3d)', () => {
    /**
     * Runs the real resolver the service handed to
     * `publishCompanyContext`, against a caller-supplied publish state — this
     * is the document that would actually be persisted.
     */
    async function resolvePublishedDocument(
      agencyClientId: string | null,
      state: {
        normalizedDraft: Record<string, unknown>;
        normalizedPublished: Record<string, unknown>;
        hasPublishedBaseline: boolean;
        businessModeKey?: string;
      },
      configure: (
        leadFlowService: ReturnType<typeof setup>['leadFlowService'],
      ) => void = () => {},
    ) {
      const { service, leadFlowService } = setup();
      leadFlowService.publishCompanyContext.mockResolvedValue(buildResponse());
      configure(leadFlowService);

      await service.publishCompanyContext(ctx, agencyClientId, undefined);

      const resolver = leadFlowService.publishCompanyContext.mock.calls[0][3]!;

      return {
        document: await resolver({
          businessModeKey: 'agency_services',
          ...state,
        } as Parameters<typeof resolver>[0]),
        leadFlowService,
      };
    }

    it('publishes shared draft edits onto the existing published document', async () => {
      const { document } = await resolvePublishedDocument(null, {
        hasPublishedBaseline: true,
        normalizedDraft: {
          identity: { publicName: 'B' },
          service: { businessHours: 'NEW' },
        },
        normalizedPublished: {
          identity: { publicName: 'A' },
          service: { businessHours: 'OLD' },
        },
      });

      expect((document.identity as Record<string, unknown>).publicName).toBe(
        'B',
      );
      expect((document.service as Record<string, unknown>).businessHours).toBe(
        'NEW',
      );
    });

    it('leaves LeadFlow-only fields exactly as last published, never promoting a pending hidden draft edit', async () => {
      const { document } = await resolvePublishedDocument(null, {
        hasPublishedBaseline: true,
        normalizedDraft: {
          identity: { publicName: 'B' },
          qualification: { conversionGoal: 'NEW' },
          service: { businessHours: 'NEW', handoffRules: 'NEW' },
        },
        normalizedPublished: {
          identity: { publicName: 'A' },
          qualification: { conversionGoal: 'OLD' },
          service: { businessHours: 'OLD', handoffRules: 'OLD' },
        },
      });

      expect(
        (document.qualification as Record<string, unknown>).conversionGoal,
      ).toBe('OLD');
      expect((document.service as Record<string, unknown>).handoffRules).toBe(
        'OLD',
      );
      // ...while the shared edits in the very same draft still went out.
      expect((document.identity as Record<string, unknown>).publicName).toBe(
        'B',
      );
      expect((document.service as Record<string, unknown>).businessHours).toBe(
        'NEW',
      );
    });

    it('seeds the domains it does not control from the current Business Mode defaults on a first publish', async () => {
      const { document, leadFlowService } = await resolvePublishedDocument(
        null,
        {
          hasPublishedBaseline: false,
          businessModeKey: 'local_services',
          normalizedDraft: {
            identity: { publicName: 'B' },
            // A LeadFlow-only edit made before the first Platform publish.
            qualification: { conversionGoal: 'HUMAN_EDIT' },
          },
          normalizedPublished: {},
        },
        (mocked) => {
          mocked.getBusinessModeContextDefaults.mockResolvedValue({
            qualification: { conversionGoal: 'CANONICAL_DEFAULT' },
          });
        },
      );

      expect(
        leadFlowService.getBusinessModeContextDefaults,
      ).toHaveBeenCalledWith(ctx, 'local_services');
      // The human's hidden edit is NOT promoted...
      expect(
        (document.qualification as Record<string, unknown>).conversionGoal,
      ).toBe('CANONICAL_DEFAULT');
      // ...but the shared edit is.
      expect((document.identity as Record<string, unknown>).publicName).toBe(
        'B',
      );
    });

    it('does not consult Business Mode defaults when a published baseline already exists', async () => {
      const { leadFlowService } = await resolvePublishedDocument(null, {
        hasPublishedBaseline: true,
        normalizedDraft: { identity: { publicName: 'B' } },
        normalizedPublished: { identity: { publicName: 'A' } },
      });

      expect(
        leadFlowService.getBusinessModeContextDefaults,
      ).not.toHaveBeenCalled();
    });

    it('applies the same shared-surface rule for a client context', async () => {
      const { document } = await resolvePublishedDocument('client-a', {
        hasPublishedBaseline: true,
        normalizedDraft: {
          service: { businessHours: 'NEW', handoffRules: 'NEW' },
        },
        normalizedPublished: {
          service: { businessHours: 'OLD', handoffRules: 'OLD' },
        },
      });

      expect((document.service as Record<string, unknown>).businessHours).toBe(
        'NEW',
      );
      expect((document.service as Record<string, unknown>).handoffRules).toBe(
        'OLD',
      );
    });
  });
});
