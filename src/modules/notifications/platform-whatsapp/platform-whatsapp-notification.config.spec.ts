import { EnvPlatformWhatsAppNotificationConfigProvider } from './platform-whatsapp-notification.config';

function provider(env: NodeJS.ProcessEnv) {
  return new EnvPlatformWhatsAppNotificationConfigProvider(env).get();
}

describe('EnvPlatformWhatsAppNotificationConfigProvider', () => {
  it('is disabled by default (no env)', () => {
    const config = provider({});
    expect(config.enabled).toBe(false);
    expect(config.defaultLanguageCode).toBe('pt_BR');
    expect(config.apiVersion).toBe('v24.0');
  });

  it('stays disabled when the switch is on but a credential is missing', () => {
    const config = provider({
      PLATFORM_WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 'token',
      // no phone number id
    });
    expect(config.enabled).toBe(false);
  });

  it('enables only with the switch and both credentials present', () => {
    const config = provider({
      PLATFORM_WHATSAPP_NOTIFICATIONS_ENABLED: 'true',
      WHATSAPP_ACCESS_TOKEN: 'token',
      WHATSAPP_PHONE_NUMBER_ID: '123456',
    });
    expect(config.enabled).toBe(true);
    expect(config.accessToken).toBe('token');
    expect(config.phoneNumberId).toBe('123456');
  });

  it('reuses META_GRAPH_API_VERSION', () => {
    const config = provider({ META_GRAPH_API_VERSION: 'v25.0' });
    expect(config.apiVersion).toBe('v25.0');
  });
});
