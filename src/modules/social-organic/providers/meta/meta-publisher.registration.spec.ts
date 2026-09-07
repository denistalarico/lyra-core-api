import { SocialPublisherRegistry } from '../social-publisher.registry';
import type { FacebookPublisherAdapter } from './facebook-publisher.adapter';
import type { InstagramPublisherAdapter } from './instagram-publisher.adapter';
import { MetaPublisherRegistration } from './meta-publisher.registration';

describe('MetaPublisherRegistration', () => {
  it('registers Facebook and Instagram separately under the shared meta provider', () => {
    const registry = new SocialPublisherRegistry();
    const facebook = {
      provider: 'meta',
      assetTypes: ['facebook_page'],
    } as unknown as FacebookPublisherAdapter;
    const instagram = {
      provider: 'meta',
      assetTypes: ['instagram_professional'],
    } as unknown as InstagramPublisherAdapter;
    const registration = new MetaPublisherRegistration(
      registry,
      facebook,
      instagram,
    );

    registration.onModuleInit();

    expect(registry.resolve('meta', 'facebook_page')).toBe(facebook);
    expect(registry.resolve('meta', 'instagram_professional')).toBe(instagram);
    expect(registry.registeredProviders).toEqual(['meta']);
  });
});
