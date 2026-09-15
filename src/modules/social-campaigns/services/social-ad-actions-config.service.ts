import { Injectable } from '@nestjs/common';

/** Global emergency brake. Per-account policy is an additional, not alternate, gate. */
@Injectable()
export class SocialAdActionsConfigService {
  readonly writesEnabled =
    process.env.SOCIAL_CAMPAIGN_META_WRITES_ENABLED?.trim().toLowerCase() ===
    'true';
}
