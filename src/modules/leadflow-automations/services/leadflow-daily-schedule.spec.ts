import {
  addLocalDays,
  localDayBounds,
  localWeekday,
  nextDailyOccurrence,
  nextScheduledOccurrence,
  previousScheduledOccurrence,
  readSummarySchedule,
} from './leadflow-daily-schedule';

describe('LeadFlow daily schedule', () => {
  it('resolves the configured wall clock in the workspace timezone', () => {
    const occurrence = nextDailyOccurrence(
      new Date('2026-07-28T10:00:00.000Z'),
      '08:00',
      'America/Sao_Paulo',
    );

    expect(occurrence).toEqual({
      localDate: '2026-07-28',
      fireAt: new Date('2026-07-28T11:00:00.000Z'),
    });
  });

  it('moves to the next local day once todays time has passed', () => {
    const occurrence = nextDailyOccurrence(
      new Date('2026-07-28T12:00:00.000Z'),
      '08:00',
      'America/Sao_Paulo',
    );

    expect(occurrence.localDate).toBe('2026-07-29');
    expect(occurrence.fireAt.toISOString()).toBe('2026-07-29T11:00:00.000Z');
  });

  it('returns timezone-aware day bounds across a daylight-saving change', () => {
    const bounds = localDayBounds('2026-03-08', 'America/New_York');

    expect(bounds.start.toISOString()).toBe('2026-03-08T05:00:00.000Z');
    expect(bounds.end.toISOString()).toBe('2026-03-09T04:00:00.000Z');
  });

  it('adds local calendar days without depending on the process timezone', () => {
    expect(addLocalDays('2026-12-31', 1)).toBe('2027-01-01');
  });

  it('rejects invalid time and timezone configuration', () => {
    expect(() =>
      nextDailyOccurrence(new Date(), '25:00', 'America/Sao_Paulo'),
    ).toThrow('daily_time_invalid');
    expect(() =>
      nextDailyOccurrence(new Date(), '08:00', 'Not/A_Real_Zone'),
    ).toThrow('timezone_invalid');
  });
});

describe('LeadFlow summary cadence', () => {
  it('walks to the configured weekday', () => {
    // 2026-07-28 is a Tuesday.
    expect(localWeekday('2026-07-28')).toBe('tuesday');

    const occurrence = nextScheduledOccurrence(
      new Date('2026-07-28T12:00:00.000Z'),
      {
        frequency: 'weekly',
        weekday: 'monday',
        dailyTime: '08:00',
        timezone: 'America/Sao_Paulo',
      },
    );

    expect(occurrence.localDate).toBe('2026-08-03');
    expect(localWeekday(occurrence.localDate)).toBe('monday');
  });

  it('keeps today when the weekday matches and the hour has not passed', () => {
    const occurrence = nextScheduledOccurrence(
      new Date('2026-07-28T09:00:00.000Z'),
      {
        frequency: 'weekly',
        weekday: 'tuesday',
        dailyTime: '08:00',
        timezone: 'America/Sao_Paulo',
      },
    );

    expect(occurrence.localDate).toBe('2026-07-28');
  });

  it('clamps a monthly day the month does not have', () => {
    const occurrence = nextScheduledOccurrence(
      new Date('2027-02-01T12:00:00.000Z'),
      {
        frequency: 'monthly',
        dayOfMonth: 31,
        dailyTime: '08:00',
        timezone: 'UTC',
      },
    );

    // February 2027 ends on the 28th; the summary is not skipped.
    expect(occurrence.localDate).toBe('2027-02-28');
  });

  it('rolls a monthly occurrence into the next month once it has passed', () => {
    const occurrence = nextScheduledOccurrence(
      new Date('2026-12-05T12:00:00.000Z'),
      {
        frequency: 'monthly',
        dayOfMonth: 5,
        dailyTime: '08:00',
        timezone: 'UTC',
      },
    );

    expect(occurrence.localDate).toBe('2027-01-05');
  });

  it('reports the window that just closed, per cadence', () => {
    const weekly = previousScheduledOccurrence(
      { localDate: '2026-08-10', fireAt: new Date('2026-08-10T11:00:00.000Z') },
      {
        frequency: 'weekly',
        weekday: 'monday',
        dailyTime: '08:00',
        timezone: 'America/Sao_Paulo',
      },
    );
    expect(weekly.localDate).toBe('2026-08-03');
    expect(weekly.fireAt.toISOString()).toBe('2026-08-03T11:00:00.000Z');

    const daily = previousScheduledOccurrence(
      { localDate: '2026-08-10', fireAt: new Date('2026-08-10T11:00:00.000Z') },
      { frequency: 'daily', dailyTime: '08:00', timezone: 'America/Sao_Paulo' },
    );
    expect(daily.localDate).toBe('2026-08-09');

    // The occurrence was clamped to February 28; the window still opens on the
    // configured day of the previous month.
    const monthly = previousScheduledOccurrence(
      { localDate: '2027-02-28', fireAt: new Date('2027-02-28T08:00:00.000Z') },
      {
        frequency: 'monthly',
        dayOfMonth: 31,
        dailyTime: '08:00',
        timezone: 'UTC',
      },
    );
    expect(monthly.localDate).toBe('2027-01-31');
  });

  it('refuses a cadence whose own field is missing', () => {
    expect(() =>
      nextScheduledOccurrence(new Date(), {
        frequency: 'weekly',
        dailyTime: '08:00',
        timezone: 'UTC',
      }),
    ).toThrow('summary_weekday_invalid');
    expect(() =>
      nextScheduledOccurrence(new Date(), {
        frequency: 'monthly',
        dailyTime: '08:00',
        timezone: 'UTC',
      }),
    ).toThrow('summary_day_of_month_invalid');
  });

  it('reads a stored policy and defaults a pre-cadence instance to daily', () => {
    expect(readSummarySchedule({ dailyTime: '08:00' })).toEqual({
      frequency: 'daily',
      dailyTime: '08:00',
      timezone: 'UTC',
      weekday: null,
      dayOfMonth: null,
    });
    expect(readSummarySchedule({})).toBeNull();
    expect(
      readSummarySchedule({ dailyTime: '08:00', frequency: 'yearly' }),
    ).toBeNull();
  });
});
