import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../../testing/postgres-integration';
import { InboxAttributionObservationEntity } from '../../entities/inbox-attribution-observation.entity';
import { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../entities/inbox-conversation.entity';
import type { NormalizedInboundMessage } from '../types/normalized-inbound-message';
import { InboundMessageIngestionService } from './inbound-message-ingestion.service';

const run = describePostgresIntegration();

/**
 * The referral is observed on a real ingest, against a real database.
 *
 * A unit test cannot prove what matters here. The guarantees are the unique
 * index, the check constraint and the foreign keys — none of which exist in a
 * mocked repository — and the questions the table has to answer (which
 * observation was first, does a retried webhook duplicate) are questions about
 * committed rows.
 */
run('Inbound Meta referral attribution', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const agencyClientId = randomUUID();

  const notificationPublisher = {
    publishInboundMessage: jest.fn().mockResolvedValue(undefined),
  };

  // No activation policy: this suite is about persistence. The policy's own
  // contract with the referral is asserted separately, below.
  const service = new InboundMessageIngestionService(
    AgencyDataSource,
    notificationPublisher as never,
  );

  const tables = [
    'inbox_conversation_events',
    'inbox_attribution_observations',
    'inbox_messages',
    'inbox_conversations',
    'inbox_domain_outbox',
    'inbox_processing_batches',
    'inbox_channels',
  ];

  const resetFixtures = async () => {
    await deleteFixtureTenant(AgencyDataSource, tenantId, tables);
  };

  let channelId: string;

  const createChannel = async (clientId: string | null) => {
    const channel = await AgencyDataSource.getRepository(
      InboxChannelEntity,
    ).save({
      tenantId,
      workspaceId,
      name: 'WhatsApp Attribution',
      type: 'whatsapp',
      provider: 'meta',
      status: 'active',
      connectionStatus: 'connected',
      lifecycleVersion: 1,
      credentialVersion: 1,
      aiEnabled: false,
      settings: {},
      metadata: clientId ? { clientId } : {},
    });
    return channel.id;
  };

  const inbound = (
    overrides: Partial<NormalizedInboundMessage> & {
      referral?: Record<string, unknown> | null;
    } = {},
  ): NormalizedInboundMessage => {
    const { referral, ...rest } = overrides;
    return {
      tenantId,
      workspaceId,
      channelId,
      channelType: 'whatsapp',
      provider: 'meta',
      externalThreadId: '5511999990000',
      externalMessageId: `wamid.${randomUUID()}`,
      sender: { externalId: '5511999990000', phone: '5511999990000' },
      messageType: 'text',
      content: 'Vim pelo anúncio',
      occurredAt: new Date('2026-08-20T12:00:00.000Z'),
      ...rest,
      metadata: {
        phoneNumberId: 'phone-1',
        referralTrusted: Boolean(referral),
        referral: referral ?? null,
        ...(rest.metadata ?? {}),
      },
    };
  };

  const observations = (conversationId?: string) =>
    AgencyDataSource.getRepository(InboxAttributionObservationEntity).find({
      where: {
        tenantId,
        ...(conversationId ? { conversationId } : {}),
      },
      order: { observedAt: 'ASC' },
    });

  beforeAll(async () => {
    await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await resetFixtures();
      await AgencyDataSource.destroy();
    }
  });

  beforeEach(async () => {
    await resetFixtures();
    notificationPublisher.publishInboundMessage.mockClear();
    channelId = await createChannel(agencyClientId);
  });

  it('persists the ad id, click id and source type of a first inbound referral', async () => {
    const result = await service.ingest(
      inbound({
        referral: {
          adId: '120210000000000000',
          clickId: 'ARAaBbCcDd',
          sourceType: 'ad',
        },
      }),
    );

    const rows = await observations();

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      tenantId,
      workspaceId,
      agencyClientId,
      conversationId: result.conversation.id,
      messageId: result.message.id,
      channelId,
      provider: 'meta',
      channelType: 'whatsapp',
      adId: '120210000000000000',
      clickId: 'ARAaBbCcDd',
      sourceType: 'ad',
    });
    expect(rows[0].observedAt).toEqual(new Date('2026-08-20T12:00:00.000Z'));
  });

  it('writes nothing when the provider sent no referral', async () => {
    await service.ingest(inbound());

    await expect(observations()).resolves.toHaveLength(0);
  });

  // The absence of a row is the representation of "origin unknown". Inventing
  // a row with null identifiers would turn "we did not observe" into "we
  // observed nothing in particular", which reads as a source in every later
  // aggregate.
  it('writes nothing for a referral that identifies nothing', async () => {
    await service.ingest(
      inbound({ referral: { adId: null, clickId: null, sourceType: 'ad' } }),
    );

    await expect(observations()).resolves.toHaveLength(0);
  });

  it('records an organic-surface referral that carries only a click id', async () => {
    await service.ingest(
      inbound({
        referral: { adId: null, clickId: 'clid-organic', sourceType: 'post' },
      }),
    );

    const rows = await observations();

    expect(rows).toHaveLength(1);
    expect(rows[0].adId).toBeNull();
    expect(rows[0].clickId).toBe('clid-organic');
    expect(rows[0].sourceType).toBe('post');
  });

  it('leaves a later inbound without a referral unattributed, keeping the first', async () => {
    const first = await service.ingest(
      inbound({
        referral: { adId: 'ad-first', clickId: 'clid-first', sourceType: 'ad' },
      }),
    );
    await service.ingest(
      inbound({ occurredAt: new Date('2026-08-20T13:00:00.000Z') }),
    );

    const rows = await observations(first.conversation.id);

    expect(rows).toHaveLength(1);
    expect(rows[0].adId).toBe('ad-first');
  });

  // A retried webhook resolves to the same `inbox_messages` row, so it lands
  // on the per-message unique key and does nothing.
  it('does not duplicate an observation when the webhook is redelivered', async () => {
    const message = inbound({
      referral: { adId: 'ad-dupe', clickId: 'clid-dupe', sourceType: 'ad' },
    });

    const first = await service.ingest(message);
    const replay = await service.ingest(message);

    expect(replay.deduplicated).toBe(true);
    expect(replay.message.id).toBe(first.message.id);
    await expect(observations()).resolves.toHaveLength(1);
  });

  it('records the same referral arriving on a second message as its own observation', async () => {
    const first = await service.ingest(
      inbound({
        referral: { adId: 'ad-same', clickId: 'clid-same', sourceType: 'ad' },
      }),
    );
    await service.ingest(
      inbound({
        occurredAt: new Date('2026-08-20T14:00:00.000Z'),
        referral: { adId: 'ad-same', clickId: 'clid-same', sourceType: 'ad' },
      }),
    );

    const rows = await observations(first.conversation.id);

    // Two messages, two observations. They are not de-duplicated by value:
    // the same ad clicked twice is two clicks, and collapsing them would
    // make a returning lead indistinguishable from a single visit.
    expect(rows).toHaveLength(2);
    expect(rows.map((row) => row.messageId)).toHaveLength(2);
    expect(new Set(rows.map((row) => row.messageId)).size).toBe(2);
  });

  // The requirement the whole model exists for: a second ad must not erase the
  // first, so first-touch stays derivable.
  it('preserves the first observation when a different referral arrives later', async () => {
    const first = await service.ingest(
      inbound({
        referral: { adId: 'ad-one', clickId: 'clid-one', sourceType: 'ad' },
      }),
    );
    await service.ingest(
      inbound({
        occurredAt: new Date('2026-09-01T10:00:00.000Z'),
        referral: { adId: 'ad-two', clickId: 'clid-two', sourceType: 'ad' },
      }),
    );

    const rows = await observations(first.conversation.id);

    expect(rows.map((row) => row.adId)).toEqual(['ad-one', 'ad-two']);
    // First touch and last touch are both derived, neither is stored.
    expect(rows[0].adId).toBe('ad-one');
    expect(rows[rows.length - 1].adId).toBe('ad-two');
  });

  it('attaches the observation to the existing conversation on a reopened thread', async () => {
    const first = await service.ingest(inbound());
    await AgencyDataSource.getRepository(InboxConversationEntity).update(
      { id: first.conversation.id },
      { status: 'closed', closedAt: new Date() },
    );

    const second = await service.ingest(
      inbound({
        occurredAt: new Date('2026-09-02T10:00:00.000Z'),
        referral: { adId: 'ad-reopen', clickId: 'clid-reopen', sourceType: 'ad' },
      }),
    );

    expect(second.conversation.id).toBe(first.conversation.id);
    const rows = await observations(first.conversation.id);
    expect(rows).toHaveLength(1);
    expect(rows[0].conversationId).toBe(first.conversation.id);
  });

  it('freezes the client binding resolved from the channel', async () => {
    await service.ingest(
      inbound({
        referral: { adId: 'ad-client', clickId: 'clid-client', sourceType: 'ad' },
      }),
    );

    const [row] = await observations();
    expect(row.agencyClientId).toBe(agencyClientId);

    // Re-pointing the channel must not re-attribute the historical row.
    await AgencyDataSource.getRepository(InboxChannelEntity).update(
      { id: channelId },
      { metadata: { clientId: randomUUID() } },
    );

    const [unchanged] = await observations();
    expect(unchanged.agencyClientId).toBe(agencyClientId);
  });

  it('leaves the client binding null for an agency-context channel', async () => {
    channelId = await createChannel(null);

    await service.ingest(
      inbound({
        referral: { adId: 'ad-agency', clickId: 'clid-agency', sourceType: 'ad' },
      }),
    );

    const [row] = await observations();
    expect(row.agencyClientId).toBeNull();
  });

  it('scopes observations to their own tenant and workspace', async () => {
    await service.ingest(
      inbound({
        referral: { adId: 'ad-scope', clickId: 'clid-scope', sourceType: 'ad' },
      }),
    );

    const repository = AgencyDataSource.getRepository(
      InboxAttributionObservationEntity,
    );

    await expect(
      repository.find({ where: { tenantId, workspaceId } }),
    ).resolves.toHaveLength(1);
    await expect(
      repository.find({ where: { tenantId, workspaceId: randomUUID() } }),
    ).resolves.toHaveLength(0);
    await expect(
      repository.find({ where: { tenantId: randomUUID() } }),
    ).resolves.toHaveLength(0);
  });

  it('ignores a referral on an echo of a message the business sent', async () => {
    const first = await service.ingest(inbound());

    await service.ingestEcho(
      inbound({
        occurredAt: new Date('2026-09-03T10:00:00.000Z'),
        referral: { adId: 'ad-echo', clickId: 'clid-echo', sourceType: 'ad' },
      }),
    );

    await expect(observations(first.conversation.id)).resolves.toHaveLength(0);
  });

  it('stores identifiers only, never the provider payload', async () => {
    await service.ingest(
      inbound({
        referral: {
          adId: 'ad-lean',
          clickId: 'clid-lean',
          sourceType: 'ad',
          headline: 'Compre agora com 40% de desconto',
          body: 'Fale com a gente no WhatsApp',
          sourceUrl: 'https://fb.me/promo',
        },
      }),
    );

    const [row] = await observations();
    const stored = JSON.stringify(row);

    expect(row.adId).toBe('ad-lean');
    expect(stored).not.toContain('Compre agora');
    expect(stored).not.toContain('fb.me');
    expect(Object.keys(row)).not.toContain('raw');
    expect(Object.keys(row)).not.toContain('payload');
  });

  it('keeps the existing inbound behaviour intact alongside the observation', async () => {
    const result = await service.ingest(
      inbound({
        referral: { adId: 'ad-intact', clickId: 'clid-intact', sourceType: 'ad' },
      }),
    );

    expect(result.deduplicated).toBe(false);
    expect(result.message.direction).toBe('inbound');
    expect(result.conversation.lastMessagePreview).toBe('Vim pelo anúncio');
    expect(notificationPublisher.publishInboundMessage).toHaveBeenCalledTimes(1);

    const events = await AgencyDataSource.query(
      `SELECT event_type FROM inbox_conversation_events
        WHERE tenant_id = $1 AND conversation_id = $2`,
      [tenantId, result.conversation.id],
    );
    expect(events.map((row: { event_type: string }) => row.event_type)).toEqual(
      expect.arrayContaining(['message_received']),
    );
  });

  /**
   * The identity compatibility this whole step exists to make possible.
   *
   * Not the join itself — that belongs to a later phase — but the proof that
   * the two columns can be compared without a cast, which is the property a
   * migration cannot add later without rewriting history.
   */
  it('stores an ad id in the same identity space as social_ad_entities.external_id', async () => {
    await service.ingest(
      inbound({
        referral: {
          adId: '120210000000000000',
          clickId: 'clid-join',
          sourceType: 'ad',
        },
      }),
    );

    const [types] = await AgencyDataSource.query(
      `SELECT
         (SELECT data_type || ':' || coalesce(character_maximum_length::text, '')
            FROM information_schema.columns
           WHERE table_name = 'inbox_attribution_observations'
             AND column_name = 'ad_id') AS observation_type,
         (SELECT data_type || ':' || coalesce(character_maximum_length::text, '')
            FROM information_schema.columns
           WHERE table_name = 'social_ad_entities'
             AND column_name = 'external_id') AS entity_type`,
    );

    expect(types.observation_type).toBe(types.entity_type);

    // And the comparison itself planner-executes with no cast.
    const joined = await AgencyDataSource.query(
      `SELECT o.ad_id
         FROM inbox_attribution_observations o
         LEFT JOIN social_ad_entities e
           ON e.external_id = o.ad_id
          AND e.entity_level = 'ad'
          AND e.provider = o.provider
        WHERE o.tenant_id = $1`,
      [tenantId],
    );
    expect(joined).toHaveLength(1);
  });
});
