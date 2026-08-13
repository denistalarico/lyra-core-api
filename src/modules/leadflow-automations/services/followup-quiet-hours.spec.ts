import { resolveFollowupSendAt } from './followup-quiet-hours';

const TZ = 'America/Sao_Paulo';

/** Wall clock in São Paulo (UTC-3, no DST since 2019) as an instant. */
function local(iso: string): Date {
  return new Date(`${iso}-03:00`);
}

describe('resolveFollowupSendAt', () => {
  const now = local('2026-08-10T09:00');

  it('leaves an attempt due inside the window alone', () => {
    const dueAt = local('2026-08-11T14:30');
    expect(
      resolveFollowupSendAt({
        dueAt,
        now,
        timeZone: TZ,
        respectQuietHours: true,
        allowAnticipation: true,
      }).toISOString(),
    ).toBe(dueAt.toISOString());
  });

  it('ignores the envelope entirely when the toggle is off', () => {
    const dueAt = local('2026-08-11T03:00');
    expect(
      resolveFollowupSendAt({
        dueAt,
        now,
        timeZone: TZ,
        respectQuietHours: false,
        allowAnticipation: true,
      }).toISOString(),
    ).toBe(dueAt.toISOString());
  });

  it('anticipates a late-evening attempt to the same day at 20h', () => {
    expect(
      resolveFollowupSendAt({
        dueAt: local('2026-08-11T21:40'),
        now,
        timeZone: TZ,
        respectQuietHours: true,
        allowAnticipation: true,
      }).toISOString(),
    ).toBe(local('2026-08-11T20:00').toISOString());
  });

  it('anticipates a dawn attempt to 20h of the evening before', () => {
    // The D+1 case that matters: a lead last written to at 05:00 is due at
    // 03:00 the next day. Waiting for 07:00 would put the send 26h after the
    // conversation, with the window already closed.
    expect(
      resolveFollowupSendAt({
        dueAt: local('2026-08-12T03:00'),
        now,
        timeZone: TZ,
        respectQuietHours: true,
        allowAnticipation: true,
      }).toISOString(),
    ).toBe(local('2026-08-11T20:00').toISOString());
  });

  it('postpones instead of anticipating when there is no window to protect', () => {
    expect(
      resolveFollowupSendAt({
        dueAt: local('2026-08-12T03:00'),
        now,
        timeZone: TZ,
        respectQuietHours: true,
        allowAnticipation: false,
      }).toISOString(),
    ).toBe(local('2026-08-12T07:00').toISOString());
  });

  it('postpones a late-evening template attempt to the next morning', () => {
    expect(
      resolveFollowupSendAt({
        dueAt: local('2026-08-11T22:10'),
        now,
        timeZone: TZ,
        respectQuietHours: true,
        allowAnticipation: false,
      }).toISOString(),
    ).toBe(local('2026-08-12T07:00').toISOString());
  });

  it('falls back to the next morning when anticipation would land in the past', () => {
    // A timer that fires at 23:30 for an attempt due at 23:00: 20:00 is gone,
    // and sending now would reach the lead at half past eleven at night.
    const lateNow = local('2026-08-11T23:30');
    expect(
      resolveFollowupSendAt({
        dueAt: local('2026-08-11T23:00'),
        now: lateNow,
        timeZone: TZ,
        respectQuietHours: true,
        allowAnticipation: true,
      }).toISOString(),
    ).toBe(local('2026-08-12T07:00').toISOString());
  });

  it('never returns an instant in the past', () => {
    const dueAt = local('2026-08-09T15:00');
    expect(
      resolveFollowupSendAt({
        dueAt,
        now,
        timeZone: TZ,
        respectQuietHours: true,
        allowAnticipation: true,
      }).getTime(),
    ).toBe(now.getTime());
  });

  it('reads the envelope in the configured zone, not the server one', () => {
    // 23:00 in Lisbon is 19:00 in São Paulo: inside the envelope for one and
    // outside for the other, from the very same instant.
    const dueAt = new Date('2026-08-11T22:00:00.000Z');
    expect(
      resolveFollowupSendAt({
        dueAt,
        now,
        timeZone: TZ,
        respectQuietHours: true,
        allowAnticipation: true,
      }).toISOString(),
    ).toBe(dueAt.toISOString());
    expect(
      resolveFollowupSendAt({
        dueAt,
        now,
        timeZone: 'Europe/Lisbon',
        respectQuietHours: true,
        allowAnticipation: true,
      }).toISOString(),
    ).toBe(new Date('2026-08-11T19:00:00.000Z').toISOString());
  });

  it('falls back to UTC when the configured zone is not a real one', () => {
    const dueAt = new Date('2026-08-11T12:00:00.000Z');
    expect(
      resolveFollowupSendAt({
        dueAt,
        now,
        timeZone: 'Mars/Olympus',
        respectQuietHours: true,
        allowAnticipation: true,
      }).toISOString(),
    ).toBe(dueAt.toISOString());
  });
});
