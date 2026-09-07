import { Injectable } from '@nestjs/common';
import type { SocialPublisherAdapter } from './social-publisher.adapter';

export class UnregisteredSocialPublisherError extends Error {
  constructor(
    readonly provider: string,
    readonly assetType: string,
  ) {
    super(
      `No SocialPublisherAdapter registered for provider "${provider}" and asset type "${assetType}"`,
    );
    this.name = 'UnregisteredSocialPublisherError';
  }
}

/**
 * Resolves a provider + asset-type pair to its adapter. Fails loudly — never
 * a silent no-op adapter. The asset type is part of the key because one OAuth
 * provider can expose publication surfaces with different workflows.
 *
 * Starts empty and is populated at runtime via `register()` — never through
 * the constructor. An injected array constructor parameter is indistinguishable
 * from a DI token to Nest's reflection and breaks application boot the moment
 * this class is wired into a real module (no `@Inject` target resolves to a
 * bare `Array`).
 */
@Injectable()
export class SocialPublisherRegistry {
  private readonly adapters = new Map<string, SocialPublisherAdapter>();

  register(adapter: SocialPublisherAdapter): void {
    for (const assetType of adapter.assetTypes) {
      this.adapters.set(this.key(adapter.provider, assetType), adapter);
    }
  }

  resolve(provider: string, assetType: string): SocialPublisherAdapter {
    const adapter = this.adapters.get(this.key(provider, assetType));
    if (!adapter) {
      throw new UnregisteredSocialPublisherError(provider, assetType);
    }
    return adapter;
  }

  has(provider: string, assetType: string): boolean {
    return this.adapters.has(this.key(provider, assetType));
  }

  get registeredProviders(): readonly string[] {
    return [
      ...new Set([...this.adapters.values()].map(({ provider }) => provider)),
    ];
  }

  private key(provider: string, assetType: string): string {
    return `${provider}\u0000${assetType}`;
  }
}
