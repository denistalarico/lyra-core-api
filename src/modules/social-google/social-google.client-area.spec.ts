import 'reflect-metadata';
import { CLIENT_AREA_EXPOSED_METADATA } from '../../common/client-area-bridge/client-area-bridge.registry';
import { CLIENT_AREA_INTEGRATION_PROVIDERS } from '../client-area/controllers/client-area-product-settings.controller';
import { SocialGoogleController } from './social-google.controller';

/**
 * Client Area is deliberately not supported for Google in this phase.
 *
 * Meta binds a pending OAuth session to a Client Area session
 * (`assertOAuthBinding`) because the client's own members can start it. Google
 * has no such entry point: no route opts in with `ClientAreaExposed`, so a
 * `typ: client_area` token falls through to the agency strategy and is
 * rejected, and the Client Area provider list has no Google provider. These
 * tests fail if either door is opened without adding the binding.
 */
describe('Google OAuth and the Client Area', () => {
  it('exposes no route to the Client Area bridge', () => {
    const proto = SocialGoogleController.prototype as unknown as Record<
      string,
      unknown
    >;
    const handlers = Object.getOwnPropertyNames(proto).filter(
      (name) => name !== 'constructor' && typeof proto[name] === 'function',
    );
    expect(handlers.length).toBeGreaterThanOrEqual(6);
    for (const name of handlers) {
      expect(
        Reflect.getMetadata(
          CLIENT_AREA_EXPOSED_METADATA,
          proto[name] as object,
        ),
      ).toBeUndefined();
    }
  });

  it('offers no Google provider to Client Area integrations', () => {
    expect(
      (CLIENT_AREA_INTEGRATION_PROVIDERS as readonly string[]).some((p) =>
        p.toLowerCase().includes('google'),
      ),
    ).toBe(false);
  });
});
