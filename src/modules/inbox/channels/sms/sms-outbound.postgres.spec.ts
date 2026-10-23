import { generateKeyPairSync } from 'crypto';
import {
  BadRequestException,
  ConflictException,
  ServiceUnavailableException,
} from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../../database/agency-typeorm.datasource';
import { AddInboxSmsChannelNumberIndex1800500000000 } from '../../../../database/migrations/1800500000000-add-inbox-sms-channel-number-index';
import { deleteFixtureTenant } from '../../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../../testing/postgres-integration';
import { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import { InboxMessageEntity } from '../../entities/inbox-message.entity';
import { inboxScopeRequestContext } from '../../inbox-company-scope';
import { InboundMessageIngestionService } from '../services/inbound-message-ingestion.service';
import { SmsChannelService } from './sms-channel.service';
import { SmsOutboundService } from './sms-outbound.service';
import { SmsProviderRegistry } from './sms-provider.registry';
import { TelnyxSmsProvider } from './telnyx/telnyx-sms.provider';

const run = describePostgresIntegration();

/**
 * IX4 outbound on real queries (rule 9, lesson of AI-01): the service, the
 * ingestion and the Telnyx client are the real ones; only `fetch` is stubbed,
 * so the request Telnyx would receive is what is asserted.
 */
run('SMS outbound (Telnyx) on PostgreSQL', () => {
  const tenantId = randomUUID();
  // A second tenant: the number index is global, the older bindings per tenant.
  const otherTenantId = randomUUID();
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const businessNumber = `+1555${String(Date.now()).slice(-7)}`;
  const leadNumber = '+15550001111';
  const migration = new AddInboxSmsChannelNumberIndex1800500000000();
  let fetchMock: jest.SpiedFunction<typeof fetch>;

  const reset = async () => {
    await AgencyDataSource.query(
      'DELETE FROM contact_methods WHERE tenant_id = $1',
      [tenantId],
    );
    await deleteFixtureTenant(AgencyDataSource, otherTenantId, [
      'inbox_channels',
    ]);
    await deleteFixtureTenant(AgencyDataSource, tenantId, [
      'inbox_media_assets',
      'inbox_processing_batches',
      'inbox_conversation_events',
      'inbox_attribution_observations',
      'inbox_messages',
      'inbox_conversations',
      'inbox_domain_outbox',
      'inbox_channels',
    ]);
  };

  beforeAll(async () => {
    if (AgencyDataSource.options.database !== 'lyra_agency_test') {
      throw new Error('SMS outbound spec requires lyra_agency_test.');
    }
    await AgencyDataSource.initialize();
    const runner = AgencyDataSource.createQueryRunner();
    try {
      await migration.up(runner);
    } finally {
      await runner.release();
    }
  });

  beforeEach(async () => {
    await reset();
    fetchMock = jest.spyOn(global, 'fetch').mockImplementation(() =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () => Promise.resolve({ data: { id: `tx-${randomUUID()}` } }),
      } as Response),
    );
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await reset();
      await AgencyDataSource.destroy();
    }
  });

  function service() {
    return new SmsOutboundService(
      AgencyDataSource,
      AgencyDataSource.getRepository(InboxChannelEntity),
      AgencyDataSource.getRepository(InboxConversationEntity),
      AgencyDataSource.getRepository(InboxMessageEntity),
      { decrypt: () => 'TELNYX_KEY' } as never,
      {
        uploadRawFile: () =>
          Promise.resolve({
            url: '/api/assets/tenants/t/workspaces/w/inbox/attachments/a.png',
            path: 'tenants/t/workspaces/w/inbox/attachments/a.png',
          }),
      } as never,
      {
        issueGrant: () => ({ query: 'au=provider%3Atelnyx&ae=1&as=sig' }),
      } as never,
      new SmsProviderRegistry(new TelnyxSmsProvider()),
    );
  }

  function ingestion() {
    return new InboundMessageIngestionService(AgencyDataSource, {
      publishInboundMessage: jest.fn(),
    } as never);
  }

  async function seedChannel(overrides: Partial<InboxChannelEntity> = {}) {
    return AgencyDataSource.getRepository(InboxChannelEntity).save({
      tenantId,
      workspaceId,
      scopeKind: 'agency',
      agencyClientId: null,
      companyContextId: null,
      name: 'SMS sintético',
      type: 'sms',
      provider: 'telnyx',
      status: 'active',
      connectionStatus: 'connected',
      externalPhoneNumberId: businessNumber,
      accessTokenEncrypted: 'encrypted',
      aiEnabled: true,
      settings: {},
      metadata: {
        webhookPublicKey: 'unused-here',
        telnyxMessagingProfileId: 'profile-1',
      },
      ...overrides,
    });
  }

  async function inbound(channel: InboxChannelEntity, text: string) {
    return ingestion().ingest({
      tenantId,
      workspaceId,
      channelId: channel.id,
      channelType: 'sms',
      provider: 'telnyx',
      externalThreadId: leadNumber,
      externalMessageId: `in-${randomUUID()}`,
      sender: { externalId: leadNumber, phone: leadNumber },
      messageType: 'text',
      content: text,
    });
  }

  async function assume(conversation: InboxConversationEntity) {
    await AgencyDataSource.getRepository(InboxConversationEntity).update(
      { id: conversation.id },
      { ownershipState: 'human_active', assignedUserId: userId },
    );
  }

  const ctx = { tenantId, workspaceId, userId };
  type TelnyxBody = {
    from: string;
    to: string;
    text: string;
    media_urls?: string[];
  };
  const telnyxBodies = () =>
    fetchMock.mock.calls
      .filter(([url]) => String(url as string).endsWith('/v2/messages'))
      .map(
        ([, init]) =>
          JSON.parse((init as RequestInit).body as string) as TelnyxBody,
      );

  it('a person answers an inbound SMS: pending first, then sent with the Telnyx id', async () => {
    const channel = await seedChannel();
    const { conversation } = await inbound(channel, 'Oi, quanto custa?');
    expect(conversation.source).toBe('sms');
    expect(conversation.qualificationStatus).toBe('qualified');
    await assume(conversation);

    const result = await service().sendText({
      ctx,
      channelId: channel.id,
      conversationId: conversation.id,
      to: leadNumber,
      text: 'Olá! Custa US$ 20.',
      idempotencyKey: 'sms-user-1',
    });

    expect(telnyxBodies()).toEqual([
      { from: businessNumber, to: leadNumber, text: 'Olá! Custa US$ 20.' },
    ]);
    const row = await AgencyDataSource.getRepository(
      InboxMessageEntity,
    ).findOneByOrFail({ id: result.message.id });
    expect(row).toMatchObject({
      direction: 'outbound',
      senderType: 'user',
      senderUserId: userId,
      status: 'sent',
      externalMessageId: expect.stringMatching(/^tx-/) as unknown,
      metadata: expect.objectContaining({
        channelType: 'sms',
        provider: 'telnyx',
      }) as unknown,
    });
    const [outbox] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*) FROM inbox_domain_outbox
        WHERE tenant_id = $1 AND idempotency_key = $2`,
      [tenantId, `message.sent:${row.id}`],
    );
    expect(Number(outbox.count)).toBe(1);

    // The same key again replays the row instead of sending twice.
    await service().sendText({
      ctx,
      channelId: channel.id,
      conversationId: conversation.id,
      to: leadNumber,
      text: 'Olá! Custa US$ 20.',
      idempotencyKey: 'sms-user-1',
    });
    expect(telnyxBodies()).toHaveLength(1);
  });

  it('STOP blocks every send (no row, no request) and START lifts it', async () => {
    const channel = await seedChannel();
    const stop = await inbound(channel, 'STOP');
    expect(stop.smsKeyword).toBe('opt_out');
    expect(stop.conversation.aiEnabled).toBe(false);
    // An opt-out never wakes the agent.
    const [batches] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*) FROM inbox_processing_batches WHERE conversation_id = $1`,
      [stop.conversation.id],
    );
    expect(Number(batches.count)).toBe(0);
    await assume(stop.conversation);

    await expect(
      service().sendText({
        ctx,
        channelId: channel.id,
        conversationId: stop.conversation.id,
        to: leadNumber,
        text: 'Ainda tem interesse?',
      }),
    ).rejects.toThrow(new ConflictException('sms_contact_opted_out'));
    expect(fetchMock).not.toHaveBeenCalled();
    expect(
      await AgencyDataSource.getRepository(InboxMessageEntity).countBy({
        conversationId: stop.conversation.id,
        direction: 'outbound',
      }),
    ).toBe(0);

    const start = await inbound(channel, 'start');
    expect(start.smsKeyword).toBe('opt_in');
    await service().sendText({
      ctx,
      channelId: channel.id,
      conversationId: stop.conversation.id,
      to: leadNumber,
      text: 'Bem-vindo de volta!',
    });
    expect(telnyxBodies()).toHaveLength(1);
  });

  it('HELP is answered even after STOP, once per inbound message', async () => {
    const channel = await seedChannel();
    await inbound(channel, 'STOP');
    const help = await inbound(channel, 'HELP');
    expect(help.smsKeyword).toBe('help');
    const reply = () =>
      service().sendKeywordReply({
        channel,
        conversation: help.conversation,
        inboundMessageId: help.message.id,
        text: 'Ajuda: responda a esta mensagem.',
      });
    await reply();
    await reply();
    expect(telnyxBodies()).toEqual([
      {
        from: businessNumber,
        to: leadNumber,
        text: 'Ajuda: responda a esta mensagem.',
      },
    ]);
  });

  it('HELP does not wake the agent on a live conversation; a real message does', async () => {
    const channel = await seedChannel();
    const batches = async (conversationId: string) =>
      Number(
        (
          await AgencyDataSource.query<Array<{ count: string }>>(
            `SELECT count(*) FROM inbox_processing_batches WHERE conversation_id = $1`,
            [conversationId],
          )
        )[0].count,
      );
    const help = await inbound(channel, 'HELP');
    expect(help.conversation.ownershipState).toBe('ai_active');
    expect(await batches(help.conversation.id)).toBe(0);
    await inbound(channel, 'Quero um orçamento');
    expect(await batches(help.conversation.id)).toBe(1);
  });

  it('refuses over 1600 characters and a recipient other than the thread', async () => {
    const channel = await seedChannel();
    const { conversation } = await inbound(channel, 'Oi');
    await assume(conversation);
    await expect(
      service().sendText({
        ctx,
        channelId: channel.id,
        conversationId: conversation.id,
        to: leadNumber,
        text: 'x'.repeat(1601),
      }),
    ).rejects.toThrow(BadRequestException);
    await expect(
      service().sendText({
        ctx,
        channelId: channel.id,
        conversationId: conversation.id,
        to: '+15557778888',
        text: 'Oi',
      }),
    ).rejects.toThrow('SMS recipient identity is invalid.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('a provider failure leaves the row failed and is not silent', async () => {
    const channel = await seedChannel();
    const { conversation } = await inbound(channel, 'Oi');
    await assume(conversation);
    fetchMock.mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({ errors: [{ code: '10007' }] }),
    } as Response);

    await expect(
      service().sendText({
        ctx,
        channelId: channel.id,
        conversationId: conversation.id,
        to: leadNumber,
        text: 'Oi',
        idempotencyKey: 'sms-fail-1',
      }),
    ).rejects.toThrow(ServiceUnavailableException);
    const row = await AgencyDataSource.getRepository(
      InboxMessageEntity,
    ).findOneByOrFail({ idempotencyKey: 'sms-fail-1', tenantId });
    expect(row.status).toBe('failed');
    expect(row.metadata).toMatchObject({
      errorCode: 'provider_send_failed',
      providerErrorCode: '10007',
    });
  });

  it('sends an MMS through a signed URL that is not persisted', async () => {
    const previousBase = process.env.API_PUBLIC_URL;
    process.env.API_PUBLIC_URL = 'https://api.example.test';
    const channel = await seedChannel();
    const { conversation } = await inbound(channel, 'Manda a foto');
    await assume(conversation);
    const result = await service().sendMedia({
      ctx,
      channelId: channel.id,
      conversationId: conversation.id,
      to: leadNumber,
      file: {
        originalname: 'foto.png',
        mimetype: 'image/png',
        size: 1000,
        buffer: Buffer.alloc(1000),
      } as Express.Multer.File,
    });
    const [body] = telnyxBodies();
    expect(body.media_urls?.[0]).toMatch(/au=provider%3Atelnyx/);
    expect(JSON.stringify(result.message.metadata)).not.toContain(
      'provider%3Atelnyx',
    );
    expect(body.media_urls?.[0]).toMatch(
      /^https:\/\/api\.example\.test\/api\/assets\//,
    );
    expect(result.message.attachments[0]).toMatchObject({ kind: 'image' });
    if (previousBase === undefined) delete process.env.API_PUBLIC_URL;
    else process.env.API_PUBLIC_URL = previousBase;
  });

  it("D+3 from a WhatsApp lead opens the contact's SMS conversation in the same company", async () => {
    const companyContactId = randomUUID();
    const agencyClientId = randomUUID();
    const companyContextId = randomUUID();
    await AgencyDataSource.query(
      `INSERT INTO contacts (id, tenant_id, workspace_id, type, display_name)
       VALUES ($1, $2, $3, 'organization', 'Empresa SMS')`,
      [companyContactId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO agency_clients (id, tenant_id, workspace_id, contact_id, display_name)
       VALUES ($1, $2, $3, $4, 'Cliente SMS')`,
      [agencyClientId, tenantId, workspaceId, companyContactId],
    );
    await AgencyDataSource.query(
      `INSERT INTO agency_client_company_contexts
         (id, tenant_id, workspace_id, agency_client_id, company_contact_id, status, is_primary)
       VALUES ($1, $2, $3, $4, $5, 'active', true)`,
      [
        companyContextId,
        tenantId,
        workspaceId,
        agencyClientId,
        companyContactId,
      ],
    );
    try {
      const company = {
        scopeKind: 'company' as const,
        agencyClientId,
        companyContextId,
      };
      const sms = await seedChannel(company);
      const whatsapp = await AgencyDataSource.getRepository(
        InboxChannelEntity,
      ).save({
        tenantId,
        workspaceId,
        ...company,
        name: 'WhatsApp',
        type: 'whatsapp',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        aiEnabled: true,
        settings: {},
        metadata: {},
      });
      const origin = await AgencyDataSource.getRepository(
        InboxConversationEntity,
      ).save({
        tenantId,
        workspaceId,
        ...company,
        channelId: whatsapp.id,
        externalThreadId: '15550002222',
        title: 'Maria Souza',
        status: 'open',
        source: 'whatsapp',
        businessMode: 'general',
        ownershipState: 'ai_active',
        ownershipVersion: 2,
        ownershipChangedAt: new Date(),
        aiEnabled: true,
        qualificationStatus: 'qualified',
        metadata: { contactName: 'Maria Souza' },
      });

      const send = (key: string) =>
        service().sendAutomationMessage({
          tenantId,
          workspaceId,
          conversationId: origin.id,
          automationId: randomUUID(),
          idempotencyKey: key,
          text: 'Oi Maria, ainda tem interesse?',
        });
      const first = await send('followup:d3:sms');
      expect(first.conversation).toMatchObject({
        channelId: sms.id,
        externalThreadId: '+15550002222',
        scopeKind: 'company',
        companyContextId,
        source: 'sms',
        title: 'Maria Souza',
        ownershipState: 'ai_active',
        metadata: expect.objectContaining({
          originConversationId: origin.id,
        }) as unknown,
      });
      expect(telnyxBodies()).toEqual([
        {
          from: businessNumber,
          to: '+15550002222',
          text: 'Oi Maria, ainda tem interesse?',
        },
      ]);
      // D+7 reuses the same SMS conversation.
      const second = await send('followup:d7:sms');
      expect(second.conversation.id).toBe(first.conversation.id);

      // The same conversation under the bare agency scope finds no channel:
      // a company SMS channel never serves the agency.
      await expect(
        service().sendText({
          ctx,
          channelId: sms.id,
          conversationId: first.conversation.id,
          to: '+15550002222',
          text: 'x',
        }),
      ).rejects.toThrow('Active SMS channel not found.');
      expect(
        inboxScopeRequestContext(first.conversation).managedContext,
      ).toMatchObject({
        companyContextId,
      });
    } finally {
      await reset();
      await AgencyDataSource.query(
        'DELETE FROM agency_client_company_contexts WHERE id = $1',
        [companyContextId],
      );
      await AgencyDataSource.query('DELETE FROM agency_clients WHERE id = $1', [
        agencyClientId,
      ]);
      await AgencyDataSource.query('DELETE FROM contacts WHERE id = $1', [
        companyContactId,
      ]);
    }
  });

  it('D+3 without a phone or without an SMS channel is refused, not guessed', async () => {
    const origin = await AgencyDataSource.getRepository(
      InboxConversationEntity,
    ).save({
      tenantId,
      workspaceId,
      scopeKind: 'agency',
      agencyClientId: null,
      companyContextId: null,
      channelId: null,
      externalThreadId: 'webchat:abc',
      title: 'Visitante',
      status: 'open',
      source: 'webchat',
      businessMode: 'general',
      ownershipState: 'ai_active',
      ownershipVersion: 1,
      ownershipChangedAt: new Date(),
      aiEnabled: true,
      qualificationStatus: 'qualified',
      metadata: {},
    });
    const send = () =>
      service().sendAutomationMessage({
        tenantId,
        workspaceId,
        conversationId: origin.id,
        automationId: randomUUID(),
        idempotencyKey: randomUUID(),
        text: 'Oi',
      });
    await expect(send()).rejects.toThrow('sms_recipient_unavailable');
    await AgencyDataSource.getRepository(InboxConversationEntity).update(
      { id: origin.id },
      { metadata: { contactPhone: '+1 (555) 000-3333' } },
    );
    await expect(send()).rejects.toThrow('sms_channel_unavailable');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('the database keeps one live channel per number across tenants (migration 1800500000000)', async () => {
    await seedChannel();
    // Another tenant cannot claim a number that is live here: the webhook
    // would not know whose key verifies it.
    await expect(
      seedChannel({ tenantId: otherTenantId, name: 'Outro tenant' }),
    ).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: '23505' }) as unknown,
    });
    // Once disconnected here, the number is free for the other tenant.
    await AgencyDataSource.getRepository(InboxChannelEntity).update(
      { tenantId, type: 'sms' },
      { connectionStatus: 'disconnected' },
    );
    await expect(
      seedChannel({ tenantId: otherTenantId, name: 'Outro tenant' }),
    ).resolves.toBeDefined();

    const runner = AgencyDataSource.createQueryRunner();
    try {
      await migration.down(runner);
      await AgencyDataSource.getRepository(InboxChannelEntity).update(
        { tenantId, type: 'sms' },
        { connectionStatus: 'connected' },
      );
      await AgencyDataSource.getRepository(InboxChannelEntity).update(
        { tenantId, type: 'sms' },
        { connectionStatus: 'disconnected' },
      );
      await migration.up(runner);
      await migration.up(runner);
    } finally {
      await runner.release();
    }
    const [index] = await AgencyDataSource.query<Array<{ count: string }>>(
      `SELECT count(*) FROM pg_indexes WHERE indexname = 'uq_inbox_channels_sms_live_number'`,
    );
    expect(Number(index.count)).toBe(1);
    await expect(
      AgencyDataSource.getRepository(InboxChannelEntity).update(
        { tenantId, type: 'sms' },
        { connectionStatus: 'connected' },
      ),
    ).rejects.toMatchObject({
      driverError: expect.objectContaining({ code: '23505' }) as unknown,
    });
  });

  it('connect validates on Telnyx, stores the key encrypted and reuses the row on reconnect', async () => {
    const previousBase = process.env.API_PUBLIC_URL;
    process.env.API_PUBLIC_URL = 'https://api.example.test';
    const publicKey = generateKeyPairSync('ed25519')
      .publicKey.export({ format: 'der', type: 'spki' })
      .subarray(12)
      .toString('base64');
    fetchMock.mockImplementation((url: string) =>
      Promise.resolve({
        ok: true,
        status: 200,
        json: () =>
          Promise.resolve(
            String(url).includes('/phone_numbers')
              ? {
                  data: [
                    {
                      phone_number: businessNumber,
                      status: 'active',
                      messaging_profile_id: 'profile-1',
                    },
                  ],
                }
              : {
                  data: {
                    name: 'Lyra',
                    enabled: true,
                    webhook_url:
                      'https://api.example.test/api/inbox/channels/sms/telnyx/webhook',
                    webhook_failover_url: null,
                    webhook_api_version: '2',
                  },
                },
          ),
      } as Response),
    );
    const channels = new SmsChannelService(
      AgencyDataSource,
      { encrypt: (value: string) => `enc:${value}` } as never,
      new SmsProviderRegistry(new TelnyxSmsProvider()),
    );
    const input = {
      provider: 'telnyx' as const,
      apiKey: 'KEY_LIVE_123',
      phoneNumber: businessNumber.replace('+1', '1 '),
      messagingProfileId: 'profile-1',
      publicKey,
      helpText: 'Ajuda: responda aqui.',
    };
    try {
      const first = await channels.connect(ctx, input);
      expect(first.health).toMatchObject({
        ok: true,
        webhookConfigured: true,
        failoverConfigured: false,
      });
      expect(first.webhookUrls.failover).toBe(
        'https://api.example.test/api/inbox/channels/sms/telnyx/webhook/failover',
      );
      expect(JSON.stringify(first.channel)).not.toContain('KEY_LIVE_123');
      const row = await AgencyDataSource.getRepository(
        InboxChannelEntity,
      ).findOneByOrFail({ id: first.channel.id });
      expect(row).toMatchObject({
        type: 'sms',
        provider: 'telnyx',
        status: 'active',
        connectionStatus: 'connected',
        externalPhoneNumberId: businessNumber,
        externalAccountId: null,
        accessTokenEncrypted: 'enc:KEY_LIVE_123',
        scopeKind: 'agency',
        metadata: expect.objectContaining({
          operatingMode: 'agency',
          telnyxMessagingProfileId: 'profile-1',
          webhookPublicKey: publicKey,
          helpText: 'Ajuda: responda aqui.',
        }) as unknown,
      });

      await AgencyDataSource.getRepository(InboxChannelEntity).update(
        { id: row.id },
        { connectionStatus: 'disconnected', accessTokenEncrypted: null },
      );
      const again = await channels.connect(ctx, input);
      expect(again.channel.id).toBe(row.id);
      expect(again.channel.credentialVersion).toBe(row.credentialVersion + 1);

      await expect(
        channels.connect(
          { tenantId: otherTenantId, workspaceId, userId },
          input,
        ),
      ).rejects.toThrow(ConflictException);
    } finally {
      if (previousBase === undefined) delete process.env.API_PUBLIC_URL;
      else process.env.API_PUBLIC_URL = previousBase;
    }
  });
});
