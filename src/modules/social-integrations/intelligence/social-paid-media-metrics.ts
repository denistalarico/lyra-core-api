import type { IntelligenceMetricDescriptor } from '../../../common/intelligence';

/**
 * What paid media reports, declared once.
 *
 * Every `source` names the column the number actually comes from, so a disputed
 * figure can be traced without reading the adapter. All nine are `derived: false`
 * — they are stored measurements — and the ratios built from them live in
 * `PAID_MEDIA_RATIOS`, never here.
 *
 * The keys are provider-neutral: `spend`, not `meta_spend`. Which provider
 * measured it is a dimension, so the day Google Ads is ingested a consumer
 * summing spend across providers does not need to know the set of providers.
 */
export const PAID_MEDIA_METRICS: readonly IntelligenceMetricDescriptor[] = [
  {
    key: 'spend',
    unit: 'currency',
    additivity: 'sum',
    derived: false,
    source: 'social_ad_metrics_daily.spend',
    formula: 'SUM(spend) over the window, in the account currency.',
  },
  {
    key: 'impressions',
    unit: 'count',
    additivity: 'sum',
    derived: false,
    source: 'social_ad_metrics_daily.impressions',
  },
  {
    /**
     * The one non-additive metric, and the reason `IntelligenceAdditivity`
     * exists.
     *
     * Meta de-duplicates people *within* the day it measured. Two days of reach
     * therefore share an unknown number of the same people, and adding them
     * overstates the true figure by an amount nothing in this system can
     * measure — the de-duplication happened inside Meta, over identities that
     * never leave it. There is no correct period aggregate, only a measurement
     * this platform does not hold.
     */
    key: 'reach',
    unit: 'people',
    additivity: 'non_additive',
    derived: false,
    source: 'social_ad_metrics_daily.reach',
    limitation:
      'De-duplicated people per day. Never summable across days; a period-level ' +
      'reach would be a separate measurement Meta was never asked for.',
  },
  {
    key: 'clicks',
    unit: 'count',
    additivity: 'sum',
    derived: false,
    source: 'social_ad_metrics_daily.clicks',
    limitation: 'All clicks, matching Meta’s own definition — not link clicks.',
  },
  {
    key: 'link_clicks',
    unit: 'count',
    additivity: 'sum',
    derived: false,
    source: 'social_ad_metrics_daily.link_clicks',
  },
  {
    key: 'leads',
    unit: 'count',
    additivity: 'sum',
    derived: false,
    source: 'social_ad_metrics_daily.leads',
    formula:
      'Promoted from Meta actions after action-family de-duplication (S2.4): ' +
      'one lead reported under several action-type names counts once.',
  },
  {
    key: 'conversions',
    unit: 'count',
    additivity: 'sum',
    derived: false,
    source: 'social_ad_metrics_daily.conversions',
    limitation:
      'Fractional under attribution — a conversion credited across two ads is ' +
      'two halves. Not a whole count despite the unit.',
  },
  {
    key: 'conversion_value',
    unit: 'currency',
    additivity: 'sum',
    derived: false,
    source: 'social_ad_metrics_daily.conversion_value',
  },
  {
    key: 'video_views',
    unit: 'count',
    additivity: 'sum',
    derived: false,
    source: 'social_ad_metrics_daily.video_views',
    limitation:
      'Meta’s video_view action, not plays — the two count different things ' +
      'and are not interchangeable.',
  },
];

/** Descriptor lookup, for tests and consumers that hold a key. */
export const PAID_MEDIA_METRICS_BY_KEY: ReadonlyMap<
  string,
  IntelligenceMetricDescriptor
> = new Map(PAID_MEDIA_METRICS.map((metric) => [metric.key, metric]));
