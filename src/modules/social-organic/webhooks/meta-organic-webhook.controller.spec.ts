import {
  BadRequestException,
  ForbiddenException,
  ServiceUnavailableException,
  UnauthorizedException,
} from '@nestjs/common';
import type { RawBodyRequest } from '@nestjs/common';
import type { Request } from 'express';
import { createHmac } from 'node:crypto';
import { MetaOrganicWebhookController } from './meta-organic-webhook.controller';
import { MetaOrganicWebhookSignatureService } from './meta-organic-webhook-signature.service';
import { SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV } from './meta-organic-webhook.support';

const APP_SECRET = 'social-organic-app-secret';
const VERIFY_TOKEN = 'organic-verify-token';

function sign(body: string, secret = APP_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function requestWith(body: string): RawBodyRequest<Request> {
  return { rawBody: Buffer.from(body, 'utf8') } as RawBodyRequest<Request>;
}

describe('MetaOrganicWebhookController', () => {
  const previous = {
    secret: process.env.SOCIAL_META_APP_SECRET,
    legacy: process.env.SOCIAL_META_ADS_APP_SECRET,
    verify: process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV],
  };

  let webhooks: { ingest: jest.Mock };
  let controller: MetaOrganicWebhookController;

  const body = JSON.stringify({
    object: 'page',
    entry: [{ id: 'page-1', time: 1757000000, changes: [{ field: 'feed' }] }],
  });

  beforeEach(() => {
    process.env.SOCIAL_META_APP_SECRET = APP_SECRET;
    delete process.env.SOCIAL_META_ADS_APP_SECRET;
    process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV] = VERIFY_TOKEN;

    webhooks = {
      ingest: jest.fn().mockResolvedValue({
        eventId: 'event-1',
        duplicate: false,
        scopeResolution: 'resolved',
      }),
    };
    controller = new MetaOrganicWebhookController(
      new MetaOrganicWebhookSignatureService(),
      webhooks as never,
    );
  });

  afterAll(() => {
    for (const [key, value] of [
      ['SOCIAL_META_APP_SECRET', previous.secret],
      ['SOCIAL_META_ADS_APP_SECRET', previous.legacy],
      [SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV, previous.verify],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  describe('GET verification', () => {
    it('returns the challenge verbatim for a correct handshake', () => {
      expect(controller.verify('subscribe', VERIFY_TOKEN, '1158201444')).toBe(
        '1158201444',
      );
    });

    it('rejects a wrong verify token with 403', () => {
      expect(() =>
        controller.verify('subscribe', 'wrong-token', '1158201444'),
      ).toThrow(ForbiddenException);
    });

    it('rejects the Messaging app token', () => {
      process.env.META_WEBHOOK_VERIFY_TOKEN = 'messaging-token';

      expect(() =>
        controller.verify('subscribe', 'messaging-token', '1158201444'),
      ).toThrow(ForbiddenException);

      delete process.env.META_WEBHOOK_VERIFY_TOKEN;
    });

    it('rejects missing or wrong parameters with 400', () => {
      expect(() =>
        controller.verify(undefined, VERIFY_TOKEN, '1158201444'),
      ).toThrow(BadRequestException);
      expect(() =>
        controller.verify('unsubscribe', VERIFY_TOKEN, '1158201444'),
      ).toThrow(BadRequestException);
      expect(() => controller.verify('subscribe', VERIFY_TOKEN, '')).toThrow(
        BadRequestException,
      );
      expect(() =>
        controller.verify('subscribe', VERIFY_TOKEN, undefined),
      ).toThrow(BadRequestException);
    });

    it('rejects a missing token before comparing anything', () => {
      expect(() =>
        controller.verify('subscribe', undefined, '1158201444'),
      ).toThrow(ForbiddenException);
    });

    it('refuses to verify when no verify token is configured', () => {
      delete process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV];

      expect(() =>
        controller.verify('subscribe', VERIFY_TOKEN, '1158201444'),
      ).toThrow(ServiceUnavailableException);
    });

    it('never echoes the verify token in a rejection', () => {
      try {
        controller.verify('subscribe', 'wrong-token', '1158201444');
      } catch (error) {
        expect((error as Error).message).not.toContain(VERIFY_TOKEN);
        expect((error as Error).message).not.toContain('wrong-token');
      }
    });
  });

  describe('POST delivery', () => {
    it('persists a validly signed event and returns 200', async () => {
      const result = await controller.receive(sign(body), requestWith(body));

      expect(result).toEqual({ ok: true, duplicate: false });

      const [ingested] = webhooks.ingest.mock.calls[0] as [
        {
          provider: string;
          eventKey: string;
          objectType: string;
          externalAssetId: string | null;
          rawPayload: Record<string, unknown>;
        },
      ];
      expect(ingested.provider).toBe('meta');
      expect(ingested.eventKey).toMatch(/^meta:sha256:[0-9a-f]{64}$/);
      expect(ingested.objectType).toBe('page');
      expect(ingested.externalAssetId).toBe('page-1');
      expect(ingested.rawPayload).toEqual(
        JSON.parse(body) as Record<string, unknown>,
      );
    });

    it('acknowledges an unknown but validly signed event', async () => {
      const unknown = JSON.stringify({
        object: 'some_future_object',
        entry: [{ id: 'page-1', changes: [{ field: 'not_yet_supported' }] }],
      });

      await expect(
        controller.receive(sign(unknown), requestWith(unknown)),
      ).resolves.toEqual({ ok: true, duplicate: false });
      expect(webhooks.ingest).toHaveBeenCalledWith(
        expect.objectContaining({ objectType: 'some_future_object' }),
      );
    });

    it('reports a duplicate delivery as acknowledged', async () => {
      webhooks.ingest.mockResolvedValue({
        eventId: 'event-1',
        duplicate: true,
        scopeResolution: 'resolved',
      });

      await expect(
        controller.receive(sign(body), requestWith(body)),
      ).resolves.toEqual({ ok: true, duplicate: true });
    });

    it('never persists an invalidly signed delivery', async () => {
      for (const header of [
        sign(body, 'wrong-secret'),
        undefined,
        'garbage',
        'sha256=short',
        sign('{"object":"page"}'),
      ]) {
        await expect(
          controller.receive(header, requestWith(body)),
        ).rejects.toThrow(UnauthorizedException);
      }

      expect(webhooks.ingest).not.toHaveBeenCalled();
    });

    it('rejects a body altered after signing', async () => {
      const signature = sign(body);
      const mutated = body.replace('page-1', 'page-2');

      await expect(
        controller.receive(signature, requestWith(mutated)),
      ).rejects.toThrow(UnauthorizedException);
      expect(webhooks.ingest).not.toHaveBeenCalled();
    });

    it('refuses with 503 when the app secret is not configured', async () => {
      delete process.env.SOCIAL_META_APP_SECRET;

      await expect(
        controller.receive(sign(body), requestWith(body)),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(webhooks.ingest).not.toHaveBeenCalled();
    });

    it('refuses with 503 when the raw body was not preserved', async () => {
      await expect(
        controller.receive(sign(body), {} as RawBodyRequest<Request>),
      ).rejects.toThrow(ServiceUnavailableException);
      expect(webhooks.ingest).not.toHaveBeenCalled();
    });

    it('leaks no internal reason to the caller', async () => {
      for (const header of [undefined, 'garbage', sign(body, 'wrong-secret')]) {
        await controller
          .receive(header, requestWith(body))
          .catch((error: Error) => {
            expect(error.message).toBe(
              'Invalid Meta organic webhook signature.',
            );
            expect(error.message).not.toContain(APP_SECRET);
            expect(error.message).not.toContain('mismatch');
            expect(error.message).not.toContain('malformed');
          });
      }
    });

    it('stores the signed bytes, not a re-serialization', async () => {
      // Key order differs from JSON.stringify's output for the same document.
      const spaced = '{"entry": [{"id": "page-1"}], "object": "page"}';

      await controller.receive(sign(spaced), requestWith(spaced));

      expect(webhooks.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          rawPayload: { entry: [{ id: 'page-1' }], object: 'page' },
        }),
      );
    });

    it('acknowledges a signed non-object body without storing junk', async () => {
      const arrayBody = '[1,2,3]';

      await expect(
        controller.receive(sign(arrayBody), requestWith(arrayBody)),
      ).resolves.toEqual({ ok: true, duplicate: false });
      expect(webhooks.ingest).toHaveBeenCalledWith(
        expect.objectContaining({
          rawPayload: {},
          objectType: 'unknown',
          externalAssetId: null,
        }),
      );
    });

    it('does no semantic work inside the request', async () => {
      // The handler's only collaborators are the signature service and the
      // durable receipt. Anything heavier — Graph, analytics, publishing,
      // notifications — would delay the ACK and earn provider retries.
      await controller.receive(sign(body), requestWith(body));

      expect(webhooks.ingest).toHaveBeenCalledTimes(1);
      expect(Object.keys(webhooks)).toEqual(['ingest']);
    });
  });
});
