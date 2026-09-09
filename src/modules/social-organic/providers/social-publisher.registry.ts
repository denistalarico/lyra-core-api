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

  /**
   * Every registered `(provider, assetType)` pair.
   *
   * Exists so the capability read endpoint (E3) can answer "what may this
   * workspace even attempt" from the registry rather than importing a
   * provider's static declaration directly. Reading Meta's constants would
   * make the UI's list of formats and the validator's list of formats two
   * different things the day a provider is added or an adapter is unregistered
   * behind a flag — and the UI's copy would be the one that lies.
   *
   * Pairs, not adapters: one adapter may serve several asset types, and a
   * caller enumerating capabilities needs each pair separately because
   * `capabilities()` takes an asset type.
   *
   * Derived from the adapters themselves rather than by splitting the map key
   * — the key's separator is an implementation detail of `key()` and parsing
   * it back would silently break if that ever changed.
   */
  get registeredPairs(): readonly { provider: string; assetType: string }[] {
    return [...new Set(this.adapters.values())].flatMap((adapter) =>
      adapter.assetTypes.map((assetType) => ({
        provider: adapter.provider,
        assetType,
      })),
    );
  }

  private key(provider: string, assetType: string): string {
    return `${provider}\u0000${assetType}`;
  }
}
