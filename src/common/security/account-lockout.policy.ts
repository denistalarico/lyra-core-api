const MINUTE = 60 * 1000;

/**
 * SEC-02 — progressive lock of one account (identity), whatever the origin.
 *
 * {@link ACCOUNT_LOCKOUT_POLICY.failureLimit} failures inside
 * {@link ACCOUNT_LOCKOUT_POLICY.windowMs} lock the account for `lockMs`; a new
 * lock starting within `repeatWindowMs` of the previous one lasts
 * `repeatLockMs`. A completed login restarts the failure count (not the
 * repeat history).
 */
export const ACCOUNT_LOCKOUT_POLICY = {
  failureLimit: 10,
  windowMs: 15 * MINUTE,
  lockMs: 15 * MINUTE,
  repeatLockMs: 60 * MINUTE,
  repeatWindowMs: 24 * 60 * MINUTE,
} as const;

/** How far back outcomes must reach for {@link accountLockedUntil} to be exact. */
export const ACCOUNT_LOCKOUT_LOOKBACK_MS =
  ACCOUNT_LOCKOUT_POLICY.repeatWindowMs +
  ACCOUNT_LOCKOUT_POLICY.repeatLockMs +
  ACCOUNT_LOCKOUT_POLICY.windowMs;

export type AuthAttemptOutcome = { failed: boolean; at: number };

/**
 * Replays the recorded outcomes of one account and returns when its current
 * lock ends (epoch ms), or null when it is not locked. Pure, so the lock can
 * be rebuilt from persisted `login_failed`/`login_success` events after a
 * restart. Outcomes that land inside a lock are ignored: the caller refuses
 * those attempts before checking the password.
 */
export function accountLockedUntil(
  outcomes: readonly AuthAttemptOutcome[],
  now: number,
): number | null {
  const policy = ACCOUNT_LOCKOUT_POLICY;
  let failures: number[] = [];
  let lockStartedAt: number | null = null;
  let lockedUntil: number | null = null;

  for (const { failed, at } of [...outcomes].sort((a, b) => a.at - b.at)) {
    if (lockedUntil !== null && at < lockedUntil) continue;

    if (!failed) {
      failures = [];
      continue;
    }

    failures = failures.filter((time) => time > at - policy.windowMs);
    failures.push(at);

    if (failures.length >= policy.failureLimit) {
      const isRepeat =
        lockStartedAt !== null && at - lockStartedAt < policy.repeatWindowMs;
      lockStartedAt = at;
      lockedUntil = at + (isRepeat ? policy.repeatLockMs : policy.lockMs);
      failures = [];
    }
  }

  return lockedUntil !== null && lockedUntil > now ? lockedUntil : null;
}
