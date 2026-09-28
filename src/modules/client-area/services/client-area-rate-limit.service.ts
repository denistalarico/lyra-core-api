import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';
import type { Request } from 'express';
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
  login_ip: { limit: 30, windowMs: 15 * MINUTE },
  login_account: { limit: 10, windowMs: 15 * MINUTE },
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
    let exceeded = false;

    for (const [rule, discriminator] of Object.entries(checks) as Array<
      [ClientAreaRateLimitRule, string | undefined]
    >) {
      if (discriminator === undefined) continue;
      exceeded = this.spend(rule, discriminator) || exceeded;
    }

    if (exceeded) {
      throw new HttpException(
        {
          statusCode: HttpStatus.TOO_MANY_REQUESTS,
          error: 'Too Many Requests',
          message: 'Too many attempts. Wait a few minutes and try again.',
          code: CLIENT_AREA_ERROR_CODES.rateLimited,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
  }

  /** Test helper: forget every counter. */
  reset(): void {
    this.buckets.clear();
  }

  private spend(rule: ClientAreaRateLimitRule, discriminator: string) {
    const now = Date.now();
    const { limit, windowMs } = CLIENT_AREA_RATE_LIMIT_RULES[rule];
    const key = createHash('sha256')
      .update(`${rule}:${discriminator}`)
      .digest('hex');
    const current = this.buckets.get(key);

    if (!current || current.resetsAt <= now) {
      this.buckets.set(key, { count: 1, resetsAt: now + windowMs });
      this.pruneIfLarge(now);
      return false;
    }

    current.count += 1;
    return current.count > limit;
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
