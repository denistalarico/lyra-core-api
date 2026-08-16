import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createHmac } from 'crypto';
import request from 'supertest';
import { MetaWebhookController } from './meta-webhook.controller';
import { WhatsAppMetaAdapter } from './adapters/whatsapp-meta.adapter';
import { InstagramMetaAdapter } from './adapters/instagram-meta.adapter';
import { InboundMessageIngestionService } from '../services/inbound-message-ingestion.service';
import { WebhookLogService } from '../services/webhook-log.service';
import { MessageStatusSyncService } from '../services/message-status-sync.service';

describe('MetaWebhookController raw body integration', () => {
  const previousSecret = process.env.META_APP_SECRET;
  const previousInstagramSecret = process.env.META_INSTAGRAM_APP_SECRET;
  let app: NestExpressApplication;

  beforeAll(async () => {
    process.env.META_APP_SECRET = 'whatsapp-secret';
    process.env.META_INSTAGRAM_APP_SECRET = 'instagram-secret';
    const moduleRef = await Test.createTestingModule({
      controllers: [MetaWebhookController],
      providers: [
        {
          provide: WhatsAppMetaAdapter,
          useValue: {
            normalize: jest.fn().mockResolvedValue({ messages: [] }),
            normalizeStatuses: jest.fn().mockResolvedValue({ statuses: [] }),
          },
        },
        {
          provide: InstagramMetaAdapter,
          useValue: {
            normalize: jest.fn().mockResolvedValue({ messages: [] }),
          },
        },
        {
          provide: InboundMessageIngestionService,
          useValue: { ingest: jest.fn() },
        },
        {
          provide: WebhookLogService,
          useValue: { create: jest.fn().mockResolvedValue(undefined) },
        },
        {
          provide: MessageStatusSyncService,
          useValue: { applyStatusUpdate: jest.fn() },
        },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app.useBodyParser('json', { limit: '10mb' });
    app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    if (previousSecret === undefined) delete process.env.META_APP_SECRET;
    else process.env.META_APP_SECRET = previousSecret;
    if (previousInstagramSecret === undefined) {
      delete process.env.META_INSTAGRAM_APP_SECRET;
    } else {
      process.env.META_INSTAGRAM_APP_SECRET = previousInstagramSecret;
    }
  });

  it('preserves the exact JSON bytes for Meta HMAC validation', async () => {
    const body = JSON.stringify({
      object: 'whatsapp_business_account',
      entry: [],
    });
    const signature = `sha256=${createHmac('sha256', 'whatsapp-secret')
      .update(body)
      .digest('hex')}`;

    await request(app.getHttpServer())
      .post('/api/inbox/channels/meta/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(body)
      .expect(200)
      .expect(({ body: responseBody }) => {
        expect(responseBody).toMatchObject({
          ok: true,
          signatureReceived: true,
          messagesProcessed: 0,
        });
      });
  });

  it('uses the Instagram app secret without changing the raw JSON bytes', async () => {
    const body = JSON.stringify({ object: 'instagram', entry: [] });
    const signature = `sha256=${createHmac('sha256', 'instagram-secret')
      .update(body)
      .digest('hex')}`;

    await request(app.getHttpServer())
      .post('/api/inbox/channels/meta/webhook')
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', signature)
      .send(body)
      .expect(200)
      .expect(({ body: responseBody }) => {
        expect(responseBody).toMatchObject({
          ok: true,
          signatureReceived: true,
          messagesProcessed: 0,
        });
      });
  });
});
