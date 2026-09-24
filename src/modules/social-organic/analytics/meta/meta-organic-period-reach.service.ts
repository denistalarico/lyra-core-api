import { Injectable } from '@nestjs/common';
import type { ResolvedOrganicAnalyticsCredential } from '../../credentials/social-organic-credential.resolver';
import { MetaOrganicGraphService } from '../../providers/meta/meta-organic-graph.service';

/**
 * The de-duplicated organic reach of a whole period, measured by Meta.
 *
 * ## Why this service exists
 *
 * The organic overview has always returned `reach: null` for any window longer
 * than a day, and the card showed a dash. That was correct — reach is unique
 * people, and summing daily figures counts anyone reached on two days twice —
 * but "correct and always empty" is not a usable answer when every competing
 * report shows the number.
 *
 * ## What Meta actually offers, verified against production on 2026-09-23
 *
 * - `period=days_28` → `(#100) The following periods (days_28) are incompatible
 *   with the metric (reach)`.
 * - `period=week` → the same refusal.
 * - a range with no `period` → `(#100) the parameter period is required`.
 * - **`period=day` + `metric_type=total_value` + `since`/`until` → one row whose
 *   `total_value.value` is de-duplicated across the whole range.**
 *
 * That last shape is the mechanism. On the production account, 1–23 September
 * returned 6 742 while the daily values over the same range sum to far more:
 * the difference is exactly the people who appeared on more than one day, and
 * Meta removed them where the identities are. No local arithmetic could have.
 *
 * `period=day` here does *not* mean "one day". It selects the daily metric, and
 * `metric_type=total_value` without a `breakdown` collapses the series Meta
 * would otherwise return into a single de-duplicated figure for the range.
 *
 * ## Why it is not folded into the daily sync
 *
 * The daily ingest asks with `breakdown=media_product_type`, because it needs
 * organic-only values split by surface and must exclude the AD bucket. This
 * read deliberately omits the breakdown — Meta only collapses to one
 * de-duplicated total when nothing splits it — so the number here **includes
 * ads**, exactly as Meta's own "Contas alcançadas" does. The two are different
 * measurements and are stored in different places for that reason; see
 * `periodReachIncludesAds` on the view.
 *
 * Mirrors `MetaAdsReachReaderService` on the paid side, which solved the same
 * problem with the same shape (there: omitting `time_increment`).
 */
@Injectable()
export class MetaOrganicPeriodReachService {
  constructor(private readonly graph: MetaOrganicGraphService) {}

  /**
   * One measurement for one asset and range, or null when Meta reported none.
   *
   * Null is a first-class answer, never zero: an account Meta has no reach for
   * and an account nobody saw are different statements, and the caller renders
   * them differently.
   */
  async measure(input: {
    resolved: ResolvedOrganicAnalyticsCredential;
    /** Calendar days in the asset's own timezone, inclusive. */
    since: string;
    until: string;
  }): Promise<{ reach: string | null; apiCalls: number }> {
    const { credential } = input.resolved;

    // Facebook Pages have no equivalent: `page_impressions_unique` was retired
    // alongside the other Page insights, so asking would spend a call to be
    // refused. Instagram is the only surface that answers this today.
    if (credential.assetType !== 'instagram_professional') {
      return { reach: null, apiCalls: 0 };
    }

    const response = await this.graph.getOrganicInsights({
      objectId: credential.externalAssetId,
      accessToken: credential.accessToken,
      metrics: ['reach'],
      period: 'day',
      metricType: 'total_value',
      // `until` is exclusive on this edge, so the last day is included by
      // asking for the instant after it rather than by shifting the caller's
      // calendar day — which would make the stored range disagree with the one
      // requested.
      since: toUnixDay(input.since),
      until: toUnixDay(input.until) + DAY_SECONDS,
    });

    return { reach: readTotalValue(response.data), apiCalls: response.apiCalls };
  }
}

const DAY_SECONDS = 86_400;

/** A `YYYY-MM-DD` calendar day as the Unix second Meta expects. */
function toUnixDay(day: string): number {
  return Math.floor(new Date(`${day}T00:00:00Z`).getTime() / 1000);
}

/**
 * The one `total_value.value` in the response, as a digit string.
 *
 * Anything else — no rows, a row without the field, a non-finite number — is
 * null rather than zero, for the reason `measure` documents. A breakdown array
 * in this position would mean the request was not the collapsing shape this
 * service depends on, and is refused the same way.
 */
function readTotalValue(data: unknown[]): string | null {
  const [first] = data;

  if (!first || typeof first !== 'object') return null;

  const totalValue = (first as { total_value?: unknown }).total_value;

  if (!totalValue || typeof totalValue !== 'object') return null;
  if ('breakdowns' in totalValue) return null;

  const value = (totalValue as { value?: unknown }).value;

  if (typeof value !== 'number' || !Number.isFinite(value) || value < 0) {
    return null;
  }

  return Math.trunc(value).toString();
}
