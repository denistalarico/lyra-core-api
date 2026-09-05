export interface SocialPlannerFunnelDistribution {
  discovery: number;
  recognition: number;
  consideration: number;
  decision: number;
}

export interface SocialPlannerCatalogItem {
  key: string;
  label: string;
  enabled: boolean;
}

export interface SocialPlannerCtaDefaults {
  [objectiveKey: string]: string[];
}

export interface SocialPlannerHashtagDefaults {
  mandatory: string[];
  suggestedCount: number;
  complementWithAi: boolean;
}

export interface SocialPlannerFirstCommentDefaults {
  enabled: boolean;
  template: string | null;
}

export interface SocialPlannerMilestone {
  key: string;
  label: string;
  daysBeforePublication: number;
  enabled: boolean;
}

export interface SocialPlannerSettings {
  monthlyContentVolume: number;

  funnelDistribution: SocialPlannerFunnelDistribution;

  contentTypes: SocialPlannerCatalogItem[];
  objectives: SocialPlannerCatalogItem[];
  creativeFormats: SocialPlannerCatalogItem[];

  ctaDefaults: SocialPlannerCtaDefaults;
  hashtagDefaults: SocialPlannerHashtagDefaults;
  firstCommentDefaults: SocialPlannerFirstCommentDefaults;

  hookLibrary: string[];
  milestones: SocialPlannerMilestone[];
}
