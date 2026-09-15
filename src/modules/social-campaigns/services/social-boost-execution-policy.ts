import type { SocialBoostTemplateEntity } from '../entities';

export type BoostPublicationSnapshot = {
  provider: string;
  externalPublicationId: string;
  externalAssetId: string;
  assetType: string;
  assetMetadata: Record<string, unknown>;
};

const GOALS: Record<string, string> = {
  reach: 'REACH',
  impressions: 'IMPRESSIONS',
  post_engagement: 'POST_ENGAGEMENT',
  thruplay: 'THRUPLAY',
  two_second_video_views: 'TWO_SECOND_CONTINUOUS_VIDEO_VIEWS',
};

export function boostExecutionBlockCode(
  template: SocialBoostTemplateEntity,
  publication: BoostPublicationSnapshot,
): string | null {
  if (template.provider !== 'meta') return 'provider_not_meta';
  if (template.conversionLocation !== 'on_ad') return 'asset_required';
  if (!GOALS[template.performanceGoal]) return 'goal_not_executable';
  if (!['awareness', 'engagement'].includes(template.objective))
    return 'objective_not_executable';
  if (template.audienceMode === 'saved') return 'saved_audience_not_resolved';
  if (['followers', 'engagers'].includes(template.audienceMode))
    return 'source_audience_not_resolved';
  if (
    template.audience.regions.length ||
    template.audience.cities.length ||
    template.audience.postalCodes.length ||
    template.audience.interests.length ||
    template.audience.savedAudienceExternalId
  )
    return 'targeting_not_resolved';
  if (!template.audience.countries.length) return 'country_required';
  if (!publication.externalPublicationId) return 'publication_not_published';

  const provider = publication.provider.toLowerCase();
  const assetType = publication.assetType.toLowerCase();
  if (
    !provider.includes('facebook') &&
    !provider.includes('instagram') &&
    provider !== 'meta'
  )
    return 'publication_provider_not_supported';
  if (
    (provider.includes('instagram') || assetType.includes('instagram')) &&
    !facebookPageId(publication.assetMetadata)
  )
    return 'instagram_page_not_resolved';
  return null;
}

export function metaCampaignObjective(template: SocialBoostTemplateEntity) {
  return template.objective === 'awareness'
    ? 'OUTCOME_AWARENESS'
    : 'OUTCOME_ENGAGEMENT';
}

export function metaOptimizationGoal(template: SocialBoostTemplateEntity) {
  return GOALS[template.performanceGoal];
}

export function facebookPageId(metadata: Record<string, unknown>) {
  for (const key of ['facebookPageId', 'pageId', 'page_id']) {
    const value = metadata[key];
    if (typeof value === 'string' && /^\d+$/.test(value)) return value;
  }
  for (const key of ['page', 'facebookPage', 'facebook_page']) {
    const value = metadata[key];
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const id = (value as Record<string, unknown>).id;
      if (typeof id === 'string' && /^\d+$/.test(id)) return id;
    }
  }
  return null;
}
