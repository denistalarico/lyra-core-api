import { Injectable } from '@nestjs/common';
import { SocialAdCredentialResolver } from '../../social-integrations';
import { MetaAdsGraphService } from '../../social-integrations/services/meta-ads-graph.service';
import type { SocialBoostTemplateEntity } from '../entities';
import {
  facebookPageId,
  metaCampaignObjective,
  metaOptimizationGoal,
  type BoostPublicationSnapshot,
} from './social-boost-execution-policy';
import type { SocialCampaignsScope } from './social-boost-template.service';

type Input = SocialCampaignsScope & {
  connectionId: string;
  requestId: string;
  template: SocialBoostTemplateEntity;
  publication: BoostPublicationSnapshot;
};

type Level = 'campaign' | 'adset' | 'creative' | 'ad';

/** The only C7 port allowed to create Meta; every delivery-capable level is paused. */
@Injectable()
export class MetaAdsBoostAdapter {
  constructor(
    private readonly credentials: SocialAdCredentialResolver,
    private readonly graph: MetaAdsGraphService,
  ) {}

  async execute(input: Input) {
    const credential = await this.credentials.resolve({
      tenantId: input.tenantId,
      workspaceId: input.workspaceId,
      agencyClientId: input.agencyClientId,
      connectionId: input.connectionId,
    });
    const created: Partial<Record<Level, string>> = {};
    const account = credential.externalAccountId;
    const suffix = input.requestId.slice(0, 8);
    try {
      created.campaign = await this.create(
        account,
        credential.accessToken,
        'campaigns',
        {
          name: `Lyra Boost ${suffix}`,
          objective: metaCampaignObjective(input.template),
          status: 'PAUSED',
          special_ad_categories: JSON.stringify(
            input.template.specialAdCategories,
          ),
        },
      );
      const startsAt = new Date(Date.now() + 5 * 60_000);
      const endsAt = new Date(
        startsAt.getTime() + input.template.durationDays * 86_400_000,
      );
      const budgetField =
        input.template.budgetType === 'daily'
          ? 'daily_budget'
          : 'lifetime_budget';
      const pageId = this.pageId(input.publication);
      created.adset = await this.create(
        account,
        credential.accessToken,
        'adsets',
        {
          name: `Lyra Boost conjunto ${suffix}`,
          campaign_id: created.campaign,
          billing_event: 'IMPRESSIONS',
          optimization_goal: metaOptimizationGoal(input.template),
          [budgetField]: input.template.budgetAmountMinor,
          start_time: startsAt.toISOString(),
          end_time: endsAt.toISOString(),
          targeting: JSON.stringify(this.targeting(input.template)),
          ...(input.template.objective === 'engagement' && pageId
            ? { promoted_object: JSON.stringify({ page_id: pageId }) }
            : {}),
          status: 'PAUSED',
        },
      );
      created.creative = await this.create(
        account,
        credential.accessToken,
        'adcreatives',
        this.creative(input, suffix),
      );
      created.ad = await this.create(account, credential.accessToken, 'ads', {
        name: `Lyra Boost anúncio ${suffix}`,
        adset_id: created.adset,
        creative: JSON.stringify({ creative_id: created.creative }),
        status: 'PAUSED',
      });
      return { providerAccepted: true, stage: 'ad' as const, created };
    } catch {
      const stage: Level = created.creative
        ? 'ad'
        : created.adset
          ? 'creative'
          : created.campaign
            ? 'adset'
            : 'campaign';
      return { providerAccepted: false, stage, created };
    }
  }

  private async create(
    account: string,
    accessToken: string,
    edge: 'campaigns' | 'adsets' | 'adcreatives' | 'ads',
    params: Record<string, string>,
  ) {
    const result = await this.graph.createOnEdge({
      accessToken,
      path: `${account}/${edge}`,
      params,
      failureMessage: `Meta Ads ${edge} creation failed.`,
    });
    const id = result.id;
    if (typeof id !== 'string' || !/^\d+$/.test(id))
      throw new Error('invalid_provider_id');
    return id;
  }

  private targeting(template: SocialBoostTemplateEntity) {
    const targeting: Record<string, unknown> = {
      geo_locations: { countries: template.audience.countries },
    };
    const geoLocations = targeting.geo_locations as Record<string, unknown>;
    if (template.audience.regions.length)
      geoLocations.regions = template.audience.regions.map((key) => ({ key }));
    if (template.audience.cities.length)
      geoLocations.cities = template.audience.cities.map((key) => ({ key }));
    if (template.audience.postalCodes.length)
      geoLocations.zips = template.audience.postalCodes.map((key) => ({ key }));
    if (template.audience.ageMin !== null)
      targeting.age_min = template.audience.ageMin;
    if (template.audience.ageMax !== null)
      targeting.age_max = template.audience.ageMax;
    if (template.audience.genders.length)
      targeting.genders = template.audience.genders
        .map((value) => (value === 'male' ? 1 : value === 'female' ? 2 : 0))
        .filter(Boolean);
    if (template.audience.languages.length)
      targeting.locales = template.audience.languages;
    if (template.audience.interests.length) {
      targeting.flexible_spec = [
        { interests: template.audience.interests.map((id) => ({ id })) },
      ];
    }
    const placement = template.placements[0];
    if (placement === 'instagram')
      targeting.publisher_platforms = ['instagram'];
    if (placement === 'facebook') targeting.publisher_platforms = ['facebook'];
    if (placement === 'feeds') {
      targeting.publisher_platforms = ['facebook', 'instagram'];
      targeting.facebook_positions = ['feed'];
      targeting.instagram_positions = ['stream'];
    }
    if (placement === 'stories_reels') {
      targeting.publisher_platforms = ['facebook', 'instagram'];
      targeting.facebook_positions = ['story', 'facebook_reels'];
      targeting.instagram_positions = ['story', 'reels'];
    }
    if (template.audienceMode === 'automatic') {
      targeting.targeting_automation = { advantage_audience: 1 };
    }
    return targeting;
  }

  private creative(input: Input, suffix: string): Record<string, string> {
    const base = { name: `Lyra Boost criativo ${suffix}` };
    if (
      input.publication.provider.toLowerCase().includes('instagram') ||
      input.publication.assetType.toLowerCase().includes('instagram')
    ) {
      return {
        ...base,
        object_id: facebookPageId(input.publication.assetMetadata)!,
        instagram_user_id: input.publication.externalAssetId,
        source_instagram_media_id: input.publication.externalPublicationId,
      };
    }
    const postId = input.publication.externalPublicationId.includes('_')
      ? input.publication.externalPublicationId
      : `${input.publication.externalAssetId}_${input.publication.externalPublicationId}`;
    return { ...base, object_story_id: postId };
  }

  private pageId(publication: BoostPublicationSnapshot) {
    return publication.provider.toLowerCase().includes('instagram') ||
      publication.assetType.toLowerCase().includes('instagram')
      ? facebookPageId(publication.assetMetadata)
      : publication.externalAssetId;
  }
}
