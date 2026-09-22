import { Injectable, OnModuleInit } from '@nestjs/common';

export type SocialCampaignRecommendationProviderMode =
  | 'disabled'
  | 'mock'
  | 'live';

/** Runtime and cost guardrails for advisory Campaigns analysis. */
@Injectable()
export class SocialCampaignRecommendationConfigService implements OnModuleInit {
  readonly mode = resolveMode();

  readonly endpoint = (
    process.env.SOCIAL_CAMPAIGN_RECOMMENDATION_PROVIDER_BASE_URL ??
    process.env.SOCIAL_COPY_GENERATION_PROVIDER_BASE_URL ??
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');

  readonly apiKey = resolveApiKey(this.endpoint);

  readonly model =
    process.env.SOCIAL_CAMPAIGN_RECOMMENDATION_MODEL ??
    process.env.SOCIAL_COPY_GENERATION_MODEL ??
    'gpt-5.6-terra';

  readonly timeoutMs = boundedNumber(
    'SOCIAL_CAMPAIGN_RECOMMENDATION_TIMEOUT_MS',
    30_000,
    1_000,
    120_000,
  );

  readonly maxAttempts = boundedNumber(
    'SOCIAL_CAMPAIGN_RECOMMENDATION_MAX_ATTEMPTS',
    2,
    1,
    3,
  );

  readonly dailyBudgetCents = boundedNumber(
    'SOCIAL_CAMPAIGN_RECOMMENDATION_DAILY_BUDGET_CENTS',
    200,
    0,
    100_000,
  );

  readonly reserveCents = boundedNumber(
    'SOCIAL_CAMPAIGN_RECOMMENDATION_RESERVE_CENTS',
    5,
    0,
    10_000,
  );

  readonly inputCentsPerMillionTokens = boundedNumberWithFallback(
    'SOCIAL_CAMPAIGN_RECOMMENDATION_INPUT_CENTS_PER_MTOK',
    'SOCIAL_COPY_GENERATION_INPUT_CENTS_PER_MTOK',
    125,
    0,
    1_000_000,
  );

  readonly outputCentsPerMillionTokens = boundedNumberWithFallback(
    'SOCIAL_CAMPAIGN_RECOMMENDATION_OUTPUT_CENTS_PER_MTOK',
    'SOCIAL_COPY_GENERATION_OUTPUT_CENTS_PER_MTOK',
    1_000,
    0,
    1_000_000,
  );

  onModuleInit(): void {
    if (this.mode !== 'live') return;
    if (!this.apiKey || !this.model) {
      throw new Error(
        'social_campaign_recommendation_live_configuration_missing',
      );
    }
    const endpoint = new URL(this.endpoint);
    const local =
      endpoint.hostname === 'localhost' || endpoint.hostname === '127.0.0.1';
    if (endpoint.protocol !== 'https:' && !local) {
      throw new Error('social_campaign_recommendation_endpoint_must_use_https');
    }
  }
}

function resolveMode(): SocialCampaignRecommendationProviderMode {
  const value =
    process.env.SOCIAL_CAMPAIGN_RECOMMENDATION_PROVIDER_MODE ??
    process.env.SOCIAL_COPY_GENERATION_PROVIDER_MODE ??
    'disabled';
  if (value === 'disabled' || value === 'mock' || value === 'live')
    return value;
  throw new Error('social_campaign_recommendation_provider_mode_invalid');
}

function resolveApiKey(endpoint: string): string {
  const explicit =
    process.env.SOCIAL_CAMPAIGN_RECOMMENDATION_PROVIDER_API_KEY?.trim() ??
    process.env.SOCIAL_COPY_GENERATION_PROVIDER_API_KEY?.trim();
  if (explicit) return explicit;
  try {
    if (new URL(endpoint).hostname !== 'api.openai.com') return '';
  } catch {
    return '';
  }
  return process.env.OPENAI_API_KEY?.trim() ?? '';
}

function boundedNumberWithFallback(
  name: string,
  fallbackName: string,
  fallback: number,
  min: number,
  max: number,
) {
  return boundedNumberValue(
    process.env[name] ?? process.env[fallbackName],
    fallback,
    min,
    max,
  );
}

function boundedNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
) {
  return boundedNumberValue(process.env[name], fallback, min, max);
}

function boundedNumberValue(
  raw: string | undefined,
  fallback: number,
  min: number,
  max: number,
) {
  const value = Number(raw ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
