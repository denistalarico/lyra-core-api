import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';
import {
  normalizeBreakdownRow,
  type BreakdownNormalizeContext,
} from './meta-ads-breakdown.normalizer';

const SYNCED_AT = new Date('2026-09-20T12:00:00.000Z');

function context(
  overrides: Partial<BreakdownNormalizeContext> = {},
): BreakdownNormalizeContext {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    connectionId: 'connection-a',
    provider: 'meta_ads',
    entityLevel: 'account',
    accountExternalId: 'act_123',
    accountTimezone: 'America/Sao_Paulo',
    currency: 'BRL',
    breakdownKind: 'age_gender',
    isPartial: false,
    syncedAt: SYNCED_AT,
    ...overrides,
  };
}

function row(overrides: Record<string, unknown> = {}) {
  return {
    date_start: '2026-09-01',
    date_stop: '2026-09-01',
    age: '25-34',
    gender: 'female',
    spend: '13.42',
    impressions: '5351',
    clicks: '42',
    inline_link_clicks: '17',
    ...overrides,
  };
}

describe('normalizeBreakdownRow identity and key', () => {
  it('joins age and gender into one key, age first', () => {
    const fact = normalizeBreakdownRow(row(), context());

    expect(fact?.breakdownKey).toBe('25-34|female');
  });

  it('takes the account id from the credential, never from the payload', () => {
    const fact = normalizeBreakdownRow(
      row({ account_id: 'act_999' }),
      context(),
    );

    // A redirected read must not be able to write facts under an id nobody
    // validated, so the payload's own account id is ignored entirely.
    expect(fact?.entityExternalId).toBe('act_123');
  });

  it('takes the campaign id from the payload at campaign level', () => {
    const fact = normalizeBreakdownRow(
      row({ campaign_id: '120200' }),
      context({ entityLevel: 'campaign' }),
    );

    expect(fact?.entityExternalId).toBe('120200');
  });

  it('refuses a row below account level with no readable object id', () => {
    expect(
      normalizeBreakdownRow(row(), context({ entityLevel: 'campaign' })),
    ).toBeNull();
  });

  it.each([
    [
      'device_platform' as SocialAdBreakdownKind,
      'device_platform',
      'mobile_app',
    ],
    [
      'publisher_platform' as SocialAdBreakdownKind,
      'publisher_platform',
      'instagram',
    ],
  ])('reads the %s dimension from its own field', (kind, field, value) => {
    const fact = normalizeBreakdownRow(
      row({ [field]: value }),
      context({ breakdownKind: kind }),
    );

    expect(fact?.breakdownKey).toBe(value);
  });

  it('lowercases a key so one audience cannot become two buckets', () => {
    const fact = normalizeBreakdownRow(
      row({ publisher_platform: 'Instagram' }),
      context({ breakdownKind: 'publisher_platform' }),
    );

    expect(fact?.breakdownKey).toBe('instagram');
  });

  it('keeps unknown as a real bucket rather than dropping it', () => {
    // Its delivery is real, and dropping it would make the buckets fail to add
    // up to the account total — the one property a reader checks.
    const fact = normalizeBreakdownRow(
      row({ age: 'unknown', gender: 'unknown' }),
      context(),
    );

    expect(fact?.breakdownKey).toBe('unknown|unknown');
  });

  it('refuses a row whose key half is missing rather than inventing one', () => {
    expect(
      normalizeBreakdownRow(row({ gender: undefined }), context()),
    ).toBeNull();
  });

  it('refuses a key outside the dimension alphabet', () => {
    expect(
      normalizeBreakdownRow(
        row({ publisher_platform: 'insta;gram' }),
        context({ breakdownKind: 'publisher_platform' }),
      ),
    ).toBeNull();
  });

  it('refuses a key longer than the column allows', () => {
    expect(
      normalizeBreakdownRow(
        row({ publisher_platform: 'a'.repeat(65) }),
        context({ breakdownKind: 'publisher_platform' }),
      ),
    ).toBeNull();
  });
});

/**
 * The hourly dimension, which is the one whose stored key is not Meta's own
 * string. Every test here is about that fold being total and lossless, because
 * a fold that silently mapped two different ranges onto one key would double
 * that bucket and leave the chart adding up correctly while being wrong.
 */
