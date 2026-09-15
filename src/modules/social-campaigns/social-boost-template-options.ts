import type {
  SocialBoostConversionLocation,
  SocialBoostObjective,
  SocialBoostPerformanceGoal,
} from './entities';

export const SOCIAL_BOOST_OBJECTIVES = [
  'awareness',
  'traffic',
  'engagement',
  'leads',
  'sales',
  'followers',
] as const satisfies readonly SocialBoostObjective[];

export const SOCIAL_BOOST_PERFORMANCE_GOALS = [
  'reach',
  'impressions',
  'link_clicks',
  'landing_page_views',
  'post_engagement',
  'thruplay',
  'two_second_video_views',
  'messaging_conversations_started',
  'instant_form_leads',
  'website_leads',
  'conversions',
  'value',
  'profile_visits',
  'page_likes',
] as const satisfies readonly SocialBoostPerformanceGoal[];

export const SOCIAL_BOOST_CONVERSION_LOCATIONS = [
  'on_ad',
  'website',
  'messaging_apps',
  'instant_forms',
  'instagram_profile',
  'facebook_page',
  'shop',
] as const satisfies readonly SocialBoostConversionLocation[];

type Combination = {
  goal: SocialBoostPerformanceGoal;
  locations: readonly SocialBoostConversionLocation[];
};

/**
 * Product vocabulary for Meta's objective / performance goal compatibility.
 * Provider API names remain isolated from stored templates so Graph versions
 * can evolve without rewriting the user's intent.
 */
export const SOCIAL_BOOST_COMPATIBILITY: Record<
  SocialBoostObjective,
  readonly Combination[]
> = {
  awareness: [
    { goal: 'reach', locations: ['on_ad'] },
    { goal: 'impressions', locations: ['on_ad'] },
  ],
  traffic: [
    {
      goal: 'link_clicks',
      locations: ['website', 'instagram_profile', 'facebook_page'],
    },
    { goal: 'landing_page_views', locations: ['website'] },
  ],
  engagement: [
    { goal: 'post_engagement', locations: ['on_ad'] },
    { goal: 'thruplay', locations: ['on_ad'] },
    { goal: 'two_second_video_views', locations: ['on_ad'] },
    {
      goal: 'messaging_conversations_started',
      locations: ['messaging_apps'],
    },
  ],
  leads: [
    { goal: 'instant_form_leads', locations: ['instant_forms'] },
    { goal: 'website_leads', locations: ['website'] },
    {
      goal: 'messaging_conversations_started',
      locations: ['messaging_apps'],
    },
  ],
  sales: [
    { goal: 'conversions', locations: ['website', 'shop'] },
    { goal: 'value', locations: ['website', 'shop'] },
  ],
  followers: [
    { goal: 'profile_visits', locations: ['instagram_profile'] },
    { goal: 'page_likes', locations: ['facebook_page'] },
  ],
};

export function isSocialBoostCombinationSupported(
  objective: SocialBoostObjective,
  performanceGoal: SocialBoostPerformanceGoal,
  conversionLocation: SocialBoostConversionLocation,
) {
  return SOCIAL_BOOST_COMPATIBILITY[objective].some(
    (entry) =>
      entry.goal === performanceGoal &&
      entry.locations.includes(conversionLocation),
  );
}
