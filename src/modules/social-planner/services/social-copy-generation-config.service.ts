import { Injectable, OnModuleInit } from '@nestjs/common';

export type SocialCopyGenerationProviderMode = 'disabled' | 'mock' | 'live';

/**
 * Runtime config for Planner copy generation (E8).
 *
 * Mirrors `LeadFlowBriefingExtractionConfigService`, which in turn mirrors
 * `InboxRuntimeConfigService`: read `process.env` directly (no ConfigModule
 * registration, consistent with both), default to `disabled` so no deployment
 * starts paying for a provider because a migration ran, and refuse to boot in
 * `live` mode without a usable key, model and HTTPS endpoint.
 *
 * WHY THE DEFAULT IS `disabled` AND NOT `mock`
 * --------------------------------------------
 * `mock` writes synthetic copy into proposal rows. In production that is worse
 * than nothing: an operator would be reviewing invented text believing a model
 * wrote it. Disabled means the endpoints answer 503 with a clear code and the
 * UI can keep the button disabled with an explanation, which is exactly what
 * the E4 registro already anticipated for this feature.
 */
@Injectable()
export class SocialCopyGenerationConfigService implements OnModuleInit {
  readonly mode = resolveMode();

  readonly endpoint = (
    process.env.SOCIAL_COPY_GENERATION_PROVIDER_BASE_URL ??
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');

  readonly apiKey = resolveApiKey(this.endpoint);

  readonly model = process.env.SOCIAL_COPY_GENERATION_MODEL ?? 'gpt-5.6-terra';

  readonly timeoutMs = boundedNumber(
    'SOCIAL_COPY_GENERATION_TIMEOUT_MS',
    30_000,
    1_000,
    120_000,
  );

  readonly maxAttempts = boundedNumber(
    'SOCIAL_COPY_GENERATION_MAX_ATTEMPTS',
    2,
    1,
    3,
  );

  /**
   * How many runs one plan-wide or selection request may enqueue. A month of
   * content is tens of items; an unbounded fan-out is an unbounded bill.
   */
  readonly maxItemsPerRequest = boundedNumber(
    'SOCIAL_COPY_GENERATION_MAX_ITEMS_PER_REQUEST',
    30,
    1,
    200,
  );

  /** Keeps one prompt's editorial context from growing without limit. */
  readonly maxContextChars = boundedNumber(
    'SOCIAL_COPY_GENERATION_MAX_CONTEXT_CHARS',
    12_000,
    500,
    60_000,
  );

  readonly dailyBudgetCents = boundedNumber(
    'SOCIAL_COPY_GENERATION_DAILY_BUDGET_CENTS',
    500,
    0,
    100_000,
  );

  /** Held against the budget while a run is in flight, before real usage is known. */
  readonly reserveCents = boundedNumber(
    'SOCIAL_COPY_GENERATION_RESERVE_CENTS',
    5,
    0,
    10_000,
  );

  /**
   * Cost per million tokens, in cents, used to turn provider usage into the
   * estimate stored on the run. Deliberately configurable: prices change, and a
   * hardcoded number would quietly make the §8.6 profitability figure wrong.
   * Every run recording a cost from these rates is flagged `costIsEstimated`.
   */
  readonly inputCentsPerMillionTokens = boundedNumber(
    'SOCIAL_COPY_GENERATION_INPUT_CENTS_PER_MTOK',
    125,
    0,
    1_000_000,
  );

  readonly outputCentsPerMillionTokens = boundedNumber(
    'SOCIAL_COPY_GENERATION_OUTPUT_CENTS_PER_MTOK',
    1_000,
    0,
    1_000_000,
  );

  onModuleInit(): void {
    if (this.mode === 'live') this.assertLive();
  }

  private assertLive(): void {
    if (!this.apiKey || !this.model)
      throw new Error('social_copy_generation_live_configuration_missing');

    const parsed = new URL(this.endpoint);
    const local =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !local)
      throw new Error('social_copy_generation_endpoint_must_use_https');
  }
}

function resolveMode(): SocialCopyGenerationProviderMode {
  const value = process.env.SOCIAL_COPY_GENERATION_PROVIDER_MODE ?? 'disabled';
  if (value === 'disabled' || value === 'mock' || value === 'live')
    return value;
  throw new Error('social_copy_generation_provider_mode_invalid');
}

/**
 * An explicit key wins. Falling back to `OPENAI_API_KEY` only when the endpoint
 * really is OpenAI is the same guard the briefing config uses — it stops a
 * misconfigured base URL from shipping the platform's key to a third party.
 */
function resolveApiKey(endpoint: string): string {
  const explicit = process.env.SOCIAL_COPY_GENERATION_PROVIDER_API_KEY?.trim();
  if (explicit) return explicit;

  try {
    if (new URL(endpoint).hostname !== 'api.openai.com') return '';
  } catch {
    return '';
  }

  return process.env.OPENAI_API_KEY?.trim() ?? '';
}

function boundedNumber(
  name: string,
  fallback: number,
  min: number,
  max: number,
): number {
  const value = Number(process.env[name] ?? fallback);
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.round(value)));
}
