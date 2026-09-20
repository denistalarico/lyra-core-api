import { Injectable } from '@nestjs/common';

export const SOCIAL_ORGANIC_AUDIENCE_ENABLED_ENV =
  'SOCIAL_ORGANIC_AUDIENCE_ENABLED';

/**
 * The gate on organic audience ingestion.
 *
 * **Edit `.env`, restart the API, and the new value takes effect.** Nothing here
 * watches the file: `process.env` is a snapshot taken when the process started,
 * and no comment, test or document may suggest otherwise.
 *
 * Off by default, for the same reason its paid sibling is: turning it on adds
 * provider calls per asset per sync — four for an Instagram account, three for a
 * Page — against a quota shared with the publishing path. A deployment that
 * enabled it without deciding to would slow reads that were already working, and
 * the symptom would surface on publishing rather than on the demographic charts
 * nobody had asked for yet.
 *
 * With the gate closed the table stays empty, the read endpoint answers with an
 * empty distribution, and the UI shows its "métrica ainda não disponível" state
 * — exactly what it shows today. Nothing regresses; a capability stays dormant
 * until an operator opts in.
 *
 * Only an explicit, recognizable "on" enables it. A typo reads as off, the safe
 * direction for a switch whose other failure mode is spending quota the
 * publishing path needs.
 */
@Injectable()
export class SocialOrganicAudienceConfigService {
  get enabled(): boolean {
    const raw =
      process.env[SOCIAL_ORGANIC_AUDIENCE_ENABLED_ENV]?.trim().toLowerCase();

    if (raw === undefined || raw === '') return false;

    return ['true', '1', 'yes', 'on'].includes(raw);
  }
}
