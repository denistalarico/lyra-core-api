import type {
  PlatformWhatsAppNotificationConfig,
  PlatformWhatsAppNotificationConfigProvider,
} from './platform-whatsapp-notification.config';
import {
  buildPlatformWhatsAppDeliveryKey,
  PlatformWhatsAppNotificationSender,
  type PlatformWhatsAppSendInput,
} from './platform-whatsapp-notification.sender';

const TOKEN = 'super-secret-token';

function config(
  overrides: Partial<PlatformWhatsAppNotificationConfig> = {},
): PlatformWhatsAppNotificationConfig {
  return {
    enabled: true,
    accessToken: TOKEN,
    phoneNumberId: '111222',
    apiVersion: 'v24.0',
    defaultLanguageCode: 'pt_BR',
    ...overrides,
  };
}

function build(cfg: PlatformWhatsAppNotificationConfig) {
  const provider: PlatformWhatsAppNotificationConfigProvider = {
    get: () => cfg,
  };
  return new PlatformWhatsAppNotificationSender(provider);
}

function input(
  overrides: Partial<PlatformWhatsAppSendInput> = {},
): PlatformWhatsAppSendInput {
  return {
    toPhoneE164: '+5511999998888',
    templateKey: 'leadflow.handoff.requested',
    variables: {
      workspaceName: 'Acme',
      contactDisplayName: 'João',
      handoffReason: 'Pediu humano',
    },
    ...overrides,
  };
}

const realFetch = global.fetch;
afterEach(() => {
  global.fetch = realFetch;
  jest.restoreAllMocks();
});

function mockFetch(impl: jest.Mock) {
  global.fetch = impl as unknown as typeof fetch;
  return impl;
}

describe('PlatformWhatsAppNotificationSender', () => {
  it('skips without attempting a send when the provider is disabled', async () => {
    const fetchMock = mockFetch(jest.fn());
    const sender = build(config({ enabled: false }));

    const outcome = await sender.sendTemplate(input());

    expect(outcome).toEqual({ status: 'skipped', reasonCode: 'provider_disabled' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips an invalid recipient', async () => {
    const fetchMock = mockFetch(jest.fn());
    const sender = build(config());

    const outcome = await sender.sendTemplate(input({ toPhoneE164: 'abc' }));

    expect(outcome).toEqual({ status: 'skipped', reasonCode: 'invalid_recipient' });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('skips when the logical template resolves to nothing', async () => {
    const fetchMock = mockFetch(jest.fn());
    const sender = build(config());

    const outcome = await sender.sendTemplate(
      input({ templateKey: 'leadflow.unknown' }),
    );

    expect(outcome).toEqual({
      status: 'skipped',
      reasonCode: 'template_unavailable',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends the physical template with body params in order and no button', async () => {
    const fetchMock = mockFetch(
      jest.fn().mockResolvedValue({
        ok: true,
        json: async () => ({ messages: [{ id: 'wamid.XYZ' }] }),
      }),
    );
    const sender = build(config());

    const outcome = await sender.sendTemplate(input());

    expect(outcome).toEqual({ status: 'sent', providerMessageId: 'wamid.XYZ' });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://graph.facebook.com/v24.0/111222/messages');
    expect((init.headers as Record<string, string>).Authorization).toBe(
      `Bearer ${TOKEN}`,
    );

    const payload = JSON.parse(init.body as string);
    expect(payload.type).toBe('template');
    expect(payload.to).toBe('5511999998888');
    expect(payload.template.name).toBe('lyra_leadflow_handoff_alert_v1');
    expect(payload.template.language.code).toBe('pt_BR');
    expect(payload.template.components).toHaveLength(1);
    expect(payload.template.components[0].type).toBe('body');
    expect(payload.template.components[0].parameters).toEqual([
      { type: 'text', text: 'Acme' },
      { type: 'text', text: 'João' },
      { type: 'text', text: 'Pediu humano' },
    ]);
    // No button/URL component is ever attached.
    const hasButton = payload.template.components.some(
      (component: { type: string }) => component.type === 'button',
    );
    expect(hasButton).toBe(false);
  });

  it('returns a sanitized failure on a Meta error and never surfaces the token', async () => {
    mockFetch(
      jest.fn().mockResolvedValue({
        ok: false,
        json: async () => ({
          error: { code: 131047, message: 'Re-engagement message' },
        }),
      }),
    );
    const sender = build(config());

    const outcome = await sender.sendTemplate(input());

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.providerCode).toBe('131047');
      expect(outcome.message).toContain('Re-engagement');
    }
    expect(JSON.stringify(outcome)).not.toContain(TOKEN);
  });

  it('returns a code-less failure on a transport error', async () => {
    mockFetch(jest.fn().mockRejectedValue(new Error('ECONNRESET')));
    const sender = build(config());

    const outcome = await sender.sendTemplate(input());

    expect(outcome.status).toBe('failed');
    if (outcome.status === 'failed') {
      expect(outcome.providerCode).toBeNull();
      expect(outcome.message).not.toContain('ECONNRESET');
    }
  });
});

describe('buildPlatformWhatsAppDeliveryKey', () => {
  it('is deterministic across the full idempotency tuple', () => {
    const base = {
      tenantId: 't1',
      workspaceId: 'w1',
      subjectId: 'conv-1',
      handoffCycleId: 3,
      recipientUserId: 'user-1',
      templateKey: 'leadflow.handoff.requested',
    };
    expect(buildPlatformWhatsAppDeliveryKey(base)).toBe(
      buildPlatformWhatsAppDeliveryKey(base),
    );
    expect(buildPlatformWhatsAppDeliveryKey(base)).not.toBe(
      buildPlatformWhatsAppDeliveryKey({ ...base, handoffCycleId: 4 }),
    );
  });
});
