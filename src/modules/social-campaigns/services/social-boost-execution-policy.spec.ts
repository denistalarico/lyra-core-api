import type { SocialBoostTemplateEntity } from '../entities';
import { boostExecutionBlockCode } from './social-boost-execution-policy';

const template = {
  provider: 'meta',
  objective: 'engagement',
  performanceGoal: 'post_engagement',
  conversionLocation: 'on_ad',
  audienceMode: 'custom',
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
} as unknown as SocialBoostTemplateEntity;

describe('C7 Boost execution policy', () => {
  it('allows a resolved existing Facebook post', () => {
    expect(
      boostExecutionBlockCode(template, {
        provider: 'facebook',
        externalPublicationId: '123_456',
        externalAssetId: '123',
        assetType: 'facebook_page',
        assetMetadata: {},
      }),
    ).toBeNull();
  });

  it('blocks goals that need provider assets not integrated yet', () => {
    expect(
      boostExecutionBlockCode(
        {
          ...template,
          objective: 'leads',
          performanceGoal: 'instant_form_leads',
          conversionLocation: 'instant_forms',
        },
        {
          provider: 'facebook',
          externalPublicationId: '123_456',
          externalAssetId: '123',
          assetType: 'facebook_page',
          assetMetadata: {},
        },
      ),
    ).toBe('asset_required');
  });

  it('requires the Facebook Page paired with an Instagram post', () => {
    expect(
      boostExecutionBlockCode(template, {
        provider: 'instagram',
        externalPublicationId: '456',
        externalAssetId: '789',
        assetType: 'instagram_account',
        assetMetadata: {},
      }),
    ).toBe('instagram_page_not_resolved');
  });

  it('allows canonical targeting identifiers and rejects arbitrary text', () => {
    const publication = {
      provider: 'facebook', externalPublicationId: '123_456', externalAssetId: '123', assetType: 'facebook_page', assetMetadata: {},
    };
    expect(boostExecutionBlockCode({
      ...template,
      audience: { ...template.audience, cities: ['123456'], interests: ['6003139266461'], languages: ['6'] },
    }, publication)).toBeNull();
    expect(boostExecutionBlockCode({
      ...template,
      audience: { ...template.audience, cities: ['São Paulo'] },
    }, publication)).toBe('targeting_not_resolved');
  });
});