describe('normalizeBreakdownRow hourly key', () => {
  function hourRow(value: unknown) {
    return normalizeBreakdownRow(
      row({ hourly_stats_aggregated_by_audience_time_zone: value }),
      context({ breakdownKind: 'hourly' }),
    );
  }

  it("folds Meta's hour range to the stored daypart key", () => {
    expect(hourRow('09:00:00 - 09:59:59')?.breakdownKey).toBe('h09');
  });

  it('keeps the zero padding, so key order is clock order', () => {
    // The whole reason the key is `h09` and not `h9`: the view sorts dayparts
    // by key, and an unpadded key would place 10h before 9h.
    const keys = [
      '00:00:00 - 00:59:59',
      '09:00:00 - 09:59:59',
      '10:00:00 - 10:59:59',
      '23:00:00 - 23:59:59',
    ]
      .map((value) => hourRow(value)?.breakdownKey)
      .filter((key): key is string => key !== undefined);

    expect(keys).toEqual(['h00', 'h09', 'h10', 'h23']);
    expect([...keys].sort()).toEqual(keys);
  });

  it('covers all 24 dayparts, so no delivering hour is ever skipped', () => {
    for (let hour = 0; hour < 24; hour += 1) {
      const padded = String(hour).padStart(2, '0');

      expect(hourRow(`${padded}:00:00 - ${padded}:59:59`)?.breakdownKey).toBe(
        `h${padded}`,
      );
    }
  });

  it('tolerates the range being written without spaces', () => {
    expect(hourRow('14:00:00-14:59:59')?.breakdownKey).toBe('h14');
  });

  it('refuses a range that is not one whole hour', () => {
    // A half-hour or a multi-hour span would otherwise collapse onto the key of
    // its start hour, doubling that bucket rather than being visibly skipped.
    expect(hourRow('09:00:00 - 09:29:59')).toBeNull();
    expect(hourRow('09:00:00 - 11:59:59')).toBeNull();
  });

  it('refuses an hour outside the day', () => {
    expect(hourRow('24:00:00 - 24:59:59')).toBeNull();
  });

  it('refuses a missing or non-string daypart rather than inventing one', () => {
    expect(hourRow(undefined)).toBeNull();
    expect(hourRow(9)).toBeNull();
  });

  it('never yields a key a chart could mistake for a number', () => {
    // The `h` prefix is load-bearing: a bare `09` is a key some consumer
    // eventually does arithmetic on, and a breakdown key is an opaque join
    // value in every dimension.
    expect(hourRow('00:00:00 - 00:59:59')?.breakdownKey).toBe('h00');
    expect(Number(hourRow('00:00:00 - 00:59:59')?.breakdownKey)).toBeNaN();
  });

  it('reads the hourly row through the same measurement path as any other', () => {
    // The dimension is new; the fact shape is not. Same columns, same decimal
    // text, same null reach rule.
    const fact = hourRow('16:00:00 - 16:59:59');

    expect(fact).toMatchObject({
      breakdownKind: 'hourly',
      breakdownKey: 'h16',
      metricDate: '2026-09-01',
      spend: '13.420000',
      impressions: '5351',
      reach: null,
    });
  });
});

describe('normalizeBreakdownRow measurement', () => {
  it('carries the day verbatim, with no conversion', () => {
    const fact = normalizeBreakdownRow(
      row({ date_start: '2026-09-01' }),
      context(),
    );

    expect(fact?.metricDate).toBe('2026-09-01');
  });

  it('refuses a row with no readable day', () => {
    expect(
      normalizeBreakdownRow(row({ date_start: '01/09/2026' }), context()),
    ).toBeNull();
  });

  it('stores money and counts as decimal text, never as numbers', () => {
    const fact = normalizeBreakdownRow(row(), context());

    expect(fact?.spend).toBe('13.420000');
    expect(fact?.impressions).toBe('5351');
    expect(fact?.clicks).toBe('42');
    expect(fact?.linkClicks).toBe('17');
  });

  it('treats an absent metric as zero, because Meta omits zeros', () => {
    const fact = normalizeBreakdownRow(
      row({ inline_link_clicks: undefined }),
      context(),
    );

    expect(fact?.linkClicks).toBe('0');
  });

  it('leaves an absent reach null rather than zero', () => {
    // A zero would be summed by anyone who did not know reach is non-additive;
    // a null cannot be.
    const fact = normalizeBreakdownRow(row(), context());

    expect(fact?.reach).toBeNull();
  });

  it('refuses a row whose reach is present and unreadable', () => {
    expect(normalizeBreakdownRow(row({ reach: 'many' }), context())).toBeNull();
  });

  it('refuses a row whose spend is present and unreadable', () => {
    expect(
      normalizeBreakdownRow(row({ spend: 'R$ 13,42' }), context()),
    ).toBeNull();
  });

  it('stores both action maps under the mapping version', () => {
    const fact = normalizeBreakdownRow(
      row({ actions: [{ action_type: 'lead', value: '3' }] }),
      context(),
    );

    // Whole rather than promoted into columns, so one definition of a lead is
    // shared with the unsplit facts table and a mapping revision reaches both.
    expect(fact?.actions).toMatchObject({
      mappingVersion: expect.any(Number) as number,
      // Scaled to the fact columns' six decimals by `readActionMap`, exactly as
      // on the unsplit path — attribution splitting makes these fractional.
      counts: { lead: '3.000000' },
      values: {},
    });
  });

  it('carries the run context onto the row unchanged', () => {
    const fact = normalizeBreakdownRow(
      row(),
      context({ isPartial: true, agencyClientId: 'client-a' }),
    );

    expect(fact).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId: 'connection-a',
      accountTimezone: 'America/Sao_Paulo',
      currency: 'BRL',
      breakdownKind: 'age_gender',
      isPartial: true,
      syncedAt: SYNCED_AT,
    });
  });

  it('refuses a payload that is not an object', () => {
    expect(normalizeBreakdownRow(null, context())).toBeNull();
    expect(normalizeBreakdownRow('row', context())).toBeNull();
  });
});
