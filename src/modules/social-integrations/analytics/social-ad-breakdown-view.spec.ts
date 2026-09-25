import type { SocialAdBreakdownKind } from '../entities/social-ad-breakdown-daily.entity';
import {
  describeBreakdownKey,
  sortBreakdownBuckets,
  type SocialAdBreakdownBucket,
} from './social-ad-breakdown-view';

function bucket(key: string, spend: string | null): SocialAdBreakdownBucket {
  return {
    key,
    label: describeBreakdownKey('publisher_platform', key),
    spend,
    impressions: null,
    clicks: null,
    linkClicks: null,
    reach: null,
  };
}

describe('describeBreakdownKey', () => {
  it.each<[SocialAdBreakdownKind, string, string]>([
    ['age_gender', '25-34|female', '25-34 · Feminino'],
    ['age_gender', '65+|male', '65+ · Masculino'],
    ['device_platform', 'mobile_app', 'Aplicativo'],
    ['publisher_platform', 'instagram', 'Instagram'],
  ])('renders a %s key for a person', (kind, key, expected) => {
    expect(describeBreakdownKey(kind, key)).toBe(expected);
  });

  it('translates unknown rather than hiding it', () => {
    // It carries real delivery; dropping it would make the buckets fail to add
    // up to the account total.
    expect(describeBreakdownKey('device_platform', 'unknown')).toBe(
      'Não informado',
    );
  });

  it('falls through to the raw key for a platform Meta added since', () => {
    // A legible untranslated label beats merging a new platform into the
    // genuine `unknown` bucket, which already means something else.
    expect(describeBreakdownKey('publisher_platform', 'brand_new')).toBe(
      'brand_new',
    );
  });

  describe('hourly', () => {
    it('renders the daypart as the hour it names', () => {
      expect(describeBreakdownKey('hourly', 'h09')).toBe('09h');
      expect(describeBreakdownKey('hourly', 'h00')).toBe('00h');
      expect(describeBreakdownKey('hourly', 'h23')).toBe('23h');
    });

    it('produces 24 distinct labels, so no two dayparts collide in a legend', () => {
      const labels = new Set(
        Array.from({ length: 24 }, (_unused, hour) =>
          describeBreakdownKey('hourly', `h${String(hour).padStart(2, '0')}`),
        ),
      );

      expect(labels.size).toBe(24);
    });

    it('shows an unexpected key raw rather than as a plausible wrong hour', () => {
      // Unreachable through the normalizer, which refuses anything but h00–h23.
      // If it is ever reached, the key predates that rule and should be visible.
      expect(describeBreakdownKey('hourly', 'h9')).toBe('h9');
      expect(describeBreakdownKey('hourly', 'unknown')).toBe('unknown');
    });
  });
});

describe('sortBreakdownBuckets', () => {
  it('orders a ranked dimension by spend, descending', () => {
    const sorted = sortBreakdownBuckets('publisher_platform', [
      bucket('facebook', '10.000000'),
      bucket('instagram', '30.000000'),
      bucket('messenger', '20.000000'),
    ]);

    expect(sorted.map((entry) => entry.key)).toEqual([
      'instagram',
      'messenger',
      'facebook',
    ]);
  });

  it('breaks a spend tie on the key, not on row order', () => {
    const sorted = sortBreakdownBuckets('device_platform', [
      bucket('mobile_web', '5.000000'),
      bucket('desktop', '5.000000'),
    ]);

    expect(sorted.map((entry) => entry.key)).toEqual(['desktop', 'mobile_web']);
  });

  it('compares spend without turning money into a float', () => {
    // Two values that differ only past the 15th significant digit, where a
    // double would report them equal.
    const sorted = sortBreakdownBuckets('publisher_platform', [
      bucket('facebook', '100000000000.000001'),
      bucket('instagram', '100000000000.000002'),
    ]);

    expect(sorted[0].key).toBe('instagram');
  });

  it('leaves the input array untouched', () => {
    const input = [
      bucket('facebook', '1.000000'),
      bucket('instagram', '2.000000'),
    ];

    sortBreakdownBuckets('publisher_platform', input);

    expect(input.map((entry) => entry.key)).toEqual(['facebook', 'instagram']);
  });

  describe('ordinal dimensions', () => {
    it('keeps age brackets in their natural order, genders together', () => {
      const sorted = sortBreakdownBuckets('age_gender', [
        bucket('35-44|male', '1.000000'),
        bucket('25-34|male', '99.000000'),
        bucket('25-34|female', '2.000000'),
      ]);

      expect(sorted.map((entry) => entry.key)).toEqual([
        '25-34|female',
        '25-34|male',
        '35-44|male',
      ]);
    });

    it('runs the dayparts from midnight to midnight, never by size', () => {
      // The question "por hora" asks is the shape of a day. Ranking the axis by
      // spend would put 16h beside 09h and destroy the only thing it is read
      // for — so the busiest hour here is deliberately not first.
      const sorted = sortBreakdownBuckets('hourly', [
        bucket('h16', '90.000000'),
        bucket('h00', '1.000000'),
        bucket('h09', '50.000000'),
        bucket('h23', '2.000000'),
      ]);

      expect(sorted.map((entry) => entry.key)).toEqual([
        'h00',
        'h09',
        'h16',
        'h23',
      ]);
    });

    it('orders all 24 dayparts chronologically from any input order', () => {
      const keys = Array.from(
        { length: 24 },
        (_unused, hour) => `h${String(hour).padStart(2, '0')}`,
      );
      const shuffled = [...keys]
        .reverse()
        .map((key) => bucket(key, '1.000000'));

      expect(
        sortBreakdownBuckets('hourly', shuffled).map((entry) => entry.key),
      ).toEqual(keys);
    });

    it('holds the clock order even when a daypart has no spend at all', () => {
      // A missing hour sorts last under the spend comparator; under the key
      // comparator it stays where the clock puts it, which is what makes a gap
      // in the middle of the day legible as a gap.
      const sorted = sortBreakdownBuckets('hourly', [
        bucket('h12', '5.000000'),
        bucket('h03', null),
        bucket('h20', '1.000000'),
      ]);

      expect(sorted.map((entry) => entry.key)).toEqual(['h03', 'h12', 'h20']);
    });
  });
});
