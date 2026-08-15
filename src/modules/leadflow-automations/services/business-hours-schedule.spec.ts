import {
  normalizeBusinessHoursSchedule,
  resolveClosedWindowStart,
} from './business-hours-schedule';

const WEEK = {
  enabled: true,
  timezone: 'America/Sao_Paulo',
  days: [
    { day: 'monday', enabled: true, start: '08:00', end: '18:00' },
    { day: 'tuesday', enabled: true, start: '08:00', end: '18:00' },
    { day: 'wednesday', enabled: true, start: '08:00', end: '18:00' },
    { day: 'thursday', enabled: true, start: '08:00', end: '18:00' },
    { day: 'friday', enabled: true, start: '08:00', end: '18:00' },
    { day: 'saturday', enabled: false, start: '', end: '' },
    { day: 'sunday', enabled: false, start: '', end: '' },
  ],
};

describe('normalizeBusinessHoursSchedule', () => {
  it('reads the shape the Inbox settings persist', () => {
    expect(normalizeBusinessHoursSchedule(WEEK)).toMatchObject({
      enabled: true,
      timezone: 'America/Sao_Paulo',
    });
    expect(normalizeBusinessHoursSchedule(WEEK)?.days).toHaveLength(7);
  });

  it('drops a day it cannot act on instead of the whole schedule', () => {
    const schedule = normalizeBusinessHoursSchedule({
      timezone: 'UTC',
      days: [
        { day: 'monday', enabled: true, start: '08:00', end: '18:00' },
        { day: 'segunda', enabled: true, start: '08:00', end: '18:00' },
        // Open, but never says when: unusable.
        { day: 'tuesday', enabled: true, start: '', end: '' },
      ],
    });

    expect(schedule?.days.map((day) => day.day)).toEqual(['monday']);
  });

  it('reports a schedule with nothing usable as absent', () => {
    // "Always closed" is never a guess worth making: it would answer every lead
    // with the out-of-hours message.
    expect(normalizeBusinessHoursSchedule(null)).toBeNull();
    expect(normalizeBusinessHoursSchedule({ timezone: 'UTC' })).toBeNull();
    expect(normalizeBusinessHoursSchedule({ days: [] })).toBeNull();
  });
});

describe('resolveClosedWindowStart', () => {
  const schedule = normalizeBusinessHoursSchedule(WEEK)!;

  it('points at the close that opened the current stretch', () => {
    // Wednesday 23:00 in São Paulo (UTC-3) → the stretch began at 18:00 that day.
    const start = resolveClosedWindowStart(
      schedule,
      new Date('2026-08-12T23:00:00-03:00'),
    );

    expect(start?.toISOString()).toBe('2026-08-12T21:00:00.000Z');
  });

  it('keeps both sides of midnight in the same stretch', () => {
    const beforeMidnight = resolveClosedWindowStart(
      schedule,
      new Date('2026-08-12T23:50:00-03:00'),
    );
    const afterMidnight = resolveClosedWindowStart(
      schedule,
      new Date('2026-08-13T00:10:00-03:00'),
    );

    expect(afterMidnight?.toISOString()).toBe(beforeMidnight?.toISOString());
  });

  it('walks back over the days the business is closed', () => {
    // Sunday afternoon: the last time the doors shut was Friday at 18:00.
    const start = resolveClosedWindowStart(
      schedule,
      new Date('2026-08-16T14:00:00-03:00'),
    );

    expect(start?.toISOString()).toBe('2026-08-14T21:00:00.000Z');
  });

  it('has no stretch to point at when the business never opens', () => {
    const closed = normalizeBusinessHoursSchedule({
      timezone: 'UTC',
      days: [{ day: 'monday', enabled: false, start: '', end: '' }],
    })!;

    expect(resolveClosedWindowStart(closed, new Date())).toBeNull();
  });
});
