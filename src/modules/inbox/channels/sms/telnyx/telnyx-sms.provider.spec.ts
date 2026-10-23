import { generateKeyPairSync, sign } from 'crypto';
import type { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import {
  SmsProviderError,
  SmsWebhookRejectedError,
} from '../sms-provider.adapter';
import {
  parseTelnyxPublicKey,
  TelnyxSmsProvider,
  verifyTelnyxSignature,
} from './telnyx-sms.provider';

function keyPair() {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const raw = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(12)
    .toString('base64');
  return { raw, privateKey };
}

function signBody(
  privateKey: ReturnType<typeof keyPair>['privateKey'],
  timestamp: string,
  body: Buffer,
) {
  return sign(
    null,
    Buffer.concat([Buffer.from(`${timestamp}|`), body]),
    privateKey,
  ).toString('base64');
}

const channel = (publicKey: string) =>
  ({
    id: 'channel-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    metadata: { webhookPublicKey: publicKey },
  }) as unknown as InboxChannelEntity;

const now = new Date('2026-10-23T12:00:00Z');
const timestamp = String(Math.floor(now.getTime() / 1000));

describe('verifyTelnyxSignature (Ed25519 over "<timestamp>|<raw body>")', () => {
  const body = Buffer.from('{"data":{"id":"evt-1"}}');

  it('accepts the exact bytes Telnyx signed', () => {
    const { raw, privateKey } = keyPair();
    expect(() =>
      verifyTelnyxSignature({
        publicKey: raw,
        signature: signBody(privateKey, timestamp, body),
        timestamp,
        rawBody: body,
        now,
      }),
    ).not.toThrow();
  });

  it('refuses a body changed after signing (re-serialized JSON included)', () => {
    const { raw, privateKey } = keyPair();
    const signature = signBody(privateKey, timestamp, body);
    expect(() =>
      verifyTelnyxSignature({
        publicKey: raw,
        signature,
        timestamp,
        rawBody: Buffer.from('{"data": {"id": "evt-1"}}'),
        now,
      }),
    ).toThrow(new SmsWebhookRejectedError('signature_invalid'));
  });

  it('refuses a timestamp outside the 300 s tolerance, either way', () => {
    const { raw, privateKey } = keyPair();
    for (const offset of [301, -301]) {
      const stale = String(Number(timestamp) - offset);
      expect(() =>
        verifyTelnyxSignature({
          publicKey: raw,
          signature: signBody(privateKey, stale, body),
          timestamp: stale,
          rawBody: body,
          now,
        }),
      ).toThrow(new SmsWebhookRejectedError('timestamp_outside_tolerance'));
    }
  });

  it("refuses a signature made with another channel's key", () => {
    const ours = keyPair();
    const theirs = keyPair();
    expect(() =>
      verifyTelnyxSignature({
        publicKey: ours.raw,
        signature: signBody(theirs.privateKey, timestamp, body),
        timestamp,
        rawBody: body,
        now,
      }),
    ).toThrow(new SmsWebhookRejectedError('signature_invalid'));
  });

  it('refuses missing headers', () => {
    const { raw } = keyPair();
    expect(() =>
      verifyTelnyxSignature({
        publicKey: raw,
        signature: undefined,
        timestamp,
        rawBody: body,
        now,
      }),
    ).toThrow(new SmsWebhookRejectedError('signature_missing'));
  });

  it('reads the key from the channel and fails closed without one', () => {
    const provider = new TelnyxSmsProvider();
    const { raw, privateKey } = keyPair();
    const headers = {
      'telnyx-signature-ed25519': signBody(privateKey, timestamp, body),
      'telnyx-timestamp': timestamp,
    };
    expect(() =>
      provider.verifyWebhook(headers, body, channel(raw), now),
    ).not.toThrow();
    expect(() =>
      provider.verifyWebhook(headers, body, channel(''), now),
    ).toThrow(new SmsWebhookRejectedError('public_key_missing'));
  });
});

describe('parseTelnyxPublicKey', () => {
  it('accepts the portal key (raw 32 bytes) and SPKI DER', () => {
    const { publicKey } = generateKeyPairSync('ed25519');
    const der = publicKey.export({ format: 'der', type: 'spki' });
    expect(() =>
      parseTelnyxPublicKey(der.subarray(12).toString('base64')),
    ).not.toThrow();
    expect(() => parseTelnyxPublicKey(der.toString('base64'))).not.toThrow();
  });

  it('refuses anything that is not an Ed25519 key', () => {
    expect(() => parseTelnyxPublicKey('not-a-key')).toThrow(SmsProviderError);
    expect(() =>
      parseTelnyxPublicKey(Buffer.alloc(48, 1).toString('base64')),
    ).toThrow(SmsProviderError);
  });
});

describe('TelnyxSmsProvider normalization', () => {
  const provider = new TelnyxSmsProvider();
  const smsChannel = channel('unused');
  const envelope = (data: Record<string, unknown>) =>
    provider.parseWebhook(Buffer.from(JSON.stringify({ data })));

  it('routes inbound by `to` and outbound by `from`', () => {
    const inbound = envelope({
      id: 'evt-1',
      event_type: 'message.received',
      payload: {
        id: 'msg-1',
        direction: 'inbound',
        from: { phone_number: '+15550001111' },
        to: [{ phone_number: '+15559990000' }],
      },
    });
    expect(inbound.businessNumber).toBe('+15559990000');
    const outbound = envelope({
      id: 'evt-2',
      event_type: 'message.sent',
      payload: {
        id: 'msg-2',
        direction: 'outbound',
        from: { phone_number: '+15559990000' },
        to: [{ phone_number: '+15550001111', status: 'sent' }],
      },
    });
    expect(outbound.businessNumber).toBe('+15559990000');
  });

  it('turns an SMS into a text message on the sender thread', () => {
    const message = provider.normalizeInbound(
      envelope({
        id: 'evt-1',
        event_type: 'message.received',
        payload: {
          id: 'msg-1',
          direction: 'inbound',
          type: 'SMS',
          text: 'Oi, quero saber o preço',
          from: { phone_number: '+15550001111' },
          to: [{ phone_number: '+15559990000' }],
          received_at: '2026-10-23T11:59:00Z',
          media: [],
        },
      }),
      smsChannel,
    );
    expect(message).toMatchObject({
      channelType: 'sms',
      provider: 'telnyx',
      externalThreadId: '+15550001111',
      externalMessageId: 'msg-1',
      sender: { externalId: '+15550001111', phone: '+15550001111' },
      messageType: 'text',
      content: 'Oi, quero saber o preço',
      attachments: [],
    });
  });

  it('turns an MMS into image attachments and drops the SMIL layout part', () => {
    const message = provider.normalizeInbound(
      envelope({
        id: 'evt-1',
        event_type: 'message.received',
        payload: {
          id: 'msg-9',
          direction: 'inbound',
          type: 'MMS',
          text: null,
          from: { phone_number: '+15550001111' },
          to: [{ phone_number: '+15559990000' }],
          media: [
            { url: 'https://x/smil', content_type: 'application/smil' },
            {
              url: 'https://media.telnyx.com/a.jpg',
              content_type: 'image/jpeg',
              size: 2048,
              sha256: 'abc',
            },
          ],
        },
      }),
      smsChannel,
    );
    expect(message?.messageType).toBe('image');
    expect(message?.content).toBe('[imagem]');
    expect(message?.attachments).toEqual([
      expect.objectContaining({
        type: 'image',
        mimeType: 'image/jpeg',
        externalId: 'msg-9:1',
        metadata: {
          directUrl: 'https://media.telnyx.com/a.jpg',
          sha256: 'abc',
        },
      }),
    ]);
  });

  it.each([
    ['message.sent', 'sent', 'sent'],
    ['message.finalized', 'delivered', 'delivered'],
    ['message.finalized', 'delivery_failed', 'failed'],
    ['message.finalized', 'sending_failed', 'failed'],
    // No confirmation is not a failure.
    ['message.finalized', 'delivery_unconfirmed', 'sent'],
  ])('maps %s/%s to %s', (eventType, providerStatus, expected) => {
    const update = provider.normalizeStatus(
      envelope({
        id: 'evt-3',
        event_type: eventType,
        payload: {
          id: 'msg-2',
          direction: 'outbound',
          to: [{ phone_number: '+15550001111', status: providerStatus }],
          errors: expected === 'failed' ? [{ code: '40300', title: 'x' }] : [],
        },
      }),
      smsChannel,
    );
    expect(update).toMatchObject({
      channelType: 'sms',
      provider: 'telnyx',
      externalMessageId: 'msg-2',
      status: expected,
    });
    if (expected === 'failed') {
      expect(update?.metadata).toMatchObject({ providerErrorCode: '40300' });
    }
  });

  it('rejects a body that is not a Telnyx event', () => {
    expect(() => provider.parseWebhook(Buffer.from('nope'))).toThrow(
      SmsWebhookRejectedError,
    );
    expect(() =>
      provider.parseWebhook(Buffer.from(JSON.stringify({ data: {} }))),
    ).toThrow(SmsWebhookRejectedError);
  });
});

describe('TelnyxSmsProvider API calls', () => {
  const provider = new TelnyxSmsProvider();
  const json = (status: number, body: unknown) =>
    ({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    }) as Response;

  afterEach(() => jest.restoreAllMocks());

  it('validates number, profile link and reads the webhook setup', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        json(200, {
          data: [
            {
              phone_number: '+15559990000',
              status: 'active',
              messaging_profile_id: 'profile-1',
            },
          ],
        }),
      )
      .mockResolvedValueOnce(
        json(200, {
          data: {
            name: 'Lyra',
            enabled: true,
            webhook_url: 'https://api/x',
            webhook_failover_url: null,
            webhook_api_version: '2',
          },
        }),
      );
    await expect(
      provider.validateCredentials({
        apiKey: 'KEY',
        phoneNumber: '+15559990000',
        messagingProfileId: 'profile-1',
      }),
    ).resolves.toMatchObject({
      messagingProfileName: 'Lyra',
      webhookUrl: 'https://api/x',
      webhookApiVersion: '2',
    });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe(
      'https://api.telnyx.com/v2/phone_numbers?filter%5Bphone_number%5D=%2B15559990000',
    );
    expect(init.headers).toMatchObject({ Authorization: 'Bearer KEY' });
  });

  it.each([
    [{ status: 401 }, 'sms_credentials_invalid'],
    [{ data: [] }, 'sms_number_not_found'],
    [
      {
        data: [
          {
            phone_number: '+15559990000',
            status: 'active',
            messaging_profile_id: 'other',
          },
        ],
      },
      'sms_messaging_profile_mismatch',
    ],
  ])('refuses %j with %s', async (response, code) => {
    jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        'status' in response ? json(response.status, {}) : json(200, response),
      );
    await expect(
      provider.validateCredentials({
        apiKey: 'KEY',
        phoneNumber: '+15559990000',
        messagingProfileId: 'profile-1',
      }),
    ).rejects.toMatchObject({ code });
  });

  it('sends text and MMS media to /v2/messages', async () => {
    const fetchMock = jest
      .spyOn(global, 'fetch')
      .mockResolvedValue(json(200, { data: { id: 'msg-out' } }));
    await expect(
      provider.send({
        apiKey: 'KEY',
        from: '+15559990000',
        to: '+15550001111',
        text: 'Olá',
        mediaUrls: ['https://api/x.png?au=provider%3Atelnyx'],
      }),
    ).resolves.toEqual({ externalMessageId: 'msg-out' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://api.telnyx.com/v2/messages');
    expect(JSON.parse(init.body as string)).toEqual({
      from: '+15559990000',
      to: '+15550001111',
      text: 'Olá',
      media_urls: ['https://api/x.png?au=provider%3Atelnyx'],
    });
  });

  it('does not send the API key to a media host outside Telnyx', async () => {
    const fetchMock = jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: true,
      status: 200,
      headers: new Headers({ 'content-type': 'image/png' }),
      arrayBuffer: () => Promise.resolve(new ArrayBuffer(4)),
    } as Response);
    await provider.downloadMedia('https://bucket.example.com/a', 'KEY', 100);
    await provider.downloadMedia('https://media.telnyx.com/a', 'KEY', 100);
    expect(fetchMock.mock.calls[0][1]?.headers).toEqual({});
    expect(fetchMock.mock.calls[1][1]?.headers).toEqual({
      Authorization: 'Bearer KEY',
    });
    await expect(
      provider.downloadMedia('http://media.telnyx.com/a', 'KEY', 100),
    ).rejects.toThrow('untrusted_media_url');
  });
});
