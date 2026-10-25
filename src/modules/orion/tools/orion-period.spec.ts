import { resolveOrionDay, resolveOrionPeriod, zonedTime } from './orion-period';

const ZONE = 'America/Sao_Paulo';
// 2026-10-25 02:30 in São Paulo (UTC-3) = 05:30Z.
const now = new Date('2026-10-25T05:30:00.000Z');

describe('Orion periods', () => {
  it('computes calendar periods in the tenant zone', () => {
    expect(resolveOrionPeriod('today', ZONE, now)).toEqual({
      from: new Date('2026-10-25T03:00:00.000Z'),
      to: now,
    });
    expect(resolveOrionPeriod('yesterday', ZONE, now)).toEqual({
      from: new Date('2026-10-24T03:00:00.000Z'),
      to: new Date('2026-10-25T03:00:00.000Z'),
    });
    expect(resolveOrionPeriod('last_7_days', ZONE, now).from).toEqual(
      new Date('2026-10-19T03:00:00.000Z'),
    );
    expect(resolveOrionPeriod('this_month', ZONE, now).from).toEqual(
      new Date('2026-10-01T03:00:00.000Z'),
    );
    expect(resolveOrionPeriod('last_month', ZONE, now)).toEqual({
      from: new Date('2026-09-01T03:00:00.000Z'),
      to: new Date('2026-10-01T03:00:00.000Z'),
    });
  });

  it('uses the zone date, not the UTC date, near midnight', () => {
    // 01:00Z on the 1st is still the 31st in São Paulo.
    const late = new Date('2026-11-01T01:00:00.000Z');
    expect(resolveOrionPeriod('this_month', ZONE, late).from).toEqual(
      new Date('2026-10-01T03:00:00.000Z'),
    );
    expect(resolveOrionDay('tomorrow', ZONE, late)).toEqual({
      from: new Date('2026-11-01T03:00:00.000Z'),
      to: new Date('2026-11-02T03:00:00.000Z'),
    });
    expect(zonedTime(late, ZONE)).toBe('22:00');
  });
});
