import { Inject, Injectable, Optional } from '@nestjs/common';
import type { ResolvedOrganicAnalyticsCredential } from '../credentials/social-organic-credential.resolver';
import type { SocialOrganicSyncRunCounters } from './social-organic-sync-run.service';

export const SOCIAL_ORGANIC_ANALYTICS_PROVIDERS = Symbol(
  'SOCIAL_ORGANIC_ANALYTICS_PROVIDERS',
);

export type SocialOrganicAnalyticsSyncInput = {
  resolved: ResolvedOrganicAnalyticsCredential;
  fromDate: string;
  toDate: string;
  syncRunId: string;
  /**
   * Run counters, added to as the sync goes, so a run that fails midway
   * still reports the rows and API calls it spent.
   */
  counters: SocialOrganicSyncRunCounters;
};

/**
 * D-I4 (b): one implementation per provider behind the organic analytics
 * worker. The worker owns the queue, scope and retry policy; a provider owns
 * everything between a resolved credential and the metric tables. Throwing
 * fails or requeues the run (see `classifyOrganicSyncFailure`).
 */
export interface SocialOrganicAnalyticsProvider {
  /** Persisted `provider` keys of the assets this implementation syncs. */
  readonly providers: readonly string[];
  sync(input: SocialOrganicAnalyticsSyncInput): Promise<void>;
}

@Injectable()
export class SocialOrganicAnalyticsProviderRegistry {
  private readonly byProvider: ReadonlyMap<
    string,
    SocialOrganicAnalyticsProvider
  >;

  constructor(
    @Optional()
    @Inject(SOCIAL_ORGANIC_ANALYTICS_PROVIDERS)
    providers: readonly SocialOrganicAnalyticsProvider[] = [],
  ) {
    const byProvider = new Map<string, SocialOrganicAnalyticsProvider>();
    for (const implementation of providers) {
      for (const provider of implementation.providers) {
        if (!provider.trim() || byProvider.has(provider)) {
          throw new Error('Organic analytics provider keys must be unique.');
        }
        byProvider.set(provider, implementation);
      }
    }
    this.byProvider = byProvider;
  }

  find(provider: string): SocialOrganicAnalyticsProvider | undefined {
    return this.byProvider.get(provider);
  }
}
