import { Injectable } from '@nestjs/common';
import type { SocialPublisherAdapter } from './social-publisher.adapter';

export class UnregisteredSocialPublisherError extends Error {
  constructor(readonly provider: string) {
    super(`No SocialPublisherAdapter registered for provider "${provider}"`);
    this.name = 'UnregisteredSocialPublisherError';
  }
}

/**
 * Resolves a provider key to its adapter. Fails loudly — never a silent no-op
 * adapter.
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
    this.adapters.set(adapter.provider, adapter);
  }

  resolve(provider: string): SocialPublisherAdapter {
    const adapter = this.adapters.get(provider);
    if (!adapter) throw new UnregisteredSocialPublisherError(provider);
    return adapter;
  }

  has(provider: string): boolean {
    return this.adapters.has(provider);
  }

  get registeredProviders(): readonly string[] {
    return [...this.adapters.keys()];
  }
}
