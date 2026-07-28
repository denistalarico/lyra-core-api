import { HttpException, HttpStatus, Injectable } from '@nestjs/common';
import { createHash } from 'crypto';

type RateLimitBucket = {
  count: number;
  resetsAt: number;
};

export type AdminAuthRateLimitAction =
  | 'login'
  | 'two_factor_verify'
  | 'two_factor_email'
  | 'refresh'
  | 'activation_validate'
  | 'activation_complete'
  | 'password_forgot'
  | 'password_reset'
  | 'two_factor_recovery_request'
  | 'two_factor_recovery_complete';

const RULES: Record<
  AdminAuthRateLimitAction,
  { limit: number; windowMs: number }
> = {
  login: { limit: 10, windowMs: 15 * 60 * 1000 },
  two_factor_verify: { limit: 10, windowMs: 5 * 60 * 1000 },
  two_factor_email: { limit: 5, windowMs: 5 * 60 * 1000 },
  refresh: { limit: 30, windowMs: 60 * 1000 },
  activation_validate: { limit: 20, windowMs: 15 * 60 * 1000 },
  activation_complete: { limit: 8, windowMs: 15 * 60 * 1000 },
  password_forgot: { limit: 5, windowMs: 15 * 60 * 1000 },
  password_reset: { limit: 8, windowMs: 15 * 60 * 1000 },
  two_factor_recovery_request: { limit: 5, windowMs: 15 * 60 * 1000 },
  two_factor_recovery_complete: { limit: 6, windowMs: 15 * 60 * 1000 },
};

@Injectable()
export class AdminAuthRateLimitService {
  private readonly buckets = new Map<string, RateLimitBucket>();

  assertAllowed(action: AdminAuthRateLimitAction, discriminator: string): void {
    const now = Date.now();
    const rule = RULES[action];
    const opaqueKey = createHash('sha256')
      .update(`${action}:${discriminator}`)
      .digest('hex');
    const current = this.buckets.get(opaqueKey);

    if (!current || current.resetsAt <= now) {
      this.buckets.set(opaqueKey, {
        count: 1,
        resetsAt: now + rule.windowMs,
      });
      return;
    }

    current.count += 1;
    if (current.count > rule.limit) {
      throw new HttpException(
        'Too many administrative authentication attempts.',
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    if (this.buckets.size > 10_000) {
      this.prune(now);
    }
  }

  private prune(now: number): void {
    for (const [key, bucket] of this.buckets) {
      if (bucket.resetsAt <= now) {
        this.buckets.delete(key);
      }
    }
  }
}
