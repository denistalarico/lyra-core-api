import {
  calendarDayIn,
  enumerateCalendarDays,
  localDayStartEpochSeconds,
  postDiscoveryWindow,
} from './social-organic-analytics-time';

describe('organic analytics calendar boundaries', () => {
  it('buckets the same instant by the asset IANA timezone', () => {
    const instant = new Date('2026-09-08T02:30:00.000Z');
    expect(calendarDayIn('America/Sao_Paulo', instant)).toBe('2026-09-07');
    expect(calendarDayIn('Asia/Tokyo', instant)).toBe('2026-09-08');
  });

  it('turns local midnight into the correct provider instant across DST', () => {
    expect(
      new Date(
        localDayStartEpochSeconds('2026-07-01', 'America/New_York') * 1000,
      ).toISOString(),
    ).toBe('2026-07-01T04:00:00.000Z');
    expect(
      new Date(
        localDayStartEpochSeconds('2026-12-01', 'America/New_York') * 1000,
      ).toISOString(),
    ).toBe('2026-12-01T05:00:00.000Z');
  });

  it('rejects invalid or reversed persisted windows', () => {
    expect(() => enumerateCalendarDays('2026-02-30', '2026-03-01')).toThrow(
      'invalid_sync_window',
    );
    expect(() => enumerateCalendarDays('2026-09-09', '2026-09-08')).toThrow(
      'invalid_sync_window',
    );
  });
});

describe('postDiscoveryWindow', () => {
  it("widens a window that reaches today to the last 30 days' posts", () => {
    // The daily run's two days used to be the whole discovery range, so a
    // post's counters froze at their second-day value.
    expect(
      postDiscoveryWindow({
        fromDate: '2026-09-26',
        toDate: '2026-09-27',
        currentDay: '2026-09-27',
      }),
    ).toEqual({ fromDate: '2026-08-29', toDate: '2026-09-27' });
  });

  it('keeps the start of a window already wider than the refresh range', () => {
    expect(
      postDiscoveryWindow({
        fromDate: '2026-06-01',
        toDate: '2026-09-27',
        currentDay: '2026-09-27',
      }),
    ).toEqual({ fromDate: '2026-06-01', toDate: '2026-09-27' });
  });
});
