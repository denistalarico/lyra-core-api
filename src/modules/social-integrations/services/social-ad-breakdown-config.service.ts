import { Injectable } from '@nestjs/common';

export const SOCIAL_ADS_BREAKDOWNS_ENABLED_ENV =
  'SOCIAL_ADS_BREAKDOWNS_ENABLED';

/**
 * The gate on breakdown ingestion.
 *
 * **The contract, stated plainly: edit `.env`, restart the API, and the new
 * value takes effect.** Nothing here watches the file, exactly as
 * `SocialAdSyncConfigService` documents at length — `process.env` is a snapshot
 * taken when the process started, and no comment, test or document may suggest
 * otherwise.
 *
 * ## Why this defaults to *off*, when the sync switch defaults to on
 *
 * The two switches fail in opposite directions. `SOCIAL_ADS_SYNC_ENABLED`
 * defaults to true because a deployment that never heard of it should still
 * have a working product, and its failure mode in the other direction is a
 * silently dead sync.
 *
 * This one defaults to false because turning it on multiplies an account's
 * Insights quota consumption: three extra paginated reads per level per window,
 * each returning one row per object per day *per bucket*. The Marketing API
 * meters against a business-wide quota shared with every other account under the
 * same business, so a deployment that enabled this without deciding to would
 * throttle reads that were already working — and the symptom would appear on the
 * unsplit dashboard, not on the demographic charts nobody had asked for yet.
 *
 * Off is therefore the honest default: the breakdown tables stay empty, the
 * read endpoints answer with an empty distribution, and the UI shows its
 * "métrica ainda não disponível" state — which is exactly what it shows before
 * this slice existed. Nothing regresses; a capability simply stays dormant until
 * an operator opts in.
 *
 * Only an explicit, recognizable "on" enables it. A typo reads as off, which is
 * the safe direction for a switch whose other failure mode is spending somebody
 * else's quota.
 */
@Injectable()
export class SocialAdBreakdownConfigService {
  get enabled(): boolean {
    const raw =
      process.env[SOCIAL_ADS_BREAKDOWNS_ENABLED_ENV]?.trim().toLowerCase();

    if (raw === undefined || raw === '') return false;

    return ['true', '1', 'yes', 'on'].includes(raw);
  }
}
