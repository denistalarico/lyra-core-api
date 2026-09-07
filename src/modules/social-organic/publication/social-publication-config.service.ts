import { Injectable } from '@nestjs/common';

export const SOCIAL_PUBLICATION_ENABLED_ENV = 'SOCIAL_PUBLICATION_ENABLED';

/**
 * Fail-closed configuration for publication execution.
 *
 * Both the global switch and the switch for a provider must be explicitly
 * enabled. Environment changes require an API restart; reading process.env on
 * every call is intentional for deterministic tests and a future runtime
 * settings boundary, not file watching.
 */
@Injectable()
export class SocialPublicationConfigService {
  /** Stops every worker cycle before it can recover or lease a publication. */
  get enabled(): boolean {
    return this.readEnabled(SOCIAL_PUBLICATION_ENABLED_ENV);
  }

  /**
   * The provider key stays open-ended, matching SocialPublication.provider.
   * For example, provider `meta` reads `SOCIAL_PUBLICATION_META_ENABLED`.
   */
  isProviderEnabled(provider: string): boolean {
    return this.readEnabled(this.providerEnabledEnv(provider));
  }

  providerEnabledEnv(provider: string): string {
    const normalized = provider
      .trim()
      .toUpperCase()
      .replace(/[^A-Z0-9]+/g, '_')
      .replace(/^_+|_+$/g, '');

    return `SOCIAL_PUBLICATION_${normalized}_ENABLED`;
  }

  private readEnabled(name: string): boolean {
    // `||` deliberately treats FOO= as disabled. `??` would not.
    const raw = process.env[name]?.trim().toLowerCase() || '';

    return ['true', '1', 'yes', 'on'].includes(raw);
  }
}
