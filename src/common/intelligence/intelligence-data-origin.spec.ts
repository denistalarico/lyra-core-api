import {
  parseBenchmarkCohortKey,
  serializeBenchmarkCohortKey,
} from './intelligence-benchmark-cohort';
import {
  isCollectiveContributionEligible,
  isGoogleApiDataOrigin,
} from './intelligence-data-origin';

const MODES = new Set(['synthetic_mode_a']);

describe('collective contribution data origins', () => {
  it.each([
    'google_ads',
    'ga4',
    'google_analytics',
    'google_data_manager',
    'youtube',
    'business_profile',
    'ads',
    'GOOGLE_ADS',
    'google_ads_leads',
    'youtube_analytics',
    'google',
  ])('treats %s as Google API data', (origin) => {
    expect(isGoogleApiDataOrigin(origin)).toBe(true);
    expect(isCollectiveContributionEligible([origin])).toBe(false);
  });

  it.each(['meta_ads', 'meta', 'leadflow_automation', 'instagram'])(
    'keeps %s eligible',
    (origin) => {
      expect(isCollectiveContributionEligible([origin])).toBe(true);
    },
  );

  it('rejects a mix and an undeclared origin', () => {
    expect(isCollectiveContributionEligible(['meta_ads', 'google_ads'])).toBe(
      false,
    );
    expect(isCollectiveContributionEligible(['meta_ads', 'youtube'])).toBe(
      false,
    );
    expect(isCollectiveContributionEligible([])).toBe(false);
    expect(isCollectiveContributionEligible(null)).toBe(false);
    expect(isCollectiveContributionEligible(['meta_ads', ' '])).toBe(false);
  });

  it('refuses a Google cohort in the benchmark key, both ways', () => {
    for (const provider of ['google', 'google_ads', 'youtube', 'ga4']) {
      expect(() =>
        serializeBenchmarkCohortKey(
          {
            businessModeKey: 'synthetic_mode_a',
            provider,
            destination: 'website',
            currency: null,
          },
          MODES,
        ),
      ).toThrow(/not a benchmark provider/);
      expect(
        parseBenchmarkCohortKey(
          `v1|bm=synthetic_mode_a|p=${provider}|d=website`,
          MODES,
        ),
      ).toBeNull();
    }
    expect(
      parseBenchmarkCohortKey('v1|bm=synthetic_mode_a|p=meta|d=website', MODES),
    ).not.toBeNull();
  });
});
