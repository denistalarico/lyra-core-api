import { Injectable } from '@nestjs/common';
import { bounded } from './creative-generation-config';
import { isNonNegativeDecimal } from './creative-video-pricing';

export const CREATIVE_VIDEO_GENERATION_ENABLED_ENV =
  'CREATIVE_VIDEO_GENERATION_ENABLED';
export const CREATIVE_VIDEO_GENERATIVE_PROVIDER_ENV =
  'CREATIVE_VIDEO_GENERATIVE_PROVIDER';
export const CREATIVE_VIDEO_UGC_PROVIDER_ENV = 'CREATIVE_VIDEO_UGC_PROVIDER';
export const VIDU_API_KEY_ENV = 'VIDU_API_KEY';
export const HEYGEN_API_KEY_ENV = 'HEYGEN_API_KEY';
export const HEYGEN_WEBHOOK_SECRET_ENV = 'HEYGEN_WEBHOOK_SECRET';
export const CREATIVE_VIDEO_PRICING_CONFIRMED_ENV =
  'CREATIVE_VIDEO_PRICING_CONFIRMED';
export const CREATIVE_VIDEO_VIDU_CREDIT_PRICE_USD_ENV =
  'CREATIVE_VIDEO_VIDU_CREDIT_PRICE_USD';
export const CREATIVE_VIDEO_UGC_ENGINE_ENV = 'CREATIVE_VIDEO_UGC_ENGINE';
export const CREATIVE_VIDEO_CALLBACK_BASE_URL_ENV =
  'CREATIVE_VIDEO_CALLBACK_BASE_URL';

export const CREATIVE_VIDEO_UGC_ENGINES = [
  'avatar_iii',
  'avatar_iv',
  'avatar_v',
] as const;
export type CreativeVideoUgcEngine =
  (typeof CREATIVE_VIDEO_UGC_ENGINES)[number];

/** `invalid` is any value outside the known set; the registry treats it as disabled. */
export type CreativeVideoProviderSetting<T extends string> =
  | T
  | 'disabled'
  | 'invalid';

/**
 * CS4-B — knobs of Reel generation. Same contract as
 * `CreativeGenerationConfigService`: getters read `process.env` per call (tests
 * set values), a running process sees `.env` edits only after a restart, and
 * providers are bound once at module init.
 *
 * Three independent keys must ALL be turned for a paid call to happen:
 *   1. `CREATIVE_VIDEO_GENERATION_ENABLED=true` — global kill switch, default off;
 *   2. the mode's provider setting plus its DEDICATED key (`VIDU_API_KEY`,
 *      `HEYGEN_API_KEY`; never the image/OpenAI key);
 *   3. `CREATIVE_VIDEO_PRICING_CONFIRMED` naming the adapter's pricing
 *      version — the operator's statement that the price table matches the
 *      account, since clients are billed exactly this cost.
 * Whether THIS process runs the worker is the existing process-role switch
 * `CREATIVE_GENERATION_WORKER_ENABLED` (API vs worker process).
 */
@Injectable()
export class CreativeVideoGenerationConfigService {
  get enabled(): boolean {
    const raw =
      process.env[CREATIVE_VIDEO_GENERATION_ENABLED_ENV]?.trim().toLowerCase();
    return ['true', '1', 'yes', 'on'].includes(raw ?? '');
  }

  get generativeProvider(): CreativeVideoProviderSetting<'vidu'> {
    return setting(CREATIVE_VIDEO_GENERATIVE_PROVIDER_ENV, 'vidu', ['vidu']);
  }

  get ugcProvider(): CreativeVideoProviderSetting<'heygen'> {
    return setting(CREATIVE_VIDEO_UGC_PROVIDER_ENV, 'heygen', ['heygen']);
  }

  get viduApiKey(): string {
    return process.env[VIDU_API_KEY_ENV]?.trim() ?? '';
  }

  get heygenApiKey(): string {
    return process.env[HEYGEN_API_KEY_ENV]?.trim() ?? '';
  }

  /**
   * Secret of the HeyGen webhook endpoint registered with
   * `POST /v3/webhooks/endpoints`. Without it no callback URL is sent to
   * HeyGen at all (polling only): an unverifiable callback is never wanted.
   */
  get heygenWebhookSecret(): string {
    return process.env[HEYGEN_WEBHOOK_SECRET_ENV]?.trim() ?? '';
  }

