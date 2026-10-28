import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import {
  ACCOUNT_LOCKOUT_LOOKBACK_MS,
  accountLockedUntil,
  type AuthAttemptOutcome,
} from './account-lockout.policy';

const MINUTE = 60 * 1000;
const MAX_OUTCOMES_PER_ACCOUNT = 50;

export type AuthRateLimitRule = { limit: number; windowMs: number };

/** Limits keyed by an identity (`tenantId:userId`), shared by every surface. */
export const IDENTITY_AUTH_RATE_LIMIT_RULES = {
  two_factor_identity: { limit: 5, windowMs: 15 * MINUTE },
  two_factor_email_identity: { limit: 5, windowMs: 15 * MINUTE },
} as const satisfies Record<string, AuthRateLimitRule>;

/** 429 that carries how long to wait; `RetryAfterInterceptor` emits the header. */
export class TooManyAuthAttemptsException extends HttpException {
  constructor(
    readonly retryAfterSeconds: number,
    response: Record<string, unknown> = {
      statusCode: HttpStatus.TOO_MANY_REQUESTS,
      error: 'Too Many Requests',
      message: 'Too many attempts. Wait a few minutes and try again.',
    },
  ) {
    super(response, HttpStatus.TOO_MANY_REQUESTS);
  }
}

type RateLimitBucket = { count: number; resetsAt: number };

/**
 * SEC-02 — in-process auth throttling (same model as
 * `AdminAuthRateLimitService`; no Redis, D-007). Two kinds of state:
 *
 *  - fixed-window attempt buckets (per IP, per IP+account, per identity);
 *  - recent login outcomes per normalized email, replayed through
 *    {@link accountLockedUntil}. The persisted lock of known identities comes
 *    from their login events; this copy gives unknown emails the same lock,
 *    so a 429 never tells an existing account from a missing one.
 *
 * Keys are hashed so no email sits in memory in clear. Everything here is
 * lost on restart, which is acceptable: the account lock that must survive
 * is rebuilt from the database by the caller.
 */
@Injectable()
export class AuthRateLimitService {
  private readonly buckets = new Map<string, RateLimitBucket>();
  private readonly outcomes = new Map<string, AuthAttemptOutcome[]>();

  /** Spends one attempt on each bucket; 429 with the longest wait when any is exhausted. */
  consume<R extends string>(
    rules: Record<R, AuthRateLimitRule>,
    checks: Partial<Record<R, string>>,
  ): void {
    const now = Date.now();
    let retryAfterMs = 0;

    for (const [rule, discriminator] of Object.entries(checks) as Array<
      [R, string | undefined]
    >) {
      if (discriminator === undefined) continue;
      retryAfterMs = Math.max(
        retryAfterMs,
        this.spend(rule, discriminator, rules[rule], now),
      );
    }

    if (retryAfterMs > 0) {
      throw new TooManyAuthAttemptsException(Math.ceil(retryAfterMs / 1000));
    }
  }

  /** Forgets one bucket (a success resets the IP+account counter). */
  clear(rule: string, discriminator: string): void {
    this.buckets.delete(this.key(rule, discriminator));
  }

  noteAccountOutcome(email: string, failed: boolean, now = Date.now()): void {
    const key = this.key('account', normalizeEmail(email));
    const recent = (this.outcomes.get(key) ?? []).filter(
      (outcome) => outcome.at > now - ACCOUNT_LOCKOUT_LOOKBACK_MS,
    );
    recent.push({ failed, at: now });
    this.outcomes.set(key, recent.slice(-MAX_OUTCOMES_PER_ACCOUNT));
    this.pruneIfLarge(now);
  }

  /**
   * 429 while the account is locked, by the persisted lock of its identities
   * (`persistedLockedUntil`) or by the in-memory outcomes of the email.
   */
  assertAccountUnlocked(
    email: string,
    persistedLockedUntil: number | null,
    now = Date.now(),
  ): void {
    const inMemory = accountLockedUntil(
      this.outcomes.get(this.key('account', normalizeEmail(email))) ?? [],
      now,
    );
    const lockedUntil = Math.max(persistedLockedUntil ?? 0, inMemory ?? 0);

    if (lockedUntil > now) {
      throw new TooManyAuthAttemptsException(
        Math.ceil((lockedUntil - now) / 1000),
      );
    }
  }

  /** Test helper: forget every counter. */
  reset(): void {
    this.buckets.clear();
    this.outcomes.clear();
  }

  /** Returns how long to wait (ms) when this attempt exceeds the rule, else 0. */
  private spend(
    rule: string,
    discriminator: string,
    { limit, windowMs }: AuthRateLimitRule,
    now: number,
  ): number {
    const key = this.key(rule, discriminator);
    const current = this.buckets.get(key);

    if (!current || current.resetsAt <= now) {
      this.buckets.set(key, { count: 1, resetsAt: now + windowMs });
      this.pruneIfLarge(now);
      return 0;
    }

    current.count += 1;
    return current.count > limit ? current.resetsAt - now : 0;
  }

  private key(rule: string, discriminator: string) {
    return createHash('sha256')
      .update(`${rule}:${discriminator}`)
      .digest('hex');
  }

  private pruneIfLarge(now: number) {
    if (this.buckets.size > 10_000) {
      for (const [key, bucket] of this.buckets) {
        if (bucket.resetsAt <= now) this.buckets.delete(key);
      }
    }

    if (this.outcomes.size > 10_000) {
      for (const [key, recent] of this.outcomes) {
        const last = recent[recent.length - 1];
        if (!last || last.at <= now - ACCOUNT_LOCKOUT_LOOKBACK_MS) {
          this.outcomes.delete(key);
        }
      }
    }
  }
}

function normalizeEmail(email: string) {
  return email.trim().toLowerCase();
}
