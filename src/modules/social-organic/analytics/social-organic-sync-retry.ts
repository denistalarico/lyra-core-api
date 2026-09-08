import { SocialOrganicCredentialError } from '../credentials/social-organic-credential.error';
import { MetaOrganicGraphError } from '../providers/meta/meta-organic-graph.error';
import { MetaOrganicInsightsNormalizationError } from './meta/meta-organic-insights.normalizer';
import { SocialOrganicSyncError } from './social-organic-sync.error';

export type SocialOrganicSyncRetryPolicy = {
  retry: boolean;
  rateLimited: boolean;
  code: string;
};

export function classifyOrganicSyncFailure(
  error: unknown,
): SocialOrganicSyncRetryPolicy {
  if (error instanceof MetaOrganicGraphError) {
    return {
      retry: error.kind === 'transient' || error.kind === 'rate_limited',
      rateLimited: error.kind === 'rate_limited',
      code: error.code,
    };
  }
  if (error instanceof SocialOrganicCredentialError) {
    return { retry: false, rateLimited: false, code: error.code };
  }
  if (error instanceof SocialOrganicSyncError) {
    return { retry: false, rateLimited: false, code: error.code };
  }
  if (error instanceof MetaOrganicInsightsNormalizationError) {
    return { retry: false, rateLimited: false, code: error.code };
  }
  return { retry: true, rateLimited: false, code: 'internal_error' };
}

/** Exponential backoff with bounded jitter; rate limits start at 15 minutes. */
export function nextOrganicSyncAttempt(input: {
  attempts: number;
  rateLimited: boolean;
  now: Date;
  random?: () => number;
}): Date {
  const base = input.rateLimited ? 15 * 60_000 : 60_000;
  const ceiling = input.rateLimited ? 2 * 60 * 60_000 : 15 * 60_000;
  const delay = Math.min(ceiling, base * 2 ** Math.max(0, input.attempts - 1));
  const random = input.random ?? Math.random;
  const jitter = 0.8 + Math.min(1, Math.max(0, random())) * 0.4;
  return new Date(input.now.getTime() + Math.round(delay * jitter));
}
