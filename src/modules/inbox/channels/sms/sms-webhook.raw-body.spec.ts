import type { NestExpressApplication } from '@nestjs/platform-express';
import { NotFoundException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { getDataSourceToken } from '@nestjs/typeorm';
import { generateKeyPairSync, sign } from 'crypto';
import request from 'supertest';
import { InboundMessageIngestionService } from '../services/inbound-message-ingestion.service';
import { MessageStatusSyncService } from '../services/message-status-sync.service';
import { WebhookLogService } from '../services/webhook-log.service';
import { SmsOutboundService } from './sms-outbound.service';
import { SmsProviderRegistry } from './sms-provider.registry';
import { SmsWebhookController } from './sms-webhook.controller';
import { SmsWebhookService } from './sms-webhook.service';
import { TelnyxSmsProvider } from './telnyx/telnyx-sms.provider';

/**
 * The Telnyx webhook through a real Nest app with `rawBody: true`: the
 * signature covers the bytes as sent, so a parse-and-reserialize would fail
 * here even if the unit spec of the verifier passed.
 */
describe('SMS (Telnyx) webhook — raw body integration', () => {
  const { publicKey, privateKey } = generateKeyPairSync('ed25519');
  const rawKey = publicKey
    .export({ format: 'der', type: 'spki' })
    .subarray(12)
    .toString('base64');
  const channel = {
    id: 'channel-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    name: 'Loja SMS',
    type: 'sms',
    provider: 'telnyx',
    status: 'active',
    connectionStatus: 'connected',
    externalPhoneNumberId: '+15559990000',
    metadata: { webhookPublicKey: rawKey, helpText: 'Ajuda: (11) 4000-0000' },
  };
  const ingestion = { ingest: jest.fn() };
  const statusSync = { applyStatusUpdate: jest.fn() };
  const webhookLogs = { create: jest.fn().mockResolvedValue(undefined) };
  const outbound = { sendKeywordReply: jest.fn() };
  const findOne = jest.fn();
  const query = jest.fn();
  let app: NestExpressApplication;

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      controllers: [SmsWebhookController],
      providers: [
        SmsWebhookService,
        SmsProviderRegistry,
        TelnyxSmsProvider,
        {
          provide: getDataSourceToken('agency'),
          useValue: { getRepository: () => ({ findOne }), query },
        },
        { provide: InboundMessageIngestionService, useValue: ingestion },
        { provide: MessageStatusSyncService, useValue: statusSync },
        { provide: WebhookLogService, useValue: webhookLogs },
        { provide: SmsOutboundService, useValue: outbound },
      ],
    }).compile();
    app = moduleRef.createNestApplication<NestExpressApplication>({
      rawBody: true,
    });
    app.useBodyParser('json', { limit: '10mb' });
    app.setGlobalPrefix('api');
    await app.init();
  });

  afterAll(async () => app.close());

  beforeEach(() => {
    jest.clearAllMocks();
    findOne.mockResolvedValue(channel);
    query.mockResolvedValue([]);
    ingestion.ingest.mockResolvedValue({
      conversation: { id: 'conversation-1' },
      message: { id: 'message-1' },
      deduplicated: false,
      smsKeyword: null,
    });
  });

  // Spacing a serializer would not reproduce: the signature is over these bytes.
  const inboundBody = (text: string, eventId = 'evt-1') =>
    `{"data": {"event_type":"message.received","id":"${eventId}","payload":{"id":"msg-1","direction":"inbound","type":"SMS","text":"${text}","from":{"phone_number":"+15550001111"},"to":[{"phone_number":"+15559990000"}],"media":[]}}}`;

  function signed(body: string, timestamp = Math.floor(Date.now() / 1000)) {
    return {
      'telnyx-timestamp': String(timestamp),
      'telnyx-signature-ed25519': sign(
        null,
        Buffer.from(`${timestamp}|${body}`),
        privateKey,
      ).toString('base64'),
    };
  }

  function post(path: string, body: string, headers: Record<string, string>) {
    return request(app.getHttpServer())
      .post(path)
      .set('Content-Type', 'application/json')
      .set(headers)
      .send(body);
  }

  it('ingests a signed inbound SMS and logs it as processed', async () => {
    const body = inboundBody('Oi');
    await post('/api/inbox/channels/sms/telnyx/webhook', body, signed(body))
      .expect(200)
      .expect({ ok: true, status: 'processed' });
    expect(ingestion.ingest).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel-1',
        channelType: 'sms',
        externalThreadId: '+15550001111',
        externalMessageId: 'msg-1',
        content: 'Oi',
      }),
    );
    expect(findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({
        type: 'sms',
        provider: 'telnyx',
        externalPhoneNumberId: '+15559990000',
      }) as unknown,
    });
    expect(webhookLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        provider: 'telnyx',
        status: 'processed',
        payload: {},
        metadata: expect.objectContaining({ eventId: 'evt-1' }) as unknown,
      }),
    );
  });

  it('answers the failover URL with the same handler', async () => {
    const body = inboundBody('Oi', 'evt-2');
    await post(
      '/api/inbox/channels/sms/telnyx/webhook/failover',
      body,
      signed(body),
    ).expect(200);
    expect(webhookLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({ failover: true }) as unknown,
      }),
    );
  });

  it('401s a bad signature and persists nothing', async () => {
    const body = inboundBody('Oi');
    const headers = signed(inboundBody('outro texto'));
    await post('/api/inbox/channels/sms/telnyx/webhook', body, headers).expect(
      401,
    );
    expect(ingestion.ingest).not.toHaveBeenCalled();
    expect(webhookLogs.create).not.toHaveBeenCalled();
  });

  it('401s an old timestamp (replay) and a number that is not ours', async () => {
    const body = inboundBody('Oi');
    await post(
      '/api/inbox/channels/sms/telnyx/webhook',
      body,
      signed(body, Math.floor(Date.now() / 1000) - 301),
    ).expect(401);
    findOne.mockResolvedValue(null);
    await post(
      '/api/inbox/channels/sms/telnyx/webhook',
      body,
      signed(body),
    ).expect(401);
    expect(webhookLogs.create).not.toHaveBeenCalled();
  });

  it('skips an event already processed (same data.id)', async () => {
    query.mockResolvedValueOnce([{ '?column?': 1 }]);
    const body = inboundBody('Oi');
    await post('/api/inbox/channels/sms/telnyx/webhook', body, signed(body))
      .expect(200)
      .expect({ ok: true, status: 'duplicate' });
    expect(ingestion.ingest).not.toHaveBeenCalled();
  });

  it("answers HELP with the channel's text and records the reply", async () => {
    ingestion.ingest.mockResolvedValue({
      conversation: { id: 'conversation-1' },
      message: { id: 'message-help' },
      deduplicated: false,
      smsKeyword: 'help',
    });
    outbound.sendKeywordReply.mockResolvedValue({ message: { id: 'reply-1' } });
    const body = inboundBody('HELP');
    await post(
      '/api/inbox/channels/sms/telnyx/webhook',
      body,
      signed(body),
    ).expect(200);
    expect(outbound.sendKeywordReply).toHaveBeenCalledWith(
      expect.objectContaining({
        inboundMessageId: 'message-help',
        text: 'Ajuda: (11) 4000-0000',
      }),
    );
    expect(webhookLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          smsKeyword: 'help',
          helpReply: { status: 'sent', messageId: 'reply-1' },
        }) as unknown,
      }),
    );
  });

  it('a failed HELP reply is logged, not swallowed', async () => {
    ingestion.ingest.mockResolvedValue({
      conversation: { id: 'conversation-1' },
      message: { id: 'message-help' },
      deduplicated: false,
      smsKeyword: 'help',
    });
    outbound.sendKeywordReply.mockRejectedValue(
      new Error('provider_send_failed'),
    );
    const body = inboundBody('HELP');
    await post(
      '/api/inbox/channels/sms/telnyx/webhook',
      body,
      signed(body),
    ).expect(200);
    expect(webhookLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        metadata: expect.objectContaining({
          helpReply: { status: 'failed', errorCode: 'provider_send_failed' },
        }) as unknown,
      }),
    );
  });

  it('finds the channel of a status event by the message we sent', async () => {
    query.mockImplementation((sql: string) =>
      Promise.resolve(
        sql.includes('FROM inbox_messages')
          ? [{ channel_id: 'channel-1' }]
          : [],
      ),
    );
    statusSync.applyStatusUpdate.mockResolvedValue({ id: 'message-out' });
    const body = `{"data":{"event_type":"message.finalized","id":"evt-9","payload":{"id":"msg-out","direction":"outbound","from":{"phone_number":"+15559990000"},"to":[{"phone_number":"+15550001111","status":"delivered"}],"errors":[]}}}`;
    await post(
      '/api/inbox/channels/sms/telnyx/webhook',
      body,
      signed(body),
    ).expect(200);
    expect(statusSync.applyStatusUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        externalMessageId: 'msg-out',
        status: 'delivered',
        channelType: 'sms',
      }),
    );
    expect(findOne).toHaveBeenCalledWith({
      where: expect.objectContaining({ id: 'channel-1' }) as unknown,
    });
  });

  it('ignores the status of a message sent outside the Inbox', async () => {
    statusSync.applyStatusUpdate.mockRejectedValue(new NotFoundException());
    const body = `{"data":{"event_type":"message.sent","id":"evt-10","payload":{"id":"msg-portal","direction":"outbound","from":{"phone_number":"+15559990000"},"to":[{"phone_number":"+15550001111","status":"sent"}]}}}`;
    await post('/api/inbox/channels/sms/telnyx/webhook', body, signed(body))
      .expect(200)
      .expect({ ok: true, status: 'ignored' });
  });

  it('a processing failure is a 5xx (Telnyx retries) and is logged', async () => {
    ingestion.ingest.mockRejectedValue(new Error('database_down'));
    const body = inboundBody('Oi');
    await post(
      '/api/inbox/channels/sms/telnyx/webhook',
      body,
      signed(body),
    ).expect(500);
    expect(webhookLogs.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'database_down',
      }),
    );
  });
});
