import { createHmac } from 'node:crypto';
import {
  MetaOrganicWebhookSignatureError,
  MetaOrganicWebhookSignatureService,
} from './meta-organic-webhook-signature.service';

const SOCIAL_SECRET = 'social-organic-app-secret';

function sign(body: string | Buffer, secret = SOCIAL_SECRET): string {
  return `sha256=${createHmac('sha256', secret).update(body).digest('hex')}`;
}

function expectFailure(fn: () => void, code: string): void {
  try {
    fn();
    throw new Error(`expected a signature failure with code ${code}`);
  } catch (error) {
    expect(error).toBeInstanceOf(MetaOrganicWebhookSignatureError);
    expect((error as MetaOrganicWebhookSignatureError).code).toBe(code);
  }
}

describe('MetaOrganicWebhookSignatureService', () => {
  const service = new MetaOrganicWebhookSignatureService();
  const body = JSON.stringify({ object: 'page', entry: [{ id: '1' }] });
  const rawBody = Buffer.from(body, 'utf8');

  const previous = {
    social: process.env.SOCIAL_META_APP_SECRET,
    ads: process.env.SOCIAL_META_ADS_APP_SECRET,
    instagram: process.env.SOCIAL_META_ORGANIC_INSTAGRAM_APP_SECRET,
    messaging: process.env.META_APP_SECRET,
  };

  beforeEach(() => {
    process.env.SOCIAL_META_APP_SECRET = SOCIAL_SECRET;
    delete process.env.SOCIAL_META_ORGANIC_INSTAGRAM_APP_SECRET;
    delete process.env.SOCIAL_META_ADS_APP_SECRET;
    delete process.env.META_APP_SECRET;
  });

  afterAll(() => {
    for (const [key, value] of [
      ['SOCIAL_META_APP_SECRET', previous.social],
      ['SOCIAL_META_ADS_APP_SECRET', previous.ads],
      ['SOCIAL_META_ORGANIC_INSTAGRAM_APP_SECRET', previous.instagram],
      ['META_APP_SECRET', previous.messaging],
    ] as const) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  it('accepts a signature produced with the Social app secret', () => {
    expect(() =>
      service.verify({ signatureHeader: sign(body), rawBody }),
    ).not.toThrow();
  });

  it('rejects a signature produced with a different secret', () => {
    expectFailure(
      () =>
        service.verify({
          signatureHeader: sign(body, 'another-secret'),
          rawBody,
        }),
      'signature_mismatch',
    );
  });

  it('rejects a missing signature header', () => {
    expectFailure(
      () => service.verify({ signatureHeader: undefined, rawBody }),
      'signature_missing',
    );
    expectFailure(
      () => service.verify({ signatureHeader: '   ', rawBody }),
      'signature_missing',
    );
  });

  it('rejects a malformed signature header', () => {
    const digest = sign(body).slice('sha256='.length);

    for (const header of [
      digest, // no prefix
      `sha1=${digest}`, // wrong algorithm prefix
      `sha256=${digest.toUpperCase()}`, // not lowercase hex
      `sha256=${digest.slice(0, 63)}z`, // non-hex character
      'sha256=', // empty digest
    ]) {
      expectFailure(
        () => service.verify({ signatureHeader: header, rawBody }),
        'signature_malformed',
      );
    }
  });

  it('rejects a digest of a different length before comparing', () => {
    const digest = sign(body).slice('sha256='.length);

    expectFailure(
      () =>
        service.verify({
          signatureHeader: `sha256=${digest.slice(0, 62)}`,
          rawBody,
        }),
      'signature_malformed',
    );
    expectFailure(
      () =>
        service.verify({
          signatureHeader: `sha256=${digest}ab`,
          rawBody,
        }),
      'signature_malformed',
    );
  });

  it('rejects a body altered by a single byte', () => {
    const signature = sign(body);
    const mutated = Buffer.from(body.replace('"1"', '"2"'), 'utf8');

    expect(mutated.length).toBe(rawBody.length);
    expectFailure(
      () => service.verify({ signatureHeader: signature, rawBody: mutated }),
      'signature_mismatch',
    );
  });

  it('signs the exact bytes, not a re-serialization of the parsed body', () => {
    // Same document, different bytes: whitespace and key order. A handler that
    // re-serialized `@Body()` would accept one of these and reject the other.
    const spaced = '{"object": "page", "entry": [{"id": "1"}]}';
    const reordered = JSON.stringify({ entry: [{ id: '1' }], object: 'page' });

    expect(() =>
      service.verify({
        signatureHeader: sign(spaced),
        rawBody: Buffer.from(spaced, 'utf8'),
      }),
    ).not.toThrow();

    expectFailure(
      () =>
        service.verify({
          signatureHeader: sign(spaced),
          rawBody: Buffer.from(reordered, 'utf8'),
        }),
      'signature_mismatch',
    );
  });

  it('reports a missing raw body rather than verifying nothing', () => {
    expectFailure(
      () => service.verify({ signatureHeader: sign(body), rawBody: undefined }),
      'raw_body_unavailable',
    );
  });

  it('reports an unconfigured secret without consulting the Messaging app', () => {
    delete process.env.SOCIAL_META_APP_SECRET;
    process.env.META_APP_SECRET = SOCIAL_SECRET;

    expect(service.isConfigured()).toBe(false);
    expectFailure(
      () => service.verify({ signatureHeader: sign(body), rawBody }),
      'signature_secret_not_configured',
    );
  });

  it('treats an empty secret as unconfigured', () => {
    process.env.SOCIAL_META_APP_SECRET = '   ';

    expect(service.isConfigured()).toBe(false);
  });

  it('accepts a direct Instagram Login webhook signature', () => {
    delete process.env.SOCIAL_META_APP_SECRET;
    process.env.SOCIAL_META_ORGANIC_INSTAGRAM_APP_SECRET = SOCIAL_SECRET;

    expect(service.isConfigured()).toBe(true);
    expect(() =>
      service.verify({ signatureHeader: sign(body), rawBody }),
    ).not.toThrow();
  });

  it('never accepts the Meta Ads secret as an Organic webhook signer', () => {
    delete process.env.SOCIAL_META_APP_SECRET;
    process.env.SOCIAL_META_ADS_APP_SECRET = SOCIAL_SECRET;

    expect(service.isConfigured()).toBe(false);
    expectFailure(
      () => service.verify({ signatureHeader: sign(body), rawBody }),
      'signature_secret_not_configured',
    );
  });

  it('never throws a length error out of the timing-safe comparison', () => {
    // `timingSafeEqual` throws RangeError on unequal lengths. Every wrong-length
    // digest must therefore be refused during parsing, as `signature_malformed`
    // — never surface as a RangeError, and never be compared with `===`.
    const digest = sign(body).slice('sha256='.length);

    for (const candidate of [
      '',
      'a',
      digest.slice(0, 32),
      `${digest}${digest}`,
    ]) {
      let thrown: unknown;
      try {
        service.verify({ signatureHeader: `sha256=${candidate}`, rawBody });
      } catch (error) {
        thrown = error;
      }

      expect(thrown).toBeInstanceOf(MetaOrganicWebhookSignatureError);
      expect(thrown).not.toBeInstanceOf(RangeError);
      expect((thrown as MetaOrganicWebhookSignatureError).code).toBe(
        'signature_malformed',
      );
    }
  });

  it('compares a well-formed but wrong digest as a mismatch, not a parse error', () => {
    // Same length and alphabet as a real digest, so it reaches the constant-time
    // comparison rather than being filtered out by the parser.
    expectFailure(
      () =>
        service.verify({
          signatureHeader: `sha256=${'0'.repeat(64)}`,
          rawBody,
        }),
      'signature_mismatch',
    );
  });
});
