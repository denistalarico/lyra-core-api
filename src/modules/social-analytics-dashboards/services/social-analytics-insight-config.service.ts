import { Injectable, OnModuleInit } from '@nestjs/common';

export type SocialAnalyticsInsightProviderMode = 'disabled' | 'mock' | 'live';

/**
 * Runtime config for "Analisar com Orion" — Etapa 8.
 *
 * Mirrors `SocialCopyGenerationConfigService` field for field, which in turn
 * mirrors the briefing extractor: read `process.env` directly (no ConfigModule
 * registration, consistent with both), default to `disabled` so no deployment
 * starts paying a provider because a migration ran, and refuse to boot in
 * `live` mode without a usable key, model and HTTPS endpoint.
 *
 * WHY `disabled` IS THE DEFAULT AND NOT `mock`
 * --------------------------------------------
 * The generated text is frozen into the dashboard layout as an `insight` card
 * and is then read as an analysis of the client's numbers — by the agency, and
 * through the Etapa 9 report by the client. Synthetic prose sitting in that
 * card is worse than an empty one: nothing on screen distinguishes it from a
 * real reading. `mock` exists for local work on the wiring and says so in its
 * own body text; `disabled` answers 503 with a code the UI turns into a
 * disabled button plus an explanation, which is what the plan asks for.
 *
 * WHY THE COST IS RECORDED EVEN THOUGH NOTHING CHARGES FOR IT YET
 * ---------------------------------------------------------------
 * §6.3 of the plan: credit charging is not implemented and the confirmation
 * modal only prepares the ground. A run that records its cost in cents from the
 * day it ships can be billed retroactively; one that does not has thrown the
 * information away, and no later migration can recover it.
 */
@Injectable()
export class SocialAnalyticsInsightConfigService implements OnModuleInit {
  readonly mode = resolveMode();

  readonly endpoint = (
    process.env.SOCIAL_ANALYTICS_INSIGHT_PROVIDER_BASE_URL ??
    'https://api.openai.com/v1'
  ).replace(/\/$/, '');

  readonly apiKey = resolveApiKey(this.endpoint);

  readonly model =
    process.env.SOCIAL_ANALYTICS_INSIGHT_MODEL ?? 'gpt-5.6-terra';

  readonly timeoutMs = boundedNumber(
    'SOCIAL_ANALYTICS_INSIGHT_TIMEOUT_MS',
    45_000,
    1_000,
    120_000,
  );

  readonly maxAttempts = boundedNumber(
    'SOCIAL_ANALYTICS_INSIGHT_MAX_ATTEMPTS',
    2,
    1,
    3,
  );

  /**
   * Ceiling on the serialized metric block sent as context. The block is built
   * from a section's cards, and a dashboard may hold dozens — the cap is what
   * keeps one oversized section from becoming an oversized bill.
   */
  readonly maxContextChars = boundedNumber(
    'SOCIAL_ANALYTICS_INSIGHT_MAX_CONTEXT_CHARS',
    8_000,
    500,
    40_000,
  );

  /** Cost per million tokens, in cents. See the note above on why it is stored. */
  readonly inputCentsPerMillionTokens = boundedNumber(
    'SOCIAL_ANALYTICS_INSIGHT_INPUT_CENTS_PER_MTOK',
    125,
    0,
    1_000_000,
  );

  readonly outputCentsPerMillionTokens = boundedNumber(
    'SOCIAL_ANALYTICS_INSIGHT_OUTPUT_CENTS_PER_MTOK',
    1_000,
    0,
    1_000_000,
  );

  /** What the frontend needs to decide whether to offer the button at all. */
  get available(): boolean {
    return this.mode !== 'disabled';
  }

  onModuleInit(): void {
    if (this.mode === 'live') this.assertLive();
  }

  private assertLive(): void {
    if (!this.apiKey || !this.model)
      throw new Error('social_analytics_insight_live_configuration_missing');

    const parsed = new URL(this.endpoint);
    const local =
      parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    if (parsed.protocol !== 'https:' && !local)
      throw new Error('social_analytics_insight_endpoint_must_use_https');
  }
}

function resolveMode(): SocialAnalyticsInsightProviderMode {
  const value =
    process.env.SOCIAL_ANALYTICS_INSIGHT_PROVIDER_MODE ?? 'disabled';
  if (value === 'disabled' || value === 'mock' || value === 'live')
    return value;
  throw new Error('social_analytics_insight_provider_mode_invalid');
}

/**
 * An explicit key wins. Falling back to `OPENAI_API_KEY` only when the endpoint
 * really is OpenAI is the same guard the Planner uses — it stops a
 * misconfigured base URL from shipping the platform's key to a third party.
 */
function resolveApiKey(endpoint: string): string {
  const explicit =
    process.env.SOCIAL_ANALYTICS_INSIGHT_PROVIDER_API_KEY?.trim();
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
