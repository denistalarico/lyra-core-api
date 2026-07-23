import { evaluateBusinessHours } from './leadflow-automation-context-loader.service';

describe('evaluateBusinessHours', () => {
  const config = {
    enabled: true,
    timezone: 'UTC',
    days: [
      { day: 'monday', enabled: true, start: '08:00', end: '18:00' },
      { day: 'saturday', enabled: false, start: '08:00', end: '12:00' },
    ],
  };

  it('is inside the window during configured hours', () => {
    // A Monday at 10:00 UTC.
    const result = evaluateBusinessHours(
      config,
      new Date('2026-07-20T10:00:00Z'),
    );
    expect(result).toBe(true);
  });

  it('is outside the window before it opens', () => {
    const result = evaluateBusinessHours(
      config,
      new Date('2026-07-20T06:00:00Z'),
    );
    expect(result).toBe(false);
  });

  it('is outside on a disabled day', () => {
    // A Saturday.
    const result = evaluateBusinessHours(
      config,
      new Date('2026-07-25T10:00:00Z'),
    );
    expect(result).toBe(false);
  });

  it('never guesses "open" from an absent configuration', () => {
    // The whole point: a follow-up must not go out at 3am because nobody set
    // the hours. Unknown is unknown, not open.
    expect(evaluateBusinessHours(null, new Date())).toBeNull();
    expect(evaluateBusinessHours({}, new Date())).toBeNull();
    expect(evaluateBusinessHours({ days: [] }, new Date())).toBeNull();
  });

  it('treats a disabled window as always open', () => {
    expect(evaluateBusinessHours({ enabled: false }, new Date())).toBe(true);
  });

  it('reports unknown when the day has no hours', () => {
    const result = evaluateBusinessHours(
      {
        timezone: 'UTC',
        days: [{ day: 'monday', enabled: true }],
      },
      new Date('2026-07-20T10:00:00Z'),
    );
    expect(result).toBeNull();
  });

  it('respects the configured timezone', () => {
    // 23:00 UTC on Monday is 20:00 in São Paulo, still inside 08–18? No — it is
    // after 18:00 local, so outside. This guards against evaluating in UTC.
    const spConfig = { ...config, timezone: 'America/Sao_Paulo' };
    const result = evaluateBusinessHours(
      spConfig,
      new Date('2026-07-20T23:00:00Z'),
    );
    expect(result).toBe(false);
  });
});
