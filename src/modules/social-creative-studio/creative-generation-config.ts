import { Injectable } from '@nestjs/common';

export const CREATIVE_GENERATION_WORKER_ENABLED_ENV =
  'CREATIVE_GENERATION_WORKER_ENABLED';
export const CREATIVE_GENERATION_WORKER_CONCURRENCY_ENV =
  'CREATIVE_GENERATION_WORKER_CONCURRENCY';
export const CREATIVE_GENERATION_TENANT_CONCURRENCY_ENV =
  'CREATIVE_GENERATION_TENANT_CONCURRENCY';
export const CREATIVE_GENERATION_MAX_ATTEMPTS_ENV =
  'CREATIVE_GENERATION_MAX_ATTEMPTS';
export const CREATIVE_IMAGE_GENERATION_PROVIDER_ENV =
  'CREATIVE_IMAGE_GENERATION_PROVIDER';
export const CREATIVE_IMAGE_GENERATION_API_KEY_ENV =
  'CREATIVE_IMAGE_GENERATION_API_KEY';
export const CREATIVE_IMAGE_GENERATION_MODEL_ENV =
  'CREATIVE_IMAGE_GENERATION_MODEL';
export const CREATIVE_IMAGE_GENERATION_TIMEOUT_MS_ENV =
  'CREATIVE_IMAGE_GENERATION_TIMEOUT_MS';

/**
 * CS3.3 — pinned snapshot, not the moving alias, so the model recorded on a
 * generation is exactly the one that ran (the Images API does not echo it).
 * OpenAI's guidance (2026-10): Flare for "fast, high-quality everyday image
 * generation", Sunburst where editing precision matters most.
 */
export const DEFAULT_OPENAI_IMAGE_MODEL = 'gpt-image-2.5-flare-2026-09-08';

/** `invalid` is any value other than these two; the binding treats it as disabled. */
export type CreativeImageGenerationProviderSetting =
  | 'disabled'
  | 'openai'
  | 'invalid';

/**
 * CS3.2 — knobs of the Creative Studio generation queue.
 *
 * Same contract as `SocialAdSyncConfigService`: getters read `process.env` per
 * call so tests can set values, but a running process only sees `.env` edits
 * after a restart.
 *
 * `workerEnabled` is what separates the worker from the API later: the API
 * process sets it to `false` and keeps accepting/reading generations; a worker
 * process booting the same module with it `true` (the default) claims them.
 * Claims are `SKIP LOCKED`, so any number of worker processes can coexist.
 *
 * Whether generations are accepted at all is NOT here: it belongs to the bound
 * provider (`ImageGenerationProvider.enabled`), so no switch can enqueue work
 * that has no provider to run it.
 */
@Injectable()
export class CreativeGenerationConfigService {
  /** Whether THIS process claims generations. Default true. */
  get workerEnabled(): boolean {
    const raw =
      process.env[CREATIVE_GENERATION_WORKER_ENABLED_ENV]?.trim().toLowerCase();
    if (raw === undefined || raw === '') return true;
    return !['false', '0', 'no', 'off'].includes(raw);
  }

  /** Generations one worker process runs at the same time. */
  get workerConcurrency(): number {
    return bounded(CREATIVE_GENERATION_WORKER_CONCURRENCY_ENV, 2, 1, 8);
  }

  /**
   * Generations of one tenant in `processing` at the same time. Exact within a
   * worker; with several workers it can be exceeded by at most one per
   * concurrently claiming worker (the check and the claim are not one lock).
   * A technical fairness bound, not a commercial quota.
   */
  get tenantConcurrency(): number {
    return bounded(CREATIVE_GENERATION_TENANT_CONCURRENCY_ENV, 2, 1, 20);
  }

  /** Provider calls per generation, first attempt included. Frozen on the row at enqueue. */
  get maxAttempts(): number {
    return bounded(CREATIVE_GENERATION_MAX_ATTEMPTS_ENV, 3, 1, 5);
  }

  /**
   * CS3.3 kill switch. Only an explicit `openai` binds a paid provider; the
   * mere presence of an API key never does. Read once, when the module binds
   * the provider — changing it needs a restart.
   */
  get imageProvider(): CreativeImageGenerationProviderSetting {
    const raw =
      process.env[CREATIVE_IMAGE_GENERATION_PROVIDER_ENV]?.trim().toLowerCase();
    if (!raw || raw === 'disabled') return 'disabled';
    return raw === 'openai' ? 'openai' : 'invalid';
  }

  /**
   * An explicit key wins (lets the platform use a separate OpenAI project for
   * image spend); otherwise the shared `OPENAI_API_KEY`. The endpoint is fixed
   * to api.openai.com, so the fallback can never ship the key elsewhere.
   */
  get openAiApiKey(): string {
    return (
      process.env[CREATIVE_IMAGE_GENERATION_API_KEY_ENV]?.trim() ||
      process.env.OPENAI_API_KEY?.trim() ||
      ''
    );
  }

  /** Internal only: never part of the HTTP contract. */
  get imageModel(): string {
    return (
      process.env[CREATIVE_IMAGE_GENERATION_MODEL_ENV]?.trim() ||
      DEFAULT_OPENAI_IMAGE_MODEL
    );
  }

  /**
   * One provider call. Default 3 min (OpenAI: complex prompts "may take up to
   * 2 minutes"); capped at 5 min so call + storing four outputs stays well
   * inside the worker's 10-minute lease.
   */
  get imageTimeoutMs(): number {
    return bounded(
      CREATIVE_IMAGE_GENERATION_TIMEOUT_MS_ENV,
      180_000,
      30_000,
      300_000,
    );
  }
}

function bounded(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
