import {
  GA4_OTHER_BUCKET,
  normalizeDailyRows,
  normalizeDimensionRows,
  parseGa4Date,
} from './ga4.normalizer';

const dim = (date: string, value: string, sessions: number, engaged = 0) => ({
  dimensions: [date, value],
  metrics: [sessions, engaged, sessions, 0, 0],
});

describe('GA4 normalizer', () => {
  it('reads the YYYYMMDD date GA4 emits', () => {
    expect(parseGa4Date('20261113')).toBe('2026-11-13');
  });

  it('rejects a date in any other shape', () => {
    expect(parseGa4Date('2026-11-13')).toBeNull();
  });

  it('maps the daily report in request order', () => {
    const [row] = normalizeDailyRows([
      {
        dimensions: ['20261112'],
        metrics: [100, 80, 30, 60, 42.5, 250, 900, 7, 123.45],
      },
    ]);

    expect(row).toEqual({
      metricDate: '2026-11-12',
      sessions: 100,
      totalUsers: 80,
      newUsers: 30,
      engagedSessions: 60,
      avgSessionSeconds: 42.5,
      pageViews: 250,
      eventCount: 900,
      keyEvents: 7,
      totalRevenue: 123.45,
    });
  });

  it('drops a daily row whose date is not a date', () => {
    expect(
      normalizeDailyRows([
        { dimensions: ['(other)'], metrics: [1, 1, 1, 1, 1, 1, 1, 1, 1] },
      ]),
    ).toHaveLength(0);
  });

  it('keeps only the top N per day', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      dim('20261112', `p${i}`, 100 - i),
    );

    const kept = normalizeDimensionRows('landing_page', rows, 3).filter(
      (row) => row.value !== GA4_OTHER_BUCKET,
    );

    expect(kept.map((row) => row.value)).toEqual(['p0', 'p1', 'p2']);
  });

  it('folds the tail of a day into one (other) row', () => {
    const rows = Array.from({ length: 5 }, (_, i) =>
      dim('20261112', `p${i}`, 100 - i),
    );

    const other = normalizeDimensionRows('landing_page', rows, 3).find(
      (row) => row.value === GA4_OTHER_BUCKET,
    );

    expect(other?.sessions).toBe(97 + 96);
  });

  it('does not fold across days', () => {
    const rows = [
      dim('20261112', 'a', 10),
      dim('20261112', 'b', 9),
      dim('20261113', 'a', 8),
    ];

    expect(
      normalizeDimensionRows('campaign', rows, 1).filter(
        (row) => row.metricDate === '2026-11-13',
      ),
    ).toHaveLength(1);
  });

  it('merges a literal (other) value into the bucket instead of repeating the key', () => {
    const rows = [
      dim('20261112', GA4_OTHER_BUCKET, 50),
      dim('20261112', 'a', 40),
      dim('20261112', 'b', 30),
    ];

    expect(
      normalizeDimensionRows('campaign', rows, 2).filter(
        (row) => row.value === GA4_OTHER_BUCKET,
      ),
    ).toHaveLength(1);
  });

  it('labels an empty dimension value as (not set)', () => {
    const [row] = normalizeDimensionRows('country', [dim('20261112', '  ', 5)]);

    expect(row.value).toBe('(not set)');
  });

  it('truncates a value to the column width', () => {
    const [row] = normalizeDimensionRows('landing_page', [
      dim('20261112', 'x'.repeat(500), 5),
    ]);

    expect(row.value).toHaveLength(300);
  });
});
