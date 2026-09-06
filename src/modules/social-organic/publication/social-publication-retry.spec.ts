import type { SocialPublicationFailureReason } from './entities/social-publication.entity';
import {
  nextPublicationAvailableAt,
  shouldRetryPublication,
} from './social-publication-retry';

describe('social publication retry policy', () => {
  it.each<SocialPublicationFailureReason>([
    'credential_expired',
    'permission_lost',
    'media_rejected',
    'payload_invalid',
    'duplicate_content',
    'asset_disabled',
  ])('never retries non-retryable reason %s', (reason) => {
    expect(
      shouldRetryPublication({ reason, attempts: 1, maxAttempts: 5 }),
    ).toBe(false);
  });

  it.each<SocialPublicationFailureReason>([
    'rate_limited',
    'provider_unavailable',
  ])('retries %s while attempts remain', (reason) => {
    expect(
      shouldRetryPublication({ reason, attempts: 4, maxAttempts: 5 }),
    ).toBe(true);
    expect(
      shouldRetryPublication({ reason, attempts: 5, maxAttempts: 5 }),
    ).toBe(false);
  });

  it('retries unknown exactly once', () => {
    expect(
      shouldRetryPublication({
        reason: 'unknown',
        attempts: 1,
        maxAttempts: 5,
      }),
    ).toBe(true);
    expect(
      shouldRetryPublication({
        reason: 'unknown',
        attempts: 2,
        maxAttempts: 5,
      }),
    ).toBe(false);
  });

  it('uses exponential backoff with bounded jitter', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const first = nextPublicationAvailableAt({
      reason: 'provider_unavailable',
      attempts: 1,
      now,
      random: () => 0,
    });
    const second = nextPublicationAvailableAt({
      reason: 'provider_unavailable',
      attempts: 2,
      now,
      random: () => 1,
    });

    expect(first.getTime() - now.getTime()).toBe(30_000);
    expect(second.getTime() - now.getTime()).toBe(72_000);
  });

  it('gives rate limits the longer base delay', () => {
    const now = new Date('2026-09-06T12:00:00.000Z');
    const availableAt = nextPublicationAvailableAt({
      reason: 'rate_limited',
      attempts: 1,
      now,
      random: () => 0,
    });

    expect(availableAt.getTime() - now.getTime()).toBe(5 * 60_000);
  });
});
