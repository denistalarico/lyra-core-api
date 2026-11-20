import { Injectable } from '@nestjs/common';

export type SocialAdManualActionProvider = 'meta_ads' | 'google_ads';

/** Global emergency brake. Per-account policy is an additional, not alternate, gate. */
@Injectable()
export class SocialAdActionsConfigService {
  readonly writesEnabled =
    process.env.SOCIAL_CAMPAIGN_META_WRITES_ENABLED?.trim().toLowerCase() ===
    'true';

  /** GA-WRITE (D-G5): Google has its own brake; the Meta one never opens it. */
  readonly googleWritesEnabled =
    process.env.SOCIAL_CAMPAIGN_GOOGLE_WRITES_ENABLED?.trim().toLowerCase() ===
    'true';

  writesEnabledFor(provider: SocialAdManualActionProvider): boolean {
    return provider === 'google_ads'
      ? this.googleWritesEnabled
      : this.writesEnabled;
  }
}
