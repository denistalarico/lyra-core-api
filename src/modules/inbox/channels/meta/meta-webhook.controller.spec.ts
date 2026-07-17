import { UnauthorizedException } from '@nestjs/common';
import { createHmac } from 'crypto';
import { MetaWebhookController } from './meta-webhook.controller';

describe('MetaWebhookController signature validation', () => {
  const previousSecret = process.env.META_APP_SECRET;
  const rawBody = Buffer.from('{"object":"whatsapp_business_account"}');
  const adapter = {
    normalize: jest.fn().mockResolvedValue({ messages: [] }),
    normalizeStatuses: jest.fn().mockResolvedValue({ statuses: [] }),
  };
  const ingestion = { ingest: jest.fn() };
  const webhookLog = { create: jest.fn().mockResolvedValue(undefined) };
  const statusSync = { applyStatusUpdate: jest.fn() };
  const controller = new MetaWebhookController(
    adapter as never,
    ingestion as never,
    webhookLog as never,
    statusSync as never,
  );

  beforeEach(() => {
    process.env.META_APP_SECRET = 'test-secret';
    jest.clearAllMocks();
  });
  afterAll(() => {
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
  });

  it('accepts a valid HMAC and processes the sanitized envelope', async () => {
    const signature = `sha256=${createHmac('sha256', 'test-secret').update(rawBody).digest('hex')}`;
    await expect(
      controller.receiveWebhook(signature, { rawBody } as never, {
        object: 'whatsapp_business_account',
      }),
    ).resolves.toMatchObject({ ok: true, signatureReceived: true });
    expect(webhookLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ payload: {} }),
    );
  });

  it.each([undefined, 'sha256=deadbeef'])(
    'rejects an absent or invalid signature',
    async (signature) => {
      await expect(
        controller.receiveWebhook(signature, { rawBody } as never, {}),
      ).rejects.toBeInstanceOf(UnauthorizedException);
      expect(adapter.normalize).not.toHaveBeenCalled();
    },
  );
});
