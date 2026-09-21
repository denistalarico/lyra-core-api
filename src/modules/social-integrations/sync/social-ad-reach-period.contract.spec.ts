import {
  SOCIAL_AD_REACH_PRESETS,
  isPartialReachWindow,
  resolveReachPreset,
  resolveReachPresets,
} from './social-ad-reach-period.contract';

describe('resolveReachPreset', () => {
  it('resolves the rolling windows inclusive of the account today', () => {
    // "Últimos 7 dias" on a page opened today means D-6 through D0, which is
    // seven days counting today — not D-7 through D-1. Getting this off by one
    // would make the measured range disagree with the range the dashboard's
    // own aggregates cover, and the two numbers would be labelled the same.
    expect(resolveReachPreset('last_7', '2026-09-20')).toEqual({
      since: '2026-09-14',
      until: '2026-09-20',
    });
    expect(resolveReachPreset('last_30', '2026-09-20')).toEqual({
      since: '2026-08-22',
      until: '2026-09-20',
    });
    expect(resolveReachPreset('last_90', '2026-09-20')).toEqual({
      since: '2026-06-23',
      until: '2026-09-20',
    });
  });

  it('resolves today as a single day', () => {
    expect(resolveReachPreset('today', '2026-09-20')).toEqual({
      since: '2026-09-20',
      until: '2026-09-20',
    });
  });

  it('resolves the current month from its first day to today', () => {
    expect(resolveReachPreset('month_current', '2026-09-20')).toEqual({
      since: '2026-09-01',
      until: '2026-09-20',
    });
  });

  it('resolves the previous month as its own whole calendar month', () => {
    expect(resolveReachPreset('month_previous', '2026-09-20')).toEqual({
      since: '2026-08-01',
      until: '2026-08-31',
    });
  });

  it('takes the previous month from the calendar rather than from 30 days', () => {
    // March 1st is the case a naive "minus one month" gets wrong: February has
    // 28 or 29 days, and subtracting a fixed 30 lands in January.
    expect(resolveReachPreset('month_previous', '2026-03-01')).toEqual({
      since: '2026-02-01',
      until: '2026-02-28',
    });

    // 2028 is a leap year, and the last day of February comes from the calendar.
    expect(resolveReachPreset('month_previous', '2028-03-15')).toEqual({
      since: '2028-02-01',
      until: '2028-02-29',
    });
  });

  it('crosses a year boundary on the first of January', () => {
    expect(resolveReachPreset('month_previous', '2027-01-04')).toEqual({
      since: '2026-12-01',
      until: '2026-12-31',
    });
    expect(resolveReachPreset('month_current', '2027-01-01')).toEqual({
      since: '2027-01-01',
      until: '2027-01-01',
    });
  });

  it('never returns a range that runs backwards', () => {
    // The schema's CHECK enforces this too; here it is asserted for every preset
    // on the day that most nearly violates it, the first of a month.
    for (const preset of SOCIAL_AD_REACH_PRESETS) {
      const window = resolveReachPreset(preset, '2026-09-01');

      expect(window.since <= window.until).toBe(true);
    }
  });
});

describe('resolveReachPresets', () => {
  it('returns every preset exactly once, labelled', () => {
    const windows = resolveReachPresets('2026-09-20');

    expect(windows.map((window) => window.preset)).toEqual([
      ...SOCIAL_AD_REACH_PRESETS,
    ]);
  });

  it('is six windows, which is the whole daily provider cost per account', () => {
    // The number in §6 of the plan: if the Graph quota ever needs relief, these
    // are the first requests to give up, and the count is what that decision is
    // made against.
    expect(resolveReachPresets('2026-09-20')).toHaveLength(6);
  });
});

describe('isPartialReachWindow', () => {
  it('marks a range ending on the account today as partial', () => {
    expect(
      isPartialReachWindow(
        { since: '2026-09-14', until: '2026-09-20' },
        '2026-09-20',
      ),
    ).toBe(true);
  });

  it('marks a range entirely in the past as final', () => {
    // The property the whole cache rests on: a closed range's audience does not
    // change, so this row is measured once and never again. Meta restates spend
    // for 28 days, but a late-attributed conversion lands on a day whose reach
    // was already counted.
    expect(
      isPartialReachWindow(
        { since: '2026-08-01', until: '2026-08-31' },
        '2026-09-20',
      ),
    ).toBe(false);
  });

  it('marks a range ending in the future as partial', () => {
    // Defensive rather than expected. A range past today cannot be final, and
    // treating it as such would store a number that never gets corrected.
    expect(
      isPartialReachWindow(
        { since: '2026-09-20', until: '2026-09-30' },
        '2026-09-20',
      ),
    ).toBe(true);
  });

  it('judges partiality against the account day it was given, not the clock', () => {
    // The same range is final for an account whose day has moved on and partial
    // for one whose has not — which is why `today` is a parameter. An account in
    // Auckland has finished a day that is still under way in São Paulo.
    const window = { since: '2026-09-14', until: '2026-09-20' };

    expect(isPartialReachWindow(window, '2026-09-21')).toBe(false);
    expect(isPartialReachWindow(window, '2026-09-20')).toBe(true);
  });
});
