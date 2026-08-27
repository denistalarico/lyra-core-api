import { BadRequestException } from '@nestjs/common';
import {
  MAX_INSIGHTS_WINDOW_DAYS,
  assertClosedInsightsWindow,
  assertIntradayInsightsWindow,
  parseInsightsWindow,
} from './insights-window';
import {
  SocialAdInsightsWindowNotClosedError,
  SocialAdInsightsWindowNotIntradayError,
} from './social-ad-insights.error';

describe('parseInsightsWindow', () => {
  it('counts the window inclusively', () => {
    expect(
      parseInsightsWindow({ since: '2026-08-25', until: '2026-08-25' }),
    ).toEqual({
      since: '2026-08-25',
      until: '2026-08-25',
      days: 1,
    });

    expect(
      parseInsightsWindow({ since: '2026-06-01', until: '2026-08-25' }),
    ).toEqual({
      since: '2026-06-01',
      until: '2026-08-25',
      days: 86,
    });
  });

  it('returns the dates unchanged, never re-expressed', () => {
    const window = parseInsightsWindow({
      since: '2026-01-01',
      until: '2026-01-02',
    });

    // These are calendar days in the ad account's timezone. Parsing them into
    // instants and formatting them back is how a whole window shifts by a day.
    expect(window.since).toBe('2026-01-01');
    expect(window.until).toBe('2026-01-02');
  });

  it('accepts exactly the maximum span and refuses one day more', () => {
    expect(
      parseInsightsWindow({ since: '2026-06-01', until: '2026-08-29' }).days,
    ).toBe(MAX_INSIGHTS_WINDOW_DAYS);

    expect(() =>
      parseInsightsWindow({ since: '2026-06-01', until: '2026-08-30' }),
    ).toThrow(BadRequestException);
  });

  it('refuses a reversed window', () => {
    expect(() =>
      parseInsightsWindow({ since: '2026-08-25', until: '2026-08-24' }),
    ).toThrow(BadRequestException);
  });

  it('refuses a date that does not exist', () => {
    // `Date.UTC` accepts this and rolls it into March, which would silently
    // move the window.
    expect(() =>
      parseInsightsWindow({ since: '2026-02-30', until: '2026-03-01' }),
    ).toThrow(BadRequestException);
  });

  it('refuses anything that is not a bare calendar day', () => {
    for (const since of [
      '2026-08-25T00:00:00Z',
      '2026-8-25',
      '25/08/2026',
      '',
      null,
      20260825,
    ]) {
      // An instant carries a timezone, and the caller's timezone is not the one
      // that defines a Meta reporting day.
      expect(() => parseInsightsWindow({ since, until: '2026-08-26' })).toThrow(
        BadRequestException,
      );
    }
  });

  it('names the offending field', () => {
    expect(() =>
      parseInsightsWindow({ since: '2026-08-25', until: 'later' }),
    ).toThrow(/until/);
  });
});

describe('assertClosedInsightsWindow', () => {
  const window = (since: string, until: string) =>
    parseInsightsWindow({ since, until });

  it('accepts the latest settled day and refuses the account current one', () => {
    // 15:00 in São Paulo on the 26th.
    const now = new Date('2026-08-26T18:00:00Z');

    expect(() =>
      assertClosedInsightsWindow(
        window('2026-08-20', '2026-08-25'),
        'America/Sao_Paulo',
        now,
      ),
    ).not.toThrow();

    // The 26th is still accumulating: its numbers are real and incomplete, and
    // every row this slice writes claims `is_partial = false`.
    expect(() =>
      assertClosedInsightsWindow(
        window('2026-08-20', '2026-08-26'),
        'America/Sao_Paulo',
        now,
      ),
    ).toThrow(SocialAdInsightsWindowNotClosedError);
  });

  it('refuses a future day', () => {
    expect(() =>
      assertClosedInsightsWindow(
        window('2026-08-20', '2026-09-30'),
        'America/Sao_Paulo',
        new Date('2026-08-26T18:00:00Z'),
      ),
    ).toThrow(SocialAdInsightsWindowNotClosedError);
  });

  it('reports the boundary and the zone that decided it', () => {
    const failure = (() => {
      try {
        assertClosedInsightsWindow(
          window('2026-08-20', '2026-08-26'),
          'America/Sao_Paulo',
          new Date('2026-08-26T18:00:00Z'),
        );
        return null;
      } catch (error) {
        return error as SocialAdInsightsWindowNotClosedError;
      }
    })();

    // A caller in another zone cannot derive this from anything in the request.
    expect(failure?.maxUntil).toBe('2026-08-25');
    expect(failure?.timezone).toBe('America/Sao_Paulo');
  });

  describe('across the UTC boundary', () => {
    it('uses the account day, not UTC, west of Greenwich', () => {
      // 22:00 on the 25th in São Paulo; already the 26th in UTC.
      const now = new Date('2026-08-26T01:00:00Z');

      // UTC would call the 25th settled. The account has not finished it.
      expect(() =>
        assertClosedInsightsWindow(
          window('2026-08-20', '2026-08-25'),
          'America/Sao_Paulo',
          now,
        ),
      ).toThrow(SocialAdInsightsWindowNotClosedError);

      expect(() =>
        assertClosedInsightsWindow(
          window('2026-08-20', '2026-08-24'),
          'America/Sao_Paulo',
          now,
        ),
      ).not.toThrow();
    });

    it('uses the account day, not UTC, east of Greenwich', () => {
      // 05:00 on the 26th in Tokyo; still the 25th in UTC.
      const now = new Date('2026-08-25T20:00:00Z');

      // UTC would refuse the 25th. Tokyo finished it five hours ago.
      expect(() =>
        assertClosedInsightsWindow(
          window('2026-08-20', '2026-08-25'),
          'Asia/Tokyo',
          now,
        ),
      ).not.toThrow();
    });

    it('separates two accounts asking about the same day at the same instant', () => {
      // 23:30 on the 25th in São Paulo, 11:30 on the 26th in Auckland.
      const now = new Date('2026-08-26T02:30:00Z');
      const day = window('2026-08-24', '2026-08-25');

      expect(() =>
        assertClosedInsightsWindow(day, 'Pacific/Auckland', now),
      ).not.toThrow();

      expect(() =>
        assertClosedInsightsWindow(day, 'America/Sao_Paulo', now),
      ).toThrow(SocialAdInsightsWindowNotClosedError);
    });

    it('walks back across a month boundary', () => {
      const now = new Date('2026-09-01T12:00:00Z');

      expect(() =>
        assertClosedInsightsWindow(
          window('2026-08-25', '2026-08-31'),
          'America/Sao_Paulo',
          now,
        ),
      ).not.toThrow();

      expect(() =>
        assertClosedInsightsWindow(
          window('2026-08-25', '2026-09-01'),
          'America/Sao_Paulo',
          now,
        ),
      ).toThrow(SocialAdInsightsWindowNotClosedError);
    });
  });
});

