import type { LeadFlowClientSettingsResponse } from '../../leadflow-settings/dto/leadflow-client-settings-response.dto';
import { LeadFlowSettingsContextType } from '../../leadflow-settings/enums/leadflow-settings-context-type.enum';
import { LeadFlowSettingsStatus } from '../../leadflow-settings/enums/leadflow-settings-status.enum';
import { mapBusinessProfileResponse } from './business-profile.view';

/**
 * LeadFlow-only fields the Platform view must never expose (see
 * social-settings-architecture.md §5 and §S1.4.0 in the implementation
 * plan). Listed explicitly so this test fails loudly if the boundary is
 * ever widened without a deliberate decision.
 */
const LEADFLOW_ONLY_FIELDS = [
  'agentConfig',
  'clientPromptConfig',
  'inboxConfig',
  'inboxOverrides',
  'handoffOverrides',
  'leadsConfig',
  'pipelineRef',
  'businessModeOverrides',
  'developerOverrides',
  'permissionsConfig',
  'enabledApps',
  'enabledIntegrations',
  'brandingConfig',
  'status',
  'developerModeEnabled',
  'planKey',
  'managedTenantId',
  'metadata',
];

function buildFullLeadFlowResponse(): LeadFlowClientSettingsResponse {
  return {
    id: 'settings-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    contextType: LeadFlowSettingsContextType.Client,
    agencyClientId: 'client-1',
    managedTenantId: 'managed-tenant-1',
    businessModeKey: 'agency_services',
    businessModeTemplateId: 'template-1',
    planKey: 'pro',
    status: LeadFlowSettingsStatus.Active,
    developerModeEnabled: true,
    enabledApps: { whatsapp: { enabled: true, limit: 1, instances: [] } },
    enabledIntegrations: {
      meta_ads: { enabled: true, provider: 'meta', limit: 1, connections: [] },
    },
    permissionsConfig: { users: [{ userId: 'u1', role: 'administrator' }] },
    brandingConfig: { primaryColor: '#000000' },
    agentConfig: {
      conversionGoal: 'book_meeting',
      secretPrompt: 'do not leak',
    },
    clientPromptConfig: { conversionGoal: 'book_meeting' },
    companyContextSchemaVersion: 1,
    companyContextDraft: {
      identity: {
        publicName: 'Acme',
        legalName: 'Acme Ltda',
        summary: 'We do things',
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
        website: 'https://example.com',
        phone: '123',
        socialProfiles: [
          { network: 'instagram', url: 'https://instagram.com/acme' },
        ],
        address: { city: 'São Paulo', country: 'BR' },
      },
      offers: ['Consulting'],
      policies: 'no refunds',
      faq: ['Q1?'],
      links: ['https://example.com'],
      legacyTone: 'friendly',
    },
    companyContextPublished: {
      identity: { publicName: 'Acme', legalName: 'Acme Ltda' },
      service: {
        businessHours: 'Mon-Fri 9-18',
        handoffRules: 'transfer if angry',
      },
      qualification: { conversionGoal: 'book_meeting' },
      contact: {
        website: 'https://published.example.com',
        address: { country: 'BR' },
      },
    },
    companyContextPublishedVersion: 2,
    companyContextPublishedHash: 'abc123',
    companyContextPublishedAt: new Date('2026-01-01T00:00:00Z'),
    companyContextPublishedBy: 'user-1',
    inboxConfig: { channel: 'whatsapp' },
    inboxOverrides: { greeting: 'hi' },
    handoffOverrides: { slaMinutes: 5 },
    leadsConfig: { autoAssign: true },
    pipelineRef: { pipelineId: 'pipeline-1' },
    businessModeOverrides: { qualificationFields: [] },
    metadata: { internalNote: 'do not leak' },
    createdById: 'user-1',
    updatedById: 'user-1',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    updatedAt: new Date('2026-01-02T00:00:00Z'),
  };
}

