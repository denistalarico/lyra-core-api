import type { SocialPublicationFailureReason } from './entities/social-publication.entity';

const TRANSIENT_BASE_MS = 30_000;
const RATE_LIMIT_BASE_MS = 5 * 60_000;
const RETRY_CEILING_MS = 60 * 60_000;
const JITTER_RATIO = 0.2;

const RETRYABLE_REASONS = new Set<SocialPublicationFailureReason>([
  'rate_limited',
  'provider_unavailable',
  'unknown',
]);

/** `unknown` gets one retry; every other retryable reason uses max_attempts. */
export function shouldRetryPublication(input: {
  reason: SocialPublicationFailureReason;
  attempts: number;
  maxAttempts: number;
}): boolean {
  if (!RETRYABLE_REASONS.has(input.reason)) return false;
  if (input.attempts >= input.maxAttempts) return false;

  return input.reason !== 'unknown' || input.attempts === 1;
}

/** Exponential delay plus bounded positive jitter, stored through available_at. */
export function nextPublicationAvailableAt(input: {
  reason: Extract<
    SocialPublicationFailureReason,
    'rate_limited' | 'provider_unavailable' | 'unknown'
  >;
  attempts: number;
  now: Date;
  random?: () => number;
}): Date {
  const base =
    input.reason === 'rate_limited' ? RATE_LIMIT_BASE_MS : TRANSIENT_BASE_MS;
  const exponent = Math.max(0, input.attempts - 1);
  const delay = Math.min(RETRY_CEILING_MS, base * 2 ** exponent);
  const sample = Math.min(1, Math.max(0, (input.random ?? Math.random)()));
  const jitter = Math.floor(delay * JITTER_RATIO * sample);

  return new Date(input.now.getTime() + delay + jitter);
}
