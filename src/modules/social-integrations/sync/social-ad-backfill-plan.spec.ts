import { planBackfillChunks } from './social-ad-backfill-plan';

const ANCHOR = '2026-08-26';

function plan(
  overrides: Partial<Parameters<typeof planBackfillChunks>[0]> = {},
) {
  return planBackfillChunks({
    anchor: ANCHOR,
    totalDays: 90,
    chunkDays: 7,
    ...overrides,
  });
}

describe('planBackfillChunks', () => {
  it('covers ninety days as twelve full weeks and a shorter last one', () => {
    const chunks = plan();

    expect(chunks).toHaveLength(13);
    expect(chunks.slice(0, 12).every((chunk) => chunk.days === 7)).toBe(true);
    // 90 = 12 × 7 + 6. The remainder lands on the oldest chunk, so the twelve
    // week boundaries do not move when the horizon changes.
    expect(chunks[12].days).toBe(6);
    expect(chunks.reduce((total, chunk) => total + chunk.days, 0)).toBe(90);
  });

  it('starts at the anchor and ends exactly ninety days earlier', () => {
    const chunks = plan();

    expect(chunks[0].until).toBe(ANCHOR);
    expect(chunks[0].since).toBe('2026-08-20');
    // D-89 inclusive of the anchor is the ninetieth day.
    expect(chunks[12].since).toBe('2026-05-29');
  });

  it('leaves no gap between consecutive chunks', () => {
    const chunks = plan();

    for (let index = 1; index < chunks.length; index += 1) {
      const older = chunks[index];
      const newer = chunks[index - 1];

      // The older chunk ends on the day before the newer one starts. A single
      // missing day here is a day of spend that no run would ever fetch.
      expect(shift(older.until, 1)).toBe(newer.since);
    }
  });

  it('leaves no overlap between consecutive chunks', () => {
    const days = plan().flatMap(expand);

    // Every day appears once. An overlap would not corrupt the table — the
    // upsert is idempotent — but it would spend provider quota re-reading days
    // another chunk already has, on every backfill.
    expect(new Set(days).size).toBe(days.length);
    expect(days).toHaveLength(90);
  });

  it('runs newest first, so an interrupted backfill has the recent weeks', () => {
    const chunks = plan();

    const ends = chunks.map((chunk) => chunk.until);

    expect([...ends].sort().reverse()).toEqual(ends);
    expect(chunks[0].index).toBe(0);
  });

  it('makes a single chunk when the chunk is larger than the horizon', () => {
    expect(plan({ totalDays: 5, chunkDays: 30 })).toEqual([
      { index: 0, since: '2026-08-22', until: ANCHOR, days: 5 },
    ]);
  });

  it('makes a chunk per day when asked for one', () => {
    const chunks = plan({ totalDays: 3, chunkDays: 1 });

    expect(chunks.map((chunk) => chunk.until)).toEqual([
      '2026-08-26',
      '2026-08-25',
      '2026-08-24',
    ]);
    expect(chunks.every((chunk) => chunk.days === 1)).toBe(true);
  });

  it('divides evenly when the horizon is a multiple of the chunk', () => {
    const chunks = plan({ totalDays: 28, chunkDays: 7 });

    expect(chunks).toHaveLength(4);
    // No short chunk at all: the last one is only clipped when there is a
    // remainder, and clipping a whole chunk to zero days would be a run that
    // reads nothing.
    expect(chunks.every((chunk) => chunk.days === 7)).toBe(true);
  });

  it('plans nothing when backfill is turned off', () => {
    expect(plan({ totalDays: 0 })).toEqual([]);
    expect(plan({ chunkDays: 0 })).toEqual([]);
  });

  it('crosses a month and a leap day without losing one', () => {
    const chunks = planBackfillChunks({
      anchor: '2028-03-02',
      totalDays: 10,
      chunkDays: 4,
    });

    expect(chunks.flatMap(expand)).toContain('2028-02-29');
    expect(chunks.reduce((total, chunk) => total + chunk.days, 0)).toBe(10);
  });

  it('crosses a daylight saving transition without losing or repeating a day', () => {
    // Brazil abolished DST, but the plan must not depend on that: these are
    // calendar days, and the arithmetic never converts one to an instant. The
    // window spans a northern-hemisphere spring-forward.
    const days = planBackfillChunks({
      anchor: '2026-03-15',
      totalDays: 14,
      chunkDays: 5,
    }).flatMap(expand);

    expect(new Set(days).size).toBe(14);
    expect(days).toContain('2026-03-08');
  });
});

/** Every day a chunk covers, as `YYYY-MM-DD`. */
function expand(chunk: { since: string; days: number }): string[] {
  return Array.from({ length: chunk.days }, (_, offset) =>
    shift(chunk.since, offset),
  );
}

function shift(day: string, days: number): string {
  const [year, month, date] = day.split('-').map(Number);

  return new Date(Date.UTC(year, month - 1, date + days))
    .toISOString()
    .slice(0, 10);
}