describe('mapBusinessProfileResponse boundary', () => {
  it('never exposes LeadFlow-only fields', () => {
    const view = mapBusinessProfileResponse(
      buildFullLeadFlowResponse(),
      'draft-hash-1',
    );
    const viewKeys = Object.keys(view);

    for (const forbiddenField of LEADFLOW_ONLY_FIELDS) {
      expect(viewKeys).not.toContain(forbiddenField);
    }
  });

  it('exposes exactly the documented shared fields', () => {
    const view = mapBusinessProfileResponse(
      buildFullLeadFlowResponse(),
      'draft-hash-1',
    );

    expect(Object.keys(view).sort()).toEqual(
      [
        'businessModeKey',
        'contextType',
        'agencyClientId',
        'companyContextDraft',
        'companyContextPublished',
        'companyContextSchemaVersion',
        'companyContextDraftHash',
        'companyContextPublishedVersion',
        'companyContextPublishedHash',
        'companyContextPublishedAt',
      ].sort(),
    );
  });

  it('exposes the caller-supplied draft hash verbatim, never a recomputed or published hash', () => {
    const view = mapBusinessProfileResponse(
      buildFullLeadFlowResponse(),
      'draft-hash-1',
    );

    expect(view.companyContextDraftHash).toBe('draft-hash-1');
    expect(view.companyContextDraftHash).not.toBe(
      view.companyContextPublishedHash,
    );
  });

  it('is not built by spreading the source object', () => {
    const source = buildFullLeadFlowResponse();
    const view = mapBusinessProfileResponse(source, 'draft-hash-1');

    expect(view).not.toBe(source as unknown);
    expect(
      (view as unknown as Record<string, unknown>).agentConfig,
    ).toBeUndefined();
  });

  it('never exposes qualification.* inside companyContextDraft or companyContextPublished', () => {
    const view = mapBusinessProfileResponse(
      buildFullLeadFlowResponse(),
      'draft-hash-1',
    );

    expect(view.companyContextDraft.qualification).toBeUndefined();
    expect(view.companyContextPublished.qualification).toBeUndefined();
  });

  it('never exposes LeadFlow-only service subfields inside company context', () => {
    const view = mapBusinessProfileResponse(
      buildFullLeadFlowResponse(),
      'draft-hash-1',
    );
    const draftService = view.companyContextDraft.service as Record<
      string,
      unknown
    >;
    const publishedService = view.companyContextPublished.service as Record<
      string,
      unknown
    >;

    for (const forbiddenField of [
      'handoffRules',
      'serviceLevel',
      'emergencyRules',
      'unsupportedRequests',
    ]) {
      expect(draftService[forbiddenField]).toBeUndefined();
      expect(publishedService[forbiddenField]).toBeUndefined();
    }

    // The one shared `service` field is preserved.
    expect(draftService.businessHours).toBe('Mon-Fri 9-18');
    expect(publishedService.businessHours).toBe('Mon-Fri 9-18');
  });

  it('never exposes identity.legalName (LeadFlow-only within a shared root)', () => {
    const view = mapBusinessProfileResponse(
      buildFullLeadFlowResponse(),
      'draft-hash-1',
    );
    const draftIdentity = view.companyContextDraft.identity as Record<
      string,
      unknown
    >;

    expect(draftIdentity.legalName).toBeUndefined();
    expect(draftIdentity.publicName).toBe('Acme');
  });

  it('still exposes the shared roots untouched', () => {
    const view = mapBusinessProfileResponse(
      buildFullLeadFlowResponse(),
      'draft-hash-1',
    );

    expect(view.companyContextDraft.offers).toEqual(['Consulting']);
    expect(view.companyContextDraft.policies).toBe('no refunds');
    expect(view.companyContextDraft.faq).toEqual(['Q1?']);
    expect(view.companyContextDraft.links).toEqual(['https://example.com']);
  });

  it('exposes contact in draft and published GET projections', () => {
    const view = mapBusinessProfileResponse(
      buildFullLeadFlowResponse(),
      'draft-hash-1',
    );

    expect(view.companyContextDraft.contact).toEqual({
      website: 'https://example.com',
      phone: '123',
      socialProfiles: [
        { network: 'instagram', url: 'https://instagram.com/acme' },
      ],
      address: { city: 'São Paulo', country: 'BR' },
    });
    expect(view.companyContextPublished.contact).toEqual({
      website: 'https://published.example.com',
      address: { country: 'BR' },
    });
  });
});
