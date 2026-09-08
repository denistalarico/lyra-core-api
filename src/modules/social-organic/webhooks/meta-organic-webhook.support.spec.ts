import {
  SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV,
  buildMetaOrganicWebhookEventKey,
  readMetaOrganicWebhookVerifyToken,
  readMetaWebhookExternalAssetId,
  readMetaWebhookObjectType,
  verifyTokenMatches,
} from './meta-organic-webhook.support';

describe('Meta organic webhook support', () => {
  describe('verify token', () => {
    const previous = process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV];
    const previousMessaging = process.env.META_WEBHOOK_VERIFY_TOKEN;

    afterEach(() => {
      if (previous === undefined) {
        delete process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV];
      } else {
        process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV] = previous;
      }
      if (previousMessaging === undefined) {
        delete process.env.META_WEBHOOK_VERIFY_TOKEN;
      } else {
        process.env.META_WEBHOOK_VERIFY_TOKEN = previousMessaging;
      }
    });

    it('reads its own env var and never the Messaging one', () => {
      delete process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV];
      process.env.META_WEBHOOK_VERIFY_TOKEN = 'messaging-token';

      expect(readMetaOrganicWebhookVerifyToken()).toBeNull();

      process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV] =
        'organic-token';
      expect(readMetaOrganicWebhookVerifyToken()).toBe('organic-token');
    });

    it('treats an empty value as unconfigured', () => {
      process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV] = '';
      expect(readMetaOrganicWebhookVerifyToken()).toBeNull();

      process.env[SOCIAL_META_ORGANIC_WEBHOOK_VERIFY_TOKEN_ENV] = '   ';
      expect(readMetaOrganicWebhookVerifyToken()).toBeNull();
    });

    it('matches only the exact token', () => {
      expect(verifyTokenMatches('secret-token', 'secret-token')).toBe(true);
      expect(verifyTokenMatches('secret-toke', 'secret-token')).toBe(false);
      expect(verifyTokenMatches('secret-tokenX', 'secret-token')).toBe(false);
      expect(verifyTokenMatches('SECRET-TOKEN', 'secret-token')).toBe(false);
      expect(verifyTokenMatches(undefined, 'secret-token')).toBe(false);
      expect(verifyTokenMatches('', 'secret-token')).toBe(false);
    });

    it('compares tokens of differing lengths without throwing', () => {
      // Hashing both sides keeps the compared buffers 32 bytes, so a length
      // difference cannot reach timingSafeEqual and cannot leak either length.
      expect(() => verifyTokenMatches('a', 'a'.repeat(500))).not.toThrow();
      expect(verifyTokenMatches('a', 'a'.repeat(500))).toBe(false);
    });
  });

  describe('envelope reading', () => {
    it('reads the object type, defaulting to unknown', () => {
      expect(readMetaWebhookObjectType({ object: 'page' })).toBe('page');
      expect(readMetaWebhookObjectType({ object: 'instagram' })).toBe(
        'instagram',
      );
      expect(readMetaWebhookObjectType({})).toBe('unknown');
      expect(readMetaWebhookObjectType({ object: '' })).toBe('unknown');
      expect(readMetaWebhookObjectType({ object: 42 })).toBe('unknown');
      expect(readMetaWebhookObjectType(null)).toBe('unknown');
    });

    it('reads a single entry id as the external asset id', () => {
      expect(readMetaWebhookExternalAssetId({ entry: [{ id: '1784' }] })).toBe(
        '1784',
      );
      expect(readMetaWebhookExternalAssetId({ entry: [{ id: 1784 }] })).toBe(
        '1784',
      );
    });

    it('refuses to attribute a multi-entry batch to one asset', () => {
      expect(
        readMetaWebhookExternalAssetId({
          entry: [{ id: 'page-a' }, { id: 'page-b' }],
        }),
      ).toBeNull();
    });

    it('returns null when no entry id is present', () => {
      expect(readMetaWebhookExternalAssetId({})).toBeNull();
      expect(readMetaWebhookExternalAssetId({ entry: [] })).toBeNull();
      expect(readMetaWebhookExternalAssetId({ entry: [{}] })).toBeNull();
      expect(readMetaWebhookExternalAssetId({ entry: 'nope' })).toBeNull();
      expect(readMetaWebhookExternalAssetId(null)).toBeNull();
    });
  });

  describe('event key', () => {
    const build = (body: string, externalAssetId: string | null = 'page-1') =>
      buildMetaOrganicWebhookEventKey({
        objectType: 'page',
        externalAssetId,
        rawBody: Buffer.from(body, 'utf8'),
      });

    const body = JSON.stringify({
      object: 'page',
      entry: [{ id: 'page-1', time: 1757000000 }],
    });

    it('is deterministic for identical bytes', () => {
      expect(build(body)).toBe(build(body));
    });

    it('fits the column and is prefixed with how it was derived', () => {
      const key = build(body);

      expect(key).toMatch(/^meta:sha256:[0-9a-f]{64}$/);
      expect(key.length).toBeLessThanOrEqual(200);
    });

    it('differs when a single payload byte differs', () => {
      const other = JSON.stringify({
        object: 'page',
        entry: [{ id: 'page-1', time: 1757000001 }],
      });

      expect(build(body)).not.toBe(build(other));
    });

    it('differs across assets even for identical bytes', () => {
      expect(build(body, 'page-1')).not.toBe(build(body, 'page-2'));
      expect(build(body, 'page-1')).not.toBe(build(body, null));
    });

    it('does not depend on arrival time', () => {
      const first = build(body);
      jest.useFakeTimers().setSystemTime(new Date('2027-01-01T00:00:00Z'));
      const second = build(body);
      jest.useRealTimers();

      expect(second).toBe(first);
    });

    it('cannot be forged by shifting content across the joined fields', () => {
      // The separator makes ("page", "1") and ("pag", "e1") distinct inputs, so
      // two different deliveries cannot be made to collide by construction.
      const a = buildMetaOrganicWebhookEventKey({
        objectType: 'page',
        externalAssetId: '1',
        rawBody: Buffer.from(body, 'utf8'),
      });
      const b = buildMetaOrganicWebhookEventKey({
        objectType: 'pag',
        externalAssetId: 'e1',
        rawBody: Buffer.from(body, 'utf8'),
      });

      expect(a).not.toBe(b);
    });
  });
});
