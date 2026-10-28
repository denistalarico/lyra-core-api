import {
  AuthRateLimitService,
  TooManyAuthAttemptsException,
} from './auth-rate-limit.service';

const RULES = { per_ip: { limit: 5, windowMs: 15 * 60 * 1000 } };

function thrown(fn: () => void): unknown {
  try {
    fn();
  } catch (error: unknown) {
    return error;
  }
  return undefined;
}

describe('SEC-02 AuthRateLimitService', () => {
  it('answers the attempt over the limit with 429 and a Retry-After', () => {
    const limiter = new AuthRateLimitService();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consume(RULES, { per_ip: 'a' });
    }

    const error = thrown(() => limiter.consume(RULES, { per_ip: 'a' }));
    expect(error).toBeInstanceOf(TooManyAuthAttemptsException);
    expect((error as TooManyAuthAttemptsException).getStatus()).toBe(429);
    expect(
      (error as TooManyAuthAttemptsException).retryAfterSeconds,
    ).toBeGreaterThan(14 * 60);
    expect(() => limiter.consume(RULES, { per_ip: 'b' })).not.toThrow();
  });

  it('clear forgets one bucket', () => {
    const limiter = new AuthRateLimitService();
    for (let attempt = 0; attempt < 5; attempt += 1) {
      limiter.consume(RULES, { per_ip: 'a' });
    }
    limiter.clear('per_ip', 'a');
    expect(() => limiter.consume(RULES, { per_ip: 'a' })).not.toThrow();
  });

  it('locks an email with no persisted identity exactly like a known one', () => {
    const limiter = new AuthRateLimitService();
    const now = Date.now();
    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.noteAccountOutcome(' Ghost@X.com ', true, now);
    }

    const error = thrown(() =>
      limiter.assertAccountUnlocked('ghost@x.com', null, now + 1000),
    );
    expect(error).toBeInstanceOf(TooManyAuthAttemptsException);
    expect((error as TooManyAuthAttemptsException).retryAfterSeconds).toBe(
      15 * 60 - 1,
    );
  });

  it('honours a persisted lock even with empty memory (after a restart)', () => {
    const limiter = new AuthRateLimitService();
    const now = Date.now();
    const error = thrown(() =>
      limiter.assertAccountUnlocked('ana@x.com', now + 60_000, now),
    );
    expect((error as TooManyAuthAttemptsException).retryAfterSeconds).toBe(60);
    expect(() =>
      limiter.assertAccountUnlocked('ana@x.com', null, now),
    ).not.toThrow();
  });
});