describe('assertIntradayInsightsWindow', () => {
  const window = (since: string, until: string) =>
    parseInsightsWindow({ since, until });

  /** 15:00 in São Paulo, 06:00 the next day in Auckland. */
  const NOW = new Date('2026-08-26T18:00:00Z');

  it('accepts exactly the account current day', () => {
    expect(() =>
      assertIntradayInsightsWindow(
        window('2026-08-26', '2026-08-26'),
        'America/Sao_Paulo',
        NOW,
      ),
    ).not.toThrow();
  });

  it('refuses the day the daily run owns', () => {
    // D-1 is settled, and a settled day written with `is_partial = true` would
    // advertise a final number as provisional — and invite every later reader
    // to keep re-fetching it.
    expect(() =>
      assertIntradayInsightsWindow(
        window('2026-08-25', '2026-08-25'),
        'America/Sao_Paulo',
        NOW,
      ),
    ).toThrow(SocialAdInsightsWindowNotIntradayError);
  });

  it('refuses a day that has not started anywhere', () => {
    expect(() =>
      assertIntradayInsightsWindow(
        window('2026-08-27', '2026-08-27'),
        'America/Sao_Paulo',
        NOW,
      ),
    ).toThrow(SocialAdInsightsWindowNotIntradayError);
  });

  it('refuses a range that merely contains today', () => {
    // The dangerous shape: it would drag four settled days into a partial
    // write, and each of them would then be re-read forever by anything that
    // trusts the flag.
    expect(() =>
      assertIntradayInsightsWindow(
        window('2026-08-23', '2026-08-26'),
        'America/Sao_Paulo',
        NOW,
      ),
    ).toThrow(SocialAdInsightsWindowNotIntradayError);
  });

  it('reads today in the account timezone, not the server one', () => {
    // The same instant is the 26th in São Paulo and the 27th in Auckland. Each
    // account's own day is the only one that is intraday for it.
    expect(() =>
      assertIntradayInsightsWindow(
        window('2026-08-27', '2026-08-27'),
        'Pacific/Auckland',
        NOW,
      ),
    ).not.toThrow();

    expect(() =>
      assertIntradayInsightsWindow(
        window('2026-08-26', '2026-08-26'),
        'Pacific/Auckland',
        NOW,
      ),
    ).toThrow(SocialAdInsightsWindowNotIntradayError);
  });

  it('follows the account across its own midnight, not UTC midnight', () => {
    // 22:00 in São Paulo on the 26th — still the 27th in UTC, and still the
    // 26th for this account. A run keyed to UTC would ask for tomorrow.
    const beforeLocalMidnight = new Date('2026-08-27T01:00:00Z');

    expect(() =>
      assertIntradayInsightsWindow(
        window('2026-08-26', '2026-08-26'),
        'America/Sao_Paulo',
        beforeLocalMidnight,
      ),
    ).not.toThrow();

    // 00:30 in São Paulo on the 27th. The window that was valid ninety minutes
    // ago has expired, which is exactly what the worker re-checks for.
    const afterLocalMidnight = new Date('2026-08-27T03:30:00Z');

    expect(() =>
      assertIntradayInsightsWindow(
        window('2026-08-26', '2026-08-26'),
        'America/Sao_Paulo',
        afterLocalMidnight,
      ),
    ).toThrow(SocialAdInsightsWindowNotIntradayError);
  });

  it('names the day it would have accepted', () => {
    // The refusal has to be actionable: a caller elsewhere in the world cannot
    // derive the account's current day from anything in its own request.
    try {
      assertIntradayInsightsWindow(
        window('2026-08-25', '2026-08-25'),
        'Pacific/Auckland',
        NOW,
      );
      throw new Error('expected a refusal');
    } catch (error) {
      expect(error).toBeInstanceOf(SocialAdInsightsWindowNotIntradayError);
      expect((error as SocialAdInsightsWindowNotIntradayError).today).toBe(
        '2026-08-27',
      );
      expect((error as SocialAdInsightsWindowNotIntradayError).timezone).toBe(
        'Pacific/Auckland',
      );
    }
  });
});
