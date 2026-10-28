import { HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request } from 'express';
import { TooManyAuthAttemptsException } from '../../../common/security/auth-rate-limit.service';
import { CLIENT_AREA_ERROR_CODES } from '../client-area.types';

type RateLimitBucket = { count: number; resetsAt: number };

const MINUTE = 60 * 1000;

/**
 * CA2 — limits of the public Client Area endpoints, in one place.
 *
 * Every limit is keyed by something the caller cannot choose freely (the
 * proxy-observed IP) and, where an account is named, also by that account:
 * `*_ip` stops one origin from spraying many accounts or tokens, `*_account`
 * (IP + email) stops one origin from hammering one account, and `*_email`
 * (email alone, generous) caps a distributed attack on one account without
 * letting a single stranger lock the owner out. The same buckets are spent
 * whether or not the email exists, so a 429 reveals nothing about accounts.
 */
export const CLIENT_AREA_RATE_LIMIT_RULES = {
  security_identity: { limit: 10, windowMs: 5 * MINUTE },
  branding_ip: { limit: 60, windowMs: MINUTE },
  login_ip: { limit: 30, windowMs: 15 * MINUTE },
  // SEC-02: 5 per IP+account, cleared by a correct password (controller).
  login_account: { limit: 5, windowMs: 15 * MINUTE },
  login_email: { limit: 30, windowMs: 15 * MINUTE },
  two_factor_ip: { limit: 10, windowMs: 5 * MINUTE },
  two_factor_email_ip: { limit: 5, windowMs: 5 * MINUTE },
  refresh_ip: { limit: 60, windowMs: MINUTE },
  invitation_preview_ip: { limit: 30, windowMs: 15 * MINUTE },
  invitation_accept_ip: { limit: 10, windowMs: 15 * MINUTE },
  password_forgot_ip: { limit: 10, windowMs: 15 * MINUTE },
  password_forgot_email: { limit: 5, windowMs: 15 * MINUTE },
  password_reset_ip: { limit: 10, windowMs: 15 * MINUTE },
} as const satisfies Record<string, { limit: number; windowMs: number }>;

export type ClientAreaRateLimitRule = keyof typeof CLIENT_AREA_RATE_LIMIT_RULES;

/**
 * Fixed-window, in-process counters (same model as
 * `AdminAuthRateLimitService`; no new dependency). Keys are hashed so no
 * email or token prefix sits in memory in clear. Per-process: with more than
 * one API instance each instance counts on its own (documented CA2 debt).
 */
@Injectable()
export class ClientAreaRateLimitService {
  private readonly buckets = new Map<string, RateLimitBucket>();

  /** Spends one attempt on each bucket; throws 429 when any is exhausted. */
  consume(checks: Partial<Record<ClientAreaRateLimitRule, string>>): void {
    let retryAfterMs = 0;

    for (const [rule, discriminator] of Object.entries(checks) as Array<
      [ClientAreaRateLimitRule, string | undefined]
    >) {
      if (discriminator === undefined) continue;
      retryAfterMs = Math.max(retryAfterMs, this.spend(rule, discriminator));
    }

    if (retryAfterMs > 0) {
      throw new TooManyAuthAttemptsException(Math.ceil(retryAfterMs / 1000), {
        statusCode: HttpStatus.TOO_MANY_REQUESTS,
        error: 'Too Many Requests',
        message: 'Too many attempts. Wait a few minutes and try again.',
        code: CLIENT_AREA_ERROR_CODES.rateLimited,
      });
    }
  }

  /** SEC-02 — forgets one bucket (a correct password resets IP+account). */
  clear(rule: ClientAreaRateLimitRule, discriminator: string): void {
    this.buckets.delete(this.key(rule, discriminator));
  }

  /** Test helper: forget every counter. */
  reset(): void {
    this.buckets.clear();
  }

  /** Returns how long to wait (ms) when this attempt exceeds the rule, else 0. */
  private spend(rule: ClientAreaRateLimitRule, discriminator: string) {
    const now = Date.now();
    const { limit, windowMs } = CLIENT_AREA_RATE_LIMIT_RULES[rule];
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

  private key(rule: ClientAreaRateLimitRule, discriminator: string) {
    return createHash('sha256')
      .update(`${rule}:${discriminator}`)
      .digest('hex');
  }

  private pruneIfLarge(now: number) {
    if (this.buckets.size <= 10_000) return;
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetsAt <= now) this.buckets.delete(key);
    }
  }
}

/**
 * The client IP as seen by our reverse proxy. nginx overwrites `X-Real-IP`
 * with `$remote_addr` and the API listens on loopback only, so that header
 * is trustworthy; the first `X-Forwarded-For` entry is client-supplied
 * (`$proxy_add_x_forwarded_for` appends) and would let anyone mint a fresh
 * bucket per request, so it is deliberately ignored here.
 */
export function clientAreaRateLimitIp(req: Request): string {
  const realIp = req.headers['x-real-ip'];
  const value = (Array.isArray(realIp) ? realIp[0] : realIp)?.trim();

  return (value || req.socket?.remoteAddress || 'unknown').replace(
    /^::ffff:/,
    '',
  );
}
