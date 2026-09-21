import { Injectable } from '@nestjs/common';

export const SOCIAL_ADS_PERIOD_REACH_ENABLED_ENV =
  'SOCIAL_ADS_PERIOD_REACH_ENABLED';

/**
 * The gate on period reach measurement.
 *
 * **The contract, stated plainly: edit `.env`, restart the API, and the new
 * value takes effect.** Nothing here watches the file, exactly as
 * `SocialAdSyncConfigService` documents at length — `process.env` is a snapshot
 * taken when the process started, and no comment, test or document may suggest
 * otherwise.
 *
 * ## Why this defaults to *off*
 *
 * It costs Graph requests against the same CPU-metered business quota the
 * insights sync already competes for, and it is the cheapest thing on that quota
 * to give up: six requests per account per day, each returning a single row.
 * §6 of the campaign plan says as much — if throttling appears, these presets go
 * first, before the breakdowns.
 *
 * Off is therefore the honest default for the same reason
 * `SOCIAL_ADS_BREAKDOWNS_ENABLED` is off: a deployment that never decided to
 * enable this would otherwise start spending a shared quota it did not budget
 * for, and the symptom would show up on the dashboard that already worked
 * rather than on the figure nobody had yet.
 *
 * With the gate closed the table stays empty, the overview answers
 * `periodReach: null`, and the UI shows "alcance do período ainda não medido" —
 * which is exactly what it showed before this slice existed. Nothing regresses;
 * a capability stays dormant until an operator opts in.
 *
 * Only an explicit, recognizable "on" enables it. A typo reads as off, which is
 * the safe direction for a switch whose other failure mode is spending somebody
 * else's quota.
 *
 * A separate variable from `SOCIAL_ADS_BREAKDOWNS_ENABLED`, and not because
 * symmetry is tidy: the two spend differently and are given up in a different
 * order. Enabling demographic breakdowns is a decision about what the dashboard
 * can show; enabling this is a decision about one number on a page that already
 * works.
 */
@Injectable()
export class SocialAdReachPeriodConfigService {
  get enabled(): boolean {
    const raw =
      process.env[SOCIAL_ADS_PERIOD_REACH_ENABLED_ENV]?.trim().toLowerCase();

    if (raw === undefined || raw === '') return false;

    return ['true', '1', 'yes', 'on'].includes(raw);
  }
}
