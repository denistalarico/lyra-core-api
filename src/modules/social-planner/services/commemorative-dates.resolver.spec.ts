import { easterSunday } from '../catalog/commemorative-dates.catalog';
import {
  resolveCommemorativeDates,
  resolveCommemorativeDatesByKey,
} from './commemorative-dates.resolver';

/**
 * The whole value of a rule-based catalog is that it is right for years nobody
 * checked by hand, so these assertions are against externally known dates
 * rather than against whatever the implementation happens to produce.
 */
describe('commemorative dates resolver', () => {
  describe('easterSunday', () => {
    // Published Gregorian Easter dates.
    it.each([
      [2024, 3, 31],
      [2025, 4, 20],
      [2026, 4, 5],
      [2027, 3, 28],
      [2030, 4, 21],
      [2038, 4, 25],
    ])('resolves %i', (year, month, day) => {
      expect(easterSunday(year)).toEqual({ month, day });
    });
  });

  it('derives Carnival and Corpus Christi from Easter', () => {
    const dates = resolveCommemorativeDates({
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      country: 'BR',
      businessMode: null,
    });

    // Easter 2026 is April 5th: Carnival is 47 days before, Corpus Christi 60 after.
    expect(dates.find((entry) => entry.key === 'br_carnival')?.date).toBe(
      '2026-02-17',
    );
    expect(dates.find((entry) => entry.key === 'br_corpus_christi')?.date).toBe(
      '2026-06-04',
    );
    expect(dates.find((entry) => entry.key === 'good_friday')?.date).toBe(
      '2026-04-03',
    );
  });

  it('resolves ordinal weekday rules, including counting from the end', () => {
    const dates = resolveCommemorativeDates({
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      country: 'US',
      businessMode: null,
    });

    const at = (key: string) =>
      dates.find((entry) => entry.key === key)?.date ?? null;

    // 2nd Sunday of May 2026.
    expect(at('us_mothers_day')).toBe('2026-05-10');
    // 3rd Sunday of June 2026.
    expect(at('us_fathers_day')).toBe('2026-06-21');
    // Last Monday of May 2026.
    expect(at('us_memorial_day')).toBe('2026-05-25');
    // 4th Thursday of November 2026, and the Friday after it.
    expect(at('us_thanksgiving')).toBe('2026-11-26');
    expect(at('black_friday')).toBe('2026-11-27');
  });

  it('resolves Brazilian second-Sunday rules', () => {
    const dates = resolveCommemorativeDates({
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
      country: 'BR',
      businessMode: null,
    });

    expect(dates.find((entry) => entry.key === 'br_mothers_day')?.date).toBe(
      '2026-05-10',
    );
    expect(dates.find((entry) => entry.key === 'br_fathers_day')?.date).toBe(
      '2026-08-09',
    );
  });

  it('spans a year boundary', () => {
    const dates = resolveCommemorativeDates({
      periodStart: '2026-11-15',
      periodEnd: '2027-01-15',
      country: 'BR',
      businessMode: null,
    });

    const keys = dates.map((entry) => entry.key);
    expect(keys).toContain('christmas');
    expect(keys).toContain('new_year');
    expect(dates.find((entry) => entry.key === 'new_year')?.date).toBe(
      '2027-01-01',
    );
  });

  it('excludes dates outside the period', () => {
    const dates = resolveCommemorativeDates({
      periodStart: '2026-03-01',
      periodEnd: '2026-03-31',
      country: 'BR',
      businessMode: null,
    });

    expect(dates.every((entry) => entry.date.startsWith('2026-03'))).toBe(true);
    expect(dates.map((entry) => entry.key)).toContain('br_consumer_day');
  });

  it('keeps GLOBAL dates under any country filter', () => {
    const dates = resolveCommemorativeDates({
      periodStart: '2026-12-01',
      periodEnd: '2026-12-31',
      country: 'AR',
      businessMode: null,
    });

    expect(dates.map((entry) => entry.key)).toContain('christmas');
    // Another country's national date must not leak in.
    expect(dates.map((entry) => entry.key)).not.toContain('br_architect_day');
  });

  it('narrows sector dates by business mode but keeps untagged ones', () => {
    const dates = resolveCommemorativeDates({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      country: 'BR',
      businessMode: 'clinics_esthetics',
    });

    const keys = dates.map((entry) => entry.key);
    expect(keys).toContain('br_dentist_day');
    expect(keys).toContain('br_childrens_day');
    expect(keys).not.toContain('br_mechanic_day');
  });

  it('sorts chronologically with national dates first within a day', () => {
    const dates = resolveCommemorativeDates({
      periodStart: '2026-10-01',
      periodEnd: '2026-10-31',
      country: 'BR',
      businessMode: null,
    });

    const sorted = [...dates].sort((left, right) =>
      left.date.localeCompare(right.date),
    );
    expect(dates.map((entry) => entry.date)).toEqual(
      sorted.map((entry) => entry.date),
    );

    // October 12th carries both a national holiday and Children's Day.
    const october12 = dates.filter((entry) => entry.date === '2026-10-12');
    expect(october12.length).toBeGreaterThan(1);
    expect(october12[0].significance).toBe('national');
  });

  it('re-derives picked keys without applying country or mode filters', () => {
    const dates = resolveCommemorativeDatesByKey(
      ['br_mechanic_day', 'christmas'],
      { periodStart: '2026-01-01', periodEnd: '2026-12-31' },
    );

    expect(dates.map((entry) => entry.key).sort()).toEqual([
      'br_mechanic_day',
      'christmas',
    ]);
  });

  it('drops unknown keys instead of failing', () => {
    const dates = resolveCommemorativeDatesByKey(['not_a_real_date'], {
      periodStart: '2026-01-01',
      periodEnd: '2026-12-31',
    });

    expect(dates).toEqual([]);
  });

  it('returns nothing for an inverted or malformed period', () => {
    expect(
      resolveCommemorativeDates({
        periodStart: '2026-12-31',
        periodEnd: '2026-01-01',
        country: 'BR',
        businessMode: null,
      }),
    ).toEqual([]);

    expect(
      resolveCommemorativeDates({
        periodStart: 'not-a-date',
        periodEnd: '2026-01-01',
        country: 'BR',
        businessMode: null,
      }),
    ).toEqual([]);
  });

  it('does not run away on an absurdly long period', () => {
    const dates = resolveCommemorativeDates({
      periodStart: '2026-01-01',
      periodEnd: '2999-12-31',
      country: 'BR',
      businessMode: null,
    });

    // Capped at six years of expansion rather than a thousand.
    const years = new Set(dates.map((entry) => entry.date.slice(0, 4)));
    expect(years.size).toBeLessThanOrEqual(6);
  });
});
