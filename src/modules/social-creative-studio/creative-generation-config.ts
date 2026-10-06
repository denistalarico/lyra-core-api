import { Injectable } from '@nestjs/common';

export const CREATIVE_GENERATION_WORKER_ENABLED_ENV =
  'CREATIVE_GENERATION_WORKER_ENABLED';
export const CREATIVE_GENERATION_WORKER_CONCURRENCY_ENV =
  'CREATIVE_GENERATION_WORKER_CONCURRENCY';
export const CREATIVE_GENERATION_TENANT_CONCURRENCY_ENV =
  'CREATIVE_GENERATION_TENANT_CONCURRENCY';
export const CREATIVE_GENERATION_MAX_ATTEMPTS_ENV =
  'CREATIVE_GENERATION_MAX_ATTEMPTS';

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
}

function bounded(name: string, fallback: number, min: number, max: number) {
  const raw = process.env[name]?.trim();
  if (!raw) return fallback;
  const value = Number(raw);
  if (!Number.isInteger(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}
