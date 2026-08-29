import type { IntelligenceMetricUnit } from './intelligence-metric';

/**
 * A quotient of two facts, declared rather than computed.
 *
 * **Ratios are not facts, and this file exists to keep them out of the fact
 * list.** A stored CTR is only correct at the grain it was computed at: averaging
 * a thousand-impression day against a million-impression day weights them
 * equally and produces a number that is the CTR of nothing. The only definition
 * that survives an arbitrary window is the quotient of two sums — which can be
 * formed at any level, but only *after* the aggregation is done.
 *
 * So the contract ships the recipe, not the result. A consumer that aggregates
 * facts to some level then applies these descriptors at that level gets a correct
 * ratio; a consumer that received ratios as facts would have no way to
 * re-aggregate them and would almost certainly average them.
 *
 * The Social adapter still returns numerically identical values to
 * `deriveSocialAdKpis` at the levels both produce, and a spec asserts it: the
 * arithmetic is delegated to that module rather than reimplemented here, so
 * there is one rounding rule and one zero-denominator rule in the codebase.
 */

/** The level at which a ratio may be formed. */
export type IntelligenceRatioComputeAt =
  /**
   * After the numerator and denominator have been aggregated to whatever level
   * the consumer wants. The only value in this release — and the only one that
   * is correct for a quotient of two sums.
   */
  'aggregation_level';

export type IntelligenceRatioDescriptor = {
  key: string;
  unit: IntelligenceMetricUnit;
  /** Metric key of the numerator. Must exist in the fact set's descriptors. */
  numerator: string;
  /** Metric key of the denominator. Must exist in the fact set's descriptors. */
  denominator: string;
  computeAt: IntelligenceRatioComputeAt;
  /**
   * Multiplier applied to the numerator before dividing.
   *
   * `100` turns a quotient into a percentage (CTR); `1000` gives CPM its
   * per-thousand basis. Declared here rather than left to the consumer, because
   * a consumer that forgot it would report a CTR of `0.02` under a `%` unit.
   */
  numeratorBasis?: number;
  /** What the ratio cannot be used for, where that is not obvious. */
  limitation?: string;
};

/**
 * The paid-media ratios, declared once.
 *
 * Denominators follow Meta's own definitions rather than the ones that read
 * better, because a number that does not reconcile with Ads Manager is a number
 * that gets the whole dashboard distrusted:
 *
 * - **CTR / CPC** divide by all `clicks`, not `link_clicks`. Meta's `ctr` field
 *   is all-clicks, and publishing a different definition under the same name is
 *   how the figures drift apart.
 * - **CPL** divides by `leads`, the column S2.4's action-family rules already
 *   de-duplicated. Meta reports one lead under as many as seven action-type
 *   names; dividing by a naive sum of those would understate cost per lead
 *   several-fold.
 * - **CPA** divides by `conversions`, which is fractional under attribution — a
 *   conversion credited across two ads is two halves, and rounding to whole
 *   numbers first would inflate the cost of every split conversion.
 * - **ROAS** divides two money values, so the currency cancels and the result is
 *   a bare multiplier: `3.5` means three and a half times, not R$ 3.50.
 *
 * A zero denominator yields `null`, never `0` and never `Infinity` — "no clicks
 * yet" and "a cost per click of zero" are different facts, and rendering the
 * first as `R$ 0,00` tells the reader the campaign was free.
 *
 * ROAS has the mirror case and it is *not* null: `spend > 0` with
 * `conversionValue = 0` is a genuine return of zero — money went out, nothing
 * came back — and it is one of the few numbers on a dashboard that must be shown
 * rather than hidden.
 */
export const PAID_MEDIA_RATIOS: readonly IntelligenceRatioDescriptor[] = [
  {
    key: 'ctr',
    unit: 'percent',
    numerator: 'clicks',
    denominator: 'impressions',
    computeAt: 'aggregation_level',
    numeratorBasis: 100,
    limitation: 'All clicks, matching Meta’s own ctr — not link clicks.',
  },
  {
    key: 'cpc',
    unit: 'currency',
    numerator: 'spend',
    denominator: 'clicks',
    computeAt: 'aggregation_level',
  },
  {
    key: 'cpm',
    unit: 'currency',
    numerator: 'spend',
    denominator: 'impressions',
    computeAt: 'aggregation_level',
    numeratorBasis: 1000,
  },
  {
    key: 'cpl',
    unit: 'currency',
    numerator: 'spend',
    denominator: 'leads',
    computeAt: 'aggregation_level',
    limitation:
      'Leads are de-duplicated across Meta action-type families before dividing.',
  },
  {
    key: 'cpa',
    unit: 'currency',
    numerator: 'spend',
    denominator: 'conversions',
    computeAt: 'aggregation_level',
    limitation: 'Conversions are fractional under attribution.',
  },
  {
    key: 'roas',
    unit: 'ratio',
    numerator: 'conversion_value',
    denominator: 'spend',
    computeAt: 'aggregation_level',
    limitation:
      'Zero with positive spend is a real result, not a missing value; only zero spend yields null.',
  },
];
