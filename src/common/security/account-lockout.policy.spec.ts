import {
  ACCOUNT_LOCKOUT_POLICY,
  accountLockedUntil,
  type AuthAttemptOutcome,
} from './account-lockout.policy';

const MINUTE = 60 * 1000;
const T0 = Date.UTC(2026, 9, 28, 12);

const failures = (count: number, from: number, stepMs = 1000) =>
  Array.from({ length: count }, (_, index) => ({
    failed: true,
    at: from + index * stepMs,
  }));

describe('SEC-02 account lockout policy', () => {
  it('locks for 15 minutes on the 10th failure inside 15 minutes', () => {
    const nine = failures(9, T0);
    expect(accountLockedUntil(nine, T0 + MINUTE)).toBeNull();

    const ten = failures(10, T0);
    const tenth = ten[9].at;
    expect(accountLockedUntil(ten, tenth + 1)).toBe(
      tenth + ACCOUNT_LOCKOUT_POLICY.lockMs,
    );
    expect(accountLockedUntil(ten, tenth + 15 * MINUTE)).toBeNull();
  });

  it('does not count failures spread beyond the window', () => {
    expect(
      accountLockedUntil(failures(10, T0, 2 * MINUTE), T0 + 20 * MINUTE),
    ).toBeNull();
  });

  it('restarts the count after a completed login', () => {
    const outcomes: AuthAttemptOutcome[] = [
      ...failures(9, T0),
      { failed: false, at: T0 + 10_000 },
      ...failures(9, T0 + 11_000),
    ];
    expect(accountLockedUntil(outcomes, T0 + 30_000)).toBeNull();
  });

  it('locks for 60 minutes when a new lock starts within 24 hours', () => {
    const first = failures(10, T0);
    const second = failures(10, T0 + 2 * 60 * MINUTE);
    const lastAt = second[9].at;

    expect(accountLockedUntil([...first, ...second], lastAt + 1)).toBe(
      lastAt + ACCOUNT_LOCKOUT_POLICY.repeatLockMs,
    );

    const nextDay = failures(10, T0 + 25 * 60 * MINUTE);
    expect(accountLockedUntil([...first, ...nextDay], nextDay[9].at + 1)).toBe(
      nextDay[9].at + ACCOUNT_LOCKOUT_POLICY.lockMs,
    );
  });

  it('ignores outcomes recorded during a lock and is order-independent', () => {
    const ten = failures(10, T0);
    const duringLock = failures(10, ten[9].at + MINUTE);
    const outcomes = [...duringLock, ...ten].reverse();

    expect(accountLockedUntil(outcomes, ten[9].at + 2 * MINUTE)).toBe(
      ten[9].at + ACCOUNT_LOCKOUT_POLICY.lockMs,
    );
  });
});
