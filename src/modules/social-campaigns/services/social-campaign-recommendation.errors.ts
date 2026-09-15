export class SocialCampaignRecommendationError extends Error {
  constructor(
    readonly code: string,
    readonly attempts = 1,
  ) {
    super(code);
    this.name = 'SocialCampaignRecommendationError';
  }
}

export function socialCampaignRecommendationErrorCode(error: unknown): string {
  return error instanceof SocialCampaignRecommendationError
    ? error.code
    : 'recommendation_generation_failed';
}