  /** Comma-separated pricing versions the operator confirmed. */
  get confirmedPricingVersions(): ReadonlySet<string> {
    return new Set(
      (process.env[CREATIVE_VIDEO_PRICING_CONFIRMED_ENV] ?? '')
        .split(',')
        .map((value) => value.trim())
        .filter(Boolean),
    );
  }

  /** USD per Vidu credit when the account's price differs from the table. */
  get viduCreditPriceOverride(): string | null {
    const raw = process.env[CREATIVE_VIDEO_VIDU_CREDIT_PRICE_USD_ENV]?.trim();
    if (!raw || !isNonNegativeDecimal(raw) || Number(raw) <= 0) return null;
    return raw;
  }

  /**
   * HeyGen engine for UGC. Default Avatar IV (HeyGen's v3 default). Unknown
   * values fall back to the default rather than to an unpriced engine.
   */
  get ugcEngine(): CreativeVideoUgcEngine {
    const raw =
      process.env[CREATIVE_VIDEO_UGC_ENGINE_ENV]?.trim().toLowerCase();
    return (CREATIVE_VIDEO_UGC_ENGINES as readonly string[]).includes(raw ?? '')
      ? (raw as CreativeVideoUgcEngine)
      : 'avatar_iv';
  }

  /**
   * Public base URL of THIS API (`https://api.example.com/api`). Unset =
   * polling only. Must be https; anything else is ignored.
   */
  get callbackBaseUrl(): string | null {
    const raw = process.env[CREATIVE_VIDEO_CALLBACK_BASE_URL_ENV]?.trim();
    if (!raw) return null;
    try {
      const url = new URL(raw);
      return url.protocol === 'https:'
        ? url.toString().replace(/\/$/, '')
        : null;
    } catch {
      return null;
    }
  }

  /** Worker steps (submit, poll, download) one process runs per tick. */
  get workerConcurrency(): number {
    return bounded('CREATIVE_VIDEO_WORKER_CONCURRENCY', 2, 1, 8);
  }

  /** Active video generations of one tenant at a time (fairness, not a quota). */
  get tenantConcurrency(): number {
    return bounded('CREATIVE_VIDEO_TENANT_CONCURRENCY', 2, 1, 20);
  }

  /**
   * Provider jobs Lyra keeps open at once, per provider. Conservative: Vidu's
   * default organization limit is 5 concurrent tasks and HeyGen PAYG allows
   * 10; staying below leaves room for the dashboard and other tools on the
   * same account. Excess work waits in Lyra, not in the provider queue.
   */
  get providerConcurrency(): number {
    return bounded('CREATIVE_VIDEO_PROVIDER_CONCURRENCY', 3, 1, 20);
  }

  /** Polling cadence while a provider job runs (callbacks only shorten it). */
  get pollIntervalSeconds(): number {
    return bounded('CREATIVE_VIDEO_POLL_INTERVAL_SECONDS', 20, 5, 300);
  }

  /** A generation not finished by then fails `timeout`. */
  get deadlineMinutes(): number {
    return bounded('CREATIVE_VIDEO_DEADLINE_MINUTES', 180, 30, 1440);
  }

  /** Consecutive transient step failures (network, 5xx, storage) before failing. */
  get maxStepRetries(): number {
    return bounded('CREATIVE_VIDEO_MAX_STEP_RETRIES', 6, 1, 20);
  }

  /** Submits of one operation that provably created nothing. */
  get maxSubmitAttempts(): number {
    return bounded('CREATIVE_VIDEO_MAX_SUBMIT_ATTEMPTS', 3, 1, 5);
  }

  /** One provider API call (submit/status). */
  get httpTimeoutMs(): number {
    return bounded('CREATIVE_VIDEO_HTTP_TIMEOUT_MS', 60_000, 5_000, 120_000);
  }

  /** One output download; well inside the 10-minute step lease. */
  get downloadTimeoutMs(): number {
    return bounded(
      'CREATIVE_VIDEO_DOWNLOAD_TIMEOUT_MS',
      240_000,
      30_000,
      400_000,
    );
  }
}

function setting<T extends string>(
  name: string,
  fallback: T,
  allowed: readonly T[],
): CreativeVideoProviderSetting<T> {
  const raw = process.env[name]?.trim().toLowerCase();
  if (!raw) return fallback;
  if (raw === 'disabled') return 'disabled';
  return (allowed as readonly string[]).includes(raw) ? (raw as T) : 'invalid';
}
