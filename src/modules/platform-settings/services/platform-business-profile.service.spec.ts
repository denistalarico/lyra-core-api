import type { RequestContext } from '../../../common/context/request-context.interface';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowSettingsStatus } from '../../leadflow-settings/enums/leadflow-settings-status.enum';
import type { LeadFlowClientSettingsService } from '../../leadflow-settings/services/leadflow-client-settings.service';
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
    };

    const service = new PlatformBusinessProfileService(
      leadFlowService as unknown as LeadFlowClientSettingsService,
    );

    return { service, leadFlowService };
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
});
