import {
  addLocalDays,
  localDayBounds,
  nextDailyOccurrence,
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
