/* eslint-disable @typescript-eslint/require-await -- the fake adapter mirrors the async adapter contract. */
import {
  SocialPublisherRegistry,
  UnregisteredSocialPublisherError,
} from './social-publisher.registry';
import type { SocialPublisherAdapter } from './social-publisher.adapter';
import type { PublisherCapabilities } from './provider-capabilities';

function fakeAdapter(provider: string): SocialPublisherAdapter {
  return {
    provider,
    capabilities: (): PublisherCapabilities => ({
      provider,
      assetType: 'facebook_page',
      placements: ['feed'],
      media: { feed: { acceptedMimeTypes: ['image/jpeg'], maxBytes: 1 } },
      supportsScheduling: true,
      supportsCaption: true,
      supportsFirstComment: false,
      supportsHashtags: false,
      requiresReconciliation: false,
      supportsRemoval: false,
    }),
    validate: () => ({ valid: true }),
    prepareMedia: async () => ({ providerMediaRef: 'ref', expiresAt: null }),
    publish: async () => ({
      outcome: 'published',
      externalPublicationId: 'id',
      externalPermalink: null,
      publishedAt: new Date(),
      providerMetadata: {},
    }),
  };
}

describe('SocialPublisherRegistry', () => {
  it('starts empty', () => {
    const registry = new SocialPublisherRegistry();

    expect(registry.registeredProviders).toEqual([]);
  });

  it('resolves an adapter registered by provider key', () => {
    const registry = new SocialPublisherRegistry();
    const meta = fakeAdapter('meta');
    registry.register(meta);

    expect(registry.resolve('meta')).toBe(meta);
    expect(registry.has('meta')).toBe(true);
    expect(registry.registeredProviders).toEqual(['meta']);
  });

  it('fails loudly for an unregistered provider instead of returning undefined', () => {
    const registry = new SocialPublisherRegistry();
    registry.register(fakeAdapter('meta'));

    expect(() => registry.resolve('tiktok')).toThrow(
      UnregisteredSocialPublisherError,
    );
    expect(registry.has('tiktok')).toBe(false);
  });

  it('register() adds an adapter after construction', () => {
    const registry = new SocialPublisherRegistry();
    const youtube = fakeAdapter('youtube');

    registry.register(youtube);

    expect(registry.resolve('youtube')).toBe(youtube);
  });

  it('a later registration for the same provider key replaces the earlier one', () => {
    const registry = new SocialPublisherRegistry();
    const first = fakeAdapter('meta');
    const second = fakeAdapter('meta');

    registry.register(first);
    registry.register(second);

    expect(registry.resolve('meta')).toBe(second);
    expect(registry.registeredProviders).toEqual(['meta']);
  });
});
