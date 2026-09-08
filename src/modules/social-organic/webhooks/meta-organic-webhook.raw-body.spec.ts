import type { NestExpressApplication } from '@nestjs/platform-express';
import { Test } from '@nestjs/testing';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { MetaOrganicWebhookController } from './meta-organic-webhook.controller';
import { MetaOrganicWebhookSignatureService } from './meta-organic-webhook-signature.service';
import { SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV } from './meta-organic-webhook.support';
import { SocialOrganicWebhookService } from './social-organic-webhook.service';

const APP_SECRET = 'social-organic-app-secret';
const VERIFY_TOKEN = 'organic-verify-token';
const PATH = '/api/social/organic/webhooks/meta';

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

/**
 * The end-to-end proof that the bytes Express delivers are the bytes the
 * signature covers, over the real HTTP stack and the real global prefix — the
 * one thing a unit test with a hand-built Buffer cannot establish.
 */
describe('Meta organic webhook over HTTP', () => {
  const previous = {
    secret: process.env.SOCIAL_META_APP_SECRET,
    legacy: process.env.SOCIAL_META_ADS_APP_SECRET,
    verify: process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV],
  };

  const ingest = jest.fn();
  let app: NestExpressApplication;

  beforeAll(async () => {
    process.env.SOCIAL_META_APP_SECRET = APP_SECRET;
    delete process.env.SOCIAL_META_ADS_APP_SECRET;
    process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV] = VERIFY_TOKEN;

    const moduleRef = await Test.createTestingModule({
      controllers: [MetaOrganicWebhookController],
      providers: [
        MetaOrganicWebhookSignatureService,
        { provide: SocialOrganicWebhookService, useValue: { ingest } },
      ],
    }).compile();

    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    // Mirrors main.ts exactly: the same parsers and the same global prefix.
    app.useBodyParser('json', { limit: '10mb' });
    app.useBodyParser('urlencoded', { extended: true, limit: '10mb' });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => {
    await app.close();
    for (const [key, value] of [
      ['SOCIAL_META_APP_SECRET', previous.secret],
      ['SOCIAL_META_ADS_APP_SECRET', previous.legacy],
      [SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV, previous.verify],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  beforeEach(() => {
    ingest.mockReset();
    ingest.mockResolvedValue({
      eventId: 'event-1',
      duplicate: false,
      scopeResolution: 'resolved',
    });
  });

  it('answers the verification handshake with the challenge as plain text', async () => {
    await request(app.getHttpServer())
      .get(PATH)
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': VERIFY_TOKEN,
        'hub.challenge': '1158201444',
      })
      .expect(200)
      .expect('1158201444');
  });

  it('rejects a wrong verify token with 403 and no challenge', async () => {
    const response = await request(app.getHttpServer())
      .get(PATH)
      .query({
        'hub.mode': 'subscribe',
        'hub.verify_token': 'wrong-token',
        'hub.challenge': '1158201444',
      })
      .expect(403);

    expect(JSON.stringify(response.body)).not.toContain('1158201444');
    expect(JSON.stringify(response.body)).not.toContain(VERIFY_TOKEN);
  });

  it('rejects a handshake missing hub.challenge with 400', async () => {
    await request(app.getHttpServer())
      .get(PATH)
      .query({ 'hub.mode': 'subscribe', 'hub.verify_token': VERIFY_TOKEN })
      .expect(400);
  });

  it('preserves the exact JSON bytes through the HTTP stack', async () => {
    // Whitespace and key order that JSON.stringify would not reproduce: the
    // signature only validates if the untouched bytes reached the handler.
    const body =
      '{"object": "page",  "entry":[{"id":"page-1","time":1757000000}]}';

    await request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body)
      .expect(200, { ok: true, duplicate: false });

    expect(ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'meta',
        objectType: 'page',
        externalAssetId: 'page-1',
      }),
    );
  });

  it('rejects a valid signature computed with the Messaging app secret', async () => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: 'page-1' }] });

    await request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body, 'messaging-app-secret'))
      .send(body)
      .expect(401);

    expect(ingest).not.toHaveBeenCalled();
  });

  it('rejects a delivery with no signature header', async () => {
    await request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .send(JSON.stringify({ object: 'page', entry: [] }))
      .expect(401);

    expect(ingest).not.toHaveBeenCalled();
  });

  it('acknowledges an unknown signed event with 200', async () => {
    const body = JSON.stringify({
      object: 'a_field_meta_adds_next_year',
      entry: [{ id: 'page-1' }],
    });

    await request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body)
      .expect(200, { ok: true, duplicate: false });
  });

  it('acknowledges a redelivery without reporting an error', async () => {
    const body = JSON.stringify({ object: 'page', entry: [{ id: 'page-1' }] });
    ingest.mockResolvedValue({
      eventId: 'event-1',
      duplicate: true,
      scopeResolution: 'resolved',
    });

    await request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body)
      .expect(200, { ok: true, duplicate: true });
  });

  it('exposes neither the raw payload nor a secret in any response', async () => {
    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: 'page-1', changes: [{ value: { text: 'private note' } }] }],
    });

    const response = await request(app.getHttpServer())
      .post(PATH)
      .set('content-type', 'application/json')
      .set('x-hub-signature-256', sign(body))
      .send(body)
      .expect(200);

    const serialized = JSON.stringify(response.body);
    expect(serialized).not.toContain('private note');
    expect(serialized).not.toContain(APP_SECRET);
    expect(serialized).not.toContain(VERIFY_TOKEN);
  });
});
