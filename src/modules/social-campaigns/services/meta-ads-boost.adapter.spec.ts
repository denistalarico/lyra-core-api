import type { SocialAdCredentialResolver } from '../../social-integrations';
import type { MetaAdsGraphService } from '../../social-integrations/services/meta-ads-graph.service';
import type { SocialBoostTemplateEntity } from '../entities';
import { MetaAdsBoostAdapter } from './meta-ads-boost.adapter';

describe('MetaAdsBoostAdapter', () => {
  it('creates paused first and activates the complete hierarchy after confirmation', async () => {
    const credentials = {
      resolve: jest.fn().mockResolvedValue({
        accessToken: 'secret',
        externalAccountId: 'act_123',
      }),
    };
    const graph = {
      createOnEdge: jest
        .fn()
        .mockResolvedValueOnce({ id: '1' })
        .mockResolvedValueOnce({ id: '2' })
        .mockResolvedValueOnce({ id: '3' })
        .mockResolvedValueOnce({ id: '4' }),
      mutateNode: jest.fn().mockResolvedValue({ success: true }),
    };
    const adapter = new MetaAdsBoostAdapter(
      credentials as unknown as SocialAdCredentialResolver,
      graph as unknown as MetaAdsGraphService,
    );
    const result = await adapter.execute({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: null,
      connectionId: 'connection',
      requestId: '12345678-1234-1234-1234-123456789012',
      template: {
        provider: 'meta',
        objective: 'engagement',
        performanceGoal: 'post_engagement',
        conversionLocation: 'on_ad',
        budgetType: 'daily',
        budgetAmountMinor: '1000',
        durationDays: 5,
        audienceMode: 'custom',
        placements: ['feeds'],
        specialAdCategories: [],
        audience: {
          countries: ['BR'],
          regions: [],
          cities: [],
          postalCodes: [],
          ageMin: 18,
          ageMax: 65,
          genders: [],
          languages: [],
          interests: [],
          savedAudienceExternalId: null,
        },
      } as unknown as SocialBoostTemplateEntity,
      publication: {
        provider: 'facebook',
        externalPublicationId: '55_66',
        externalAssetId: '55',
        assetType: 'facebook_page',
        assetMetadata: {},
      },
    });

    expect(result.providerAccepted).toBe(true);
    expect(graph.createOnEdge).toHaveBeenCalledTimes(4);
    for (const index of [0, 1, 3]) {
      expect(graph.createOnEdge.mock.calls[index][0].params.status).toBe(
        'PAUSED',
      );
    }
    expect(graph.mutateNode).toHaveBeenCalledTimes(3);
    expect(graph.mutateNode.mock.calls.map((call) => call[0].path)).toEqual([
      '4',
      '2',
      '1',
    ]);
    for (const call of graph.mutateNode.mock.calls) {
      expect(call[0].params).toEqual({ status: 'ACTIVE' });
    }
    expect(graph.createOnEdge.mock.calls[2][0].params.object_story_id).toBe(
      '55_66',
    );
  });

  it('stops without retrying and reports a partial hierarchy', async () => {
    const credentials = {
      resolve: jest.fn().mockResolvedValue({
        accessToken: 'secret',
        externalAccountId: 'act_123',
      }),
    };
    const graph = {
      createOnEdge: jest
        .fn()
        .mockResolvedValueOnce({ id: '1' })
        .mockRejectedValueOnce(new Error('safe')),
      mutateNode: jest.fn(),
    };
    const adapter = new MetaAdsBoostAdapter(
      credentials as unknown as SocialAdCredentialResolver,
      graph as unknown as MetaAdsGraphService,
    );
    const result = await adapter.execute({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: null,
      connectionId: 'connection',
      requestId: '12345678-1234-1234-1234-123456789012',
      template: {
        provider: 'meta',
        objective: 'awareness',
        performanceGoal: 'reach',
        conversionLocation: 'on_ad',
        budgetType: 'daily',
        budgetAmountMinor: '1000',
        durationDays: 3,
        audienceMode: 'custom',
        placements: ['automatic'],
        specialAdCategories: [],
        audience: {
          countries: ['BR'],
          regions: [],
          cities: [],
          postalCodes: [],
          ageMin: null,
          ageMax: null,
          genders: [],
          languages: [],
          interests: [],
          savedAudienceExternalId: null,
        },
      } as unknown as SocialBoostTemplateEntity,
      publication: {
        provider: 'facebook',
        externalPublicationId: '55_66',
        externalAssetId: '55',
        assetType: 'facebook_page',
        assetMetadata: {},
      },
    });
    expect(result).toMatchObject({ providerAccepted: false, stage: 'adset' });
    expect(graph.createOnEdge).toHaveBeenCalledTimes(2);
    expect(graph.mutateNode).not.toHaveBeenCalled();
  });

  it('keeps the hierarchy unable to deliver when activation fails', async () => {
    const credentials = {
      resolve: jest.fn().mockResolvedValue({
        accessToken: 'secret',
        externalAccountId: 'act_123',
      }),
    };
    const graph = {
      createOnEdge: jest
        .fn()
        .mockResolvedValueOnce({ id: '1' })
        .mockResolvedValueOnce({ id: '2' })
        .mockResolvedValueOnce({ id: '3' })
        .mockResolvedValueOnce({ id: '4' }),
      mutateNode: jest.fn().mockRejectedValueOnce(new Error('safe')),
    };
    const adapter = new MetaAdsBoostAdapter(
      credentials as unknown as SocialAdCredentialResolver,
      graph as unknown as MetaAdsGraphService,
    );

    const result = await adapter.execute({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      agencyClientId: null,
      connectionId: 'connection',
      requestId: '12345678-1234-1234-1234-123456789012',
      template: {
        provider: 'meta',
        objective: 'awareness',
        performanceGoal: 'reach',
        conversionLocation: 'on_ad',
        budgetType: 'daily',
        budgetAmountMinor: '1000',
        durationDays: 3,
        audienceMode: 'custom',
        placements: ['automatic'],
        specialAdCategories: [],
        audience: {
          countries: ['BR'],
          regions: [],
          cities: [],
          postalCodes: [],
          ageMin: null,
          ageMax: null,
          genders: [],
          languages: [],
          interests: [],
          savedAudienceExternalId: null,
        },
      } as unknown as SocialBoostTemplateEntity,
      publication: {
        provider: 'facebook',
        externalPublicationId: '55_66',
        externalAssetId: '55',
        assetType: 'facebook_page',
        assetMetadata: {},
      },
    });

    expect(result).toMatchObject({
      providerAccepted: false,
      stage: 'ad',
      errorCode: 'provider_create_failed',
    });
    expect(graph.mutateNode).toHaveBeenCalledWith(
      expect.objectContaining({ path: '4', params: { status: 'ACTIVE' } }),
    );
  });
});
