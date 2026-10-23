/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any */
import { ConflictException, NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { CreateInboxComments1800400000000 } from '../../../database/migrations/1800400000000-create-inbox-comments';
import { deleteFixtureTenant } from '../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { getPermissionDefinition } from '../../permissions/catalog/permission-keys.catalog';
import {
  extractMetaCommentChanges,
  normalizeMetaCommentChange,
} from '../channels/meta/adapters/meta-comment.normalizer';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxCommentAgentActionEntity } from '../entities/inbox-comment-agent-action.entity';
import { InboxCommentEntity } from '../entities/inbox-comment.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxCommentAgentService } from './inbox-comment-agent.service';
import { InboxCommentGraphClient } from './inbox-comment-graph.client';
import { InboxCommentService } from './inbox-comment.service';
import { SocialAdStoryLookupRegistry } from './social-ad-story-lookup.port';

const run = describePostgresIntegration();
const DAY = 24 * 60 * 60 * 1000;

type FetchCall = {
  method: string;
  url: URL;
  body: Record<string, unknown> | null;
};

/**
 * IX3 on real queries: comment ingestion and its echo, the public/private
 * replies and moderation through the real Graph client (only `fetch` is a
 * stub), the 7-day / one-private-reply rule, scope, the agent ledger and its
 * kill switch, the Social ad port, and the migration's up/down/up.
 */
run('Inbox comments PostgreSQL (IX3)', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const agentId = randomUUID();
  const migration = new CreateInboxComments1800400000000();
  const ctx = { tenantId, workspaceId, userId };
  const companyCtx = {
    tenantId,
    workspaceId,
    userId,
    managedContext: {
      productKey: 'leadflow' as const,
      operatingMode: 'client' as const,
      clientId: randomUUID(),
      companyContextId: randomUUID(),
      managedTenantId: null,
    },
  };
  let calls: FetchCall[] = [];
  let respond: (call: FetchCall) => {
    status?: number;
    body: unknown;
  } = () => ({
    body: { id: 'graph-id' },
  });

  const resetFixtures = () =>
    deleteFixtureTenant(AgencyDataSource, tenantId, [
      'inbox_comment_agent_actions',
      'inbox_comments',
      'inbox_comment_contents',
      'inbox_autonomy_controls',
      'inbox_conversations',
      'inbox_channels',
    ]);

  beforeAll(async () => {
    if (AgencyDataSource.options.database !== 'lyra_agency_test') {
      throw new Error('IX3 comments spec requires lyra_agency_test.');
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
    await resetFixtures();
    calls = [];
    respond = () => ({ body: { id: 'graph-id' } });
    jest.spyOn(global, 'fetch').mockImplementation((input, init) => {
      const call: FetchCall = {
        method: init?.method ?? 'GET',
        url: new URL(input as string),
        body: init?.body
          ? (JSON.parse(init.body as string) as Record<string, unknown>)
          : null,
      };
      calls.push(call);
      const { status = 200, body } = respond(call);
      return Promise.resolve(
        new Response(JSON.stringify(body), {
          status,
          headers: { 'Content-Type': 'application/json' },
        }),
      );
    });
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await resetFixtures();
      await AgencyDataSource.destroy();
    }
  });

  function services(registry = new SocialAdStoryLookupRegistry()) {
    const comments = new InboxCommentService(
      AgencyDataSource,
      { decrypt: () => 'synthetic-page-token' } as never,
      new InboxCommentGraphClient(),
      registry,
    );
    return { comments, registry };
  }

  async function seedChannel(
    type: 'facebook_messenger' | 'instagram' = 'facebook_messenger',
  ) {
    return AgencyDataSource.getRepository(InboxChannelEntity).save({
      tenantId,
      workspaceId,
      name: `Synthetic ${type}`,
      type,
      provider: 'meta',
      status: 'active',
      connectionStatus: 'connected',
      externalAccountId:
        type === 'instagram' ? '17841400000000001' : '100000000000001',
      externalPageId: '100000000000001',
      accessTokenEncrypted: 'synthetic-encrypted-token',
      scopeKind: 'agency',
      agencyClientId: null,
      companyContextId: null,
      aiEnabled: true,
      defaultAgentId: agentId,
      settings: {},
      metadata:
        type === 'instagram' ? { authorizationMethod: 'facebook_login' } : {},
    });
  }

  function feedComment(input: {
    commentId: string;
    authorId?: string;
    verb?: string;
    parentId?: string;
    createdAt?: Date;
    published?: boolean;
  }) {
    const [change] = extractMetaCommentChanges({
      object: 'page',
      entry: [
        {
          id: '100000000000001',
          changes: [
            {
              field: 'feed',
              value: {
                item: 'comment',
                verb: input.verb ?? 'add',
                comment_id: input.commentId,
                post_id: '100000000000001_200000000000001',
                parent_id: input.parentId ?? '100000000000001_200000000000001',
                from: {
                  id: input.authorId ?? '7000000000001',
                  name: 'Marina Souza',
                },
                message: 'Quero saber o preço',
                created_time: Math.floor(
                  (input.createdAt ?? new Date()).getTime() / 1000,
                ),
                post: { is_published: input.published ?? true },
              },
            },
          ],
        },
      ],
    });
    const result = normalizeMetaCommentChange(change);
    if (result.outcome !== 'normalized') throw new Error(result.reason);
    return result.comment;
  }

  it('migration is additive and reversible (up/down/up) and seeds the comment keys', async () => {
    const runner = AgencyDataSource.createQueryRunner();
    const tables = async () =>
      (
        await AgencyDataSource.query<Array<{ table_name: string }>>(
          `SELECT table_name FROM information_schema.tables
            WHERE table_name IN ('inbox_comments','inbox_comment_contents','inbox_comment_agent_actions')`,
        )
      ).map((row) => row.table_name);
    const storyColumn = async () =>
      (
        await AgencyDataSource.query<unknown[]>(
          `SELECT 1 FROM information_schema.columns
            WHERE table_name = 'social_ad_entities' AND column_name = 'effective_object_story_id'`,
        )
      ).length;
    try {
      await migration.down(runner);
      expect(await tables()).toEqual([]);
      expect(await storyColumn()).toBe(0);
      await migration.up(runner);
      await migration.up(runner);
    } finally {
      await runner.release();
    }
    expect((await tables()).sort()).toEqual([
      'inbox_comment_agent_actions',
      'inbox_comment_contents',
      'inbox_comments',
    ]);
    expect(await storyColumn()).toBe(1);
    const keys = await AgencyDataSource.query<
      Array<{ key: string; is_dangerous: boolean }>
    >(
      `SELECT key, is_dangerous FROM platform_permissions WHERE key LIKE 'leadflow.inbox.comment.%' ORDER BY key`,
    );
    expect(keys).toEqual([
      { key: 'leadflow.inbox.comment.delete.admin', is_dangerous: true },
      { key: 'leadflow.inbox.comment.reply.client', is_dangerous: false },
      { key: 'leadflow.inbox.comment.view.client', is_dangerous: false },
    ]);
    // D-IX-11: deleting is Owner/Admin only.
    expect(
      getPermissionDefinition(
        'leadflow.inbox.comment.delete.admin',
      )?.roles.sort(),
    ).toEqual(['admin', 'owner']);
  });

  it('ingest is idempotent, copies the channel scope, and the edit/hide/remove verbs update the row', async () => {
    const { comments } = services();
    const channel = await seedChannel();
    const first = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_1' }),
    );
    const again = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_1' }),
    );
    expect(first.created).toBe(true);
    expect(again.created).toBe(false);
    expect(first.comment).toMatchObject({
      scopeKind: 'agency',
      agencyClientId: null,
      direction: 'inbound',
      replyStatus: 'unanswered',
      externalParentId: null,
      externalContentId: '100000000000001_200000000000001',
      authorName: 'Marina Souza',
    });
    expect(
      await AgencyDataSource.getRepository(InboxCommentEntity).countBy({
        tenantId,
      }),
    ).toBe(1);

    await comments.ingest(
      channel,
      feedComment({ commentId: 'c_1', verb: 'hide' }),
    );
    expect(
      (
        await AgencyDataSource.getRepository(
          InboxCommentEntity,
        ).findOneByOrFail({ id: first.comment!.id })
      ).status,
    ).toBe('hidden');
    await comments.ingest(
      channel,
      feedComment({ commentId: 'c_1', verb: 'remove' }),
    );
    expect(
      await AgencyDataSource.getRepository(InboxCommentEntity).findOneByOrFail({
        id: first.comment!.id,
      }),
    ).toMatchObject({ status: 'deleted', text: null });
    // A removal for an unknown comment creates nothing.
    await expect(
      comments.ingest(
        channel,
        feedComment({ commentId: 'c_unknown', verb: 'remove' }),
      ),
    ).resolves.toEqual({ comment: null, created: false });
  });

  it('public reply posts on the thread, is idempotent, and its webhook echo stays one outbound row', async () => {
    const { comments } = services();
    const channel = await seedChannel();
    const { comment } = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_1' }),
    );
    respond = () => ({ body: { id: 'reply_1' } });

    const sent = await comments.replyPublic(
      ctx,
      comment!.id,
      'Te chamei no direct!',
      'key-1',
      {
        type: 'user',
        userId,
      },
    );
    const replay = await comments.replyPublic(
      ctx,
      comment!.id,
      'Te chamei no direct!',
      'key-1',
      {
        type: 'user',
        userId,
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].method).toBe('POST');
    expect(calls[0].url.pathname).toMatch(/\/c_1\/comments$/);
    expect(calls[0].body).toEqual({ message: 'Te chamei no direct!' });
    expect(replay.replayed).toBe(true);
    expect(sent.comment).toMatchObject({
      direction: 'outbound',
      authorUserId: userId,
      externalParentId: 'c_1',
      idempotencyKey: 'key-1',
    });

    // The page's own reply comes back on the webhook.
    const echo = await comments.ingest(
      channel,
      feedComment({
        commentId: 'reply_1',
        authorId: '100000000000001',
        parentId: 'c_1',
      }),
    );
    expect(echo.created).toBe(false);
    const rows = await AgencyDataSource.getRepository(
      InboxCommentEntity,
    ).findBy({ tenantId });
    expect(rows).toHaveLength(2);
    expect(
      rows.find((row) => row.externalCommentId === 'reply_1'),
    ).toMatchObject({
      direction: 'outbound',
      authorUserId: userId,
    });
    expect(
      rows.find((row) => row.externalCommentId === 'c_1')?.replyStatus,
    ).toBe('answered');
  });

  it('private reply: once per comment, within 7 days, failure recorded, conversation linked with origin', async () => {
    const { comments } = services();
    const channel = await seedChannel();
    const { comment } = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_1' }),
    );
    respond = (call) =>
      call.url.pathname.endsWith('/messages')
        ? {
            status: 400,
            body: {
              error: { code: 10900, message: 'Activity already replied to' },
            },
          }
        : { body: {} };

    await expect(
      comments.replyPrivate(ctx, comment!.id, 'Oi! Vi seu comentário.', 'p-1', {
        type: 'user',
        userId,
      }),
    ).rejects.toBeInstanceOf(ConflictException);
    // Written after the transaction: the rollback did not erase the attempt.
    expect(
      await AgencyDataSource.getRepository(InboxCommentEntity).findOneByOrFail({
        id: comment!.id,
      }),
    ).toMatchObject({
      privateReplyStatus: 'failed',
      metadata: expect.objectContaining({
        privateReply: expect.objectContaining({
          errorCode: 'meta_comment_private_reply_unavailable',
        }),
      }),
    });

    const conversation = await AgencyDataSource.getRepository(
      InboxConversationEntity,
    ).save({
      tenantId,
      workspaceId,
      channelId: channel.id,
      externalThreadId: 'facebook_messenger:100000000000001:7000000000001',
      scopeKind: 'agency',
      agencyClientId: null,
      companyContextId: null,
      status: 'open',
      source: 'facebook_messenger',
      businessMode: 'general',
      ownershipState: 'ai_active',
      ownershipVersion: 1,
      ownershipChangedAt: new Date(),
      aiEnabled: true,
      qualificationStatus: 'pending',
      metadata: {},
    });
    calls = [];
    respond = () => ({
      body: { recipient_id: '7000000000001', message_id: 'mid.1' },
    });
    const sent = await comments.replyPrivate(
      ctx,
      comment!.id,
      'Oi! Vi seu comentário.',
      'p-2',
      {
        type: 'user',
        userId,
      },
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].url.pathname).toMatch(/\/100000000000001\/messages$/);
    expect(calls[0].body).toEqual({
      recipient: { comment_id: 'c_1' },
      message: { text: 'Oi! Vi seu comentário.' },
    });
    expect(sent.comment).toMatchObject({
      privateReplyStatus: 'sent',
      replyStatus: 'answered',
      privateReplyConversationId: conversation.id,
    });
    expect(
      (
        await AgencyDataSource.getRepository(
          InboxConversationEntity,
        ).findOneByOrFail({ id: conversation.id })
      ).metadata.origin,
    ).toEqual({
      type: 'comment',
      commentId: comment!.id,
      contentId: '100000000000001_200000000000001',
      adId: null,
    });

    await expect(
      comments.replyPrivate(ctx, comment!.id, 'De novo', 'p-3', {
        type: 'user',
        userId,
      }),
    ).rejects.toThrow('comment_private_reply_already_sent');
    await expect(
      comments.replyPrivate(ctx, comment!.id, 'Oi! Vi seu comentário.', 'p-2', {
        type: 'user',
        userId,
      }),
    ).resolves.toMatchObject({ replayed: true });

    const old = await comments.ingest(
      channel,
      feedComment({
        commentId: 'c_old',
        createdAt: new Date(Date.now() - 8 * DAY),
      }),
    );
    calls = [];
    await expect(
      comments.replyPrivate(ctx, old.comment!.id, 'Oi', 'p-4', {
        type: 'user',
        userId,
      }),
    ).rejects.toThrow('comment_private_reply_expired');
    expect(calls).toHaveLength(0);
  });

  it('opted-out author: the private reply is refused before Meta is called', async () => {
    const { comments } = services();
    const channel = await seedChannel();
    const { comment } = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_1' }),
    );
    await AgencyDataSource.getRepository(InboxConversationEntity).save({
      tenantId,
      workspaceId,
      channelId: channel.id,
      externalThreadId: 'facebook_messenger:100000000000001:7000000000001',
      scopeKind: 'agency',
      agencyClientId: null,
      companyContextId: null,
      status: 'open',
      source: 'facebook_messenger',
      businessMode: 'general',
      ownershipState: 'ai_active',
      ownershipVersion: 1,
      ownershipChangedAt: new Date(),
      aiEnabled: true,
      qualificationStatus: 'pending',
      metadata: { leadflowOutboundOptOut: { status: 'opted_out' } },
    });
    await expect(
      comments.replyPrivate(ctx, comment!.id, 'Oi', 'p-1', {
        type: 'user',
        userId,
      }),
    ).rejects.toThrow('comment_author_opted_out');
    expect(calls).toHaveLength(0);
  });

  it('scope: another scope gets 404 and an empty list; hide and delete hit Meta and are audited', async () => {
    const { comments } = services();
    const channel = await seedChannel();
    const { comment } = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_1' }),
    );

    await expect(
      comments.getThread(companyCtx, comment!.id),
    ).rejects.toBeInstanceOf(NotFoundException);
    await expect(
      comments.replyPublic(companyCtx, comment!.id, 'x', 'k', {
        type: 'user',
        userId,
      }),
    ).rejects.toBeInstanceOf(NotFoundException);
    expect((await comments.list(companyCtx, {})).items).toEqual([]);
    expect(calls).toHaveLength(0);

    respond = () => ({ body: { success: true } });
    const hidden = await comments.setHidden(ctx, comment!.id, true);
    expect(calls[0]).toMatchObject({
      method: 'POST',
      body: { is_hidden: true },
    });
    expect(hidden.status).toBe('hidden');

    const removed = await comments.remove(ctx, comment!.id);
    expect(calls[1].method).toBe('DELETE');
    expect(removed).toMatchObject({ status: 'deleted', text: null });
    expect(removed.metadata.moderation).toEqual([
      expect.objectContaining({ action: 'hide', userId }),
      expect.objectContaining({ action: 'delete', userId }),
    ]);
    expect((await comments.list(ctx, {})).items).toEqual([]);
  });

  it('list: display name is never an id; ad filter and the Social port name a Facebook ad', async () => {
    const registry = new SocialAdStoryLookupRegistry();
    registry.register({
      findByStoryId: jest.fn().mockResolvedValue({
        adId: '1202',
        adName: 'Black Friday',
        campaignName: 'Vendas Q4',
      }),
    });
    const { comments } = services(registry);
    const channel = await seedChannel();
    const ad = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_ad', published: false }),
    );
    respond = () => ({
      body: {
        id: '100000000000001_200000000000001',
        permalink_url: 'https://www.facebook.com/p/1',
        message: 'Oferta',
        full_picture: 'https://scontent.example/x.jpg',
        is_published: false,
      },
    });

    const thread = await comments.getThread(ctx, ad.comment!.id);
    expect(thread.content).toMatchObject({
      isSponsored: true,
      ad: {
        externalId: '1202',
        name: 'Black Friday',
        campaignName: 'Vendas Q4',
      },
    });
    const listed = await comments.list(ctx, { onlyAds: true });
    expect(listed.items).toHaveLength(1);
    expect(listed.items[0]).toMatchObject({
      isAd: true,
      author: { displayName: 'Marina Souza' },
      ad: { name: 'Black Friday' },
    });

    const igChannel = await seedChannel('instagram');
    const [change] = extractMetaCommentChanges({
      object: 'instagram',
      entry: [
        {
          id: '17841400000000001',
          changes: [
            {
              field: 'comments',
              value: {
                comment_id: '179',
                text: 'oi',
                from: { id: '61' },
                media: { id: '18' },
              },
            },
          ],
        },
      ],
    });
    const normalized = normalizeMetaCommentChange(change);
    if (normalized.outcome !== 'normalized') throw new Error('normalize');
    await comments.ingest(igChannel, normalized.comment);
    const ig = await comments.list(ctx, { channelType: 'instagram' });
    expect(ig.items[0].author.displayName).toBe('Pessoa no Instagram');
    expect(JSON.stringify(ig.items[0].author)).not.toContain('"61"');
  });

  it('agent: plans once per author and content in 24h, honours the kill switch, sends private then public', async () => {
    const { comments } = services();
    const channel = await seedChannel();
    const evaluation = {
      wouldActivate: true,
      policyVersion: 'comment-activation-v1',
      trigger: 'keywords',
      reasonCode: 'keyword_match',
      exclusions: [] as string[],
      resolved: {
        channelId: channel.id,
        bindingId: 'b',
        agentId,
        agentVersionId: null,
      },
      publicReplyText: 'Te chamei no direct!',
    };
    const activation = {
      evaluateComment: jest.fn().mockResolvedValue(evaluation),
    };
    const provider = {
      composeCommentReply: jest.fn().mockResolvedValue({
        reply: 'Oi, Marina! Vi seu comentário.',
        model: 'mock',
      }),
    };
    const config = { autoReplyEnabled: true };
    const agent = new InboxCommentAgentService(
      AgencyDataSource,
      activation as never,
      comments,
      provider as never,
      config as never,
    );
    const first = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_1' }),
    );
    const second = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_2' }),
    );
    await expect(agent.consider(first.comment!)).resolves.toEqual({
      planned: true,
      reasonCode: 'keyword_match',
    });
    await expect(agent.consider(second.comment!)).resolves.toEqual({
      planned: false,
      reasonCode: 'comment_agent_recently_active',
    });

    // Kill switch read at execution time.
    await AgencyDataSource.query(
      `INSERT INTO inbox_autonomy_controls (tenant_id, workspace_id, scope_kind, reply_enabled, crm_enabled, handoff_enabled)
       VALUES ($1, $2, 'agency', false, true, true)`,
      [tenantId, workspaceId],
    );
    await expect(agent.processOnce()).resolves.toMatchObject({
      status: 'blocked',
      errorCode: 'effect_kill_switch',
    });
    expect(calls).toHaveLength(0);

    await AgencyDataSource.query(
      'UPDATE inbox_autonomy_controls SET reply_enabled = true WHERE tenant_id = $1',
      [tenantId],
    );
    const third = await comments.ingest(
      channel,
      feedComment({ commentId: 'c_3', authorId: '7000000000009' }),
    );
    await agent.consider(third.comment!);
    respond = (call) =>
      call.url.pathname.endsWith('/messages')
        ? { body: { recipient_id: '7000000000009', message_id: 'mid.9' } }
        : { body: { id: 'reply_9' } };
    const applied = await agent.processOnce();
    expect(applied).toMatchObject({
      status: 'applied',
      errorCode: null,
      applicationResult: expect.objectContaining({
        publicReplyCommentId: expect.any(String),
      }),
    });
    expect(calls.map((call) => call.url.pathname.split('/').at(-1))).toEqual([
      'messages',
      'comments',
    ]);
    expect(calls[0].body).toMatchObject({ recipient: { comment_id: 'c_3' } });
    expect(
      await AgencyDataSource.getRepository(InboxCommentEntity).findOneByOrFail({
        id: third.comment!.id,
      }),
    ).toMatchObject({ privateReplyStatus: 'sent', replyStatus: 'answered' });
    expect(
      await AgencyDataSource.getRepository(
        InboxCommentAgentActionEntity,
      ).countBy({ tenantId }),
    ).toBe(2);
  });
});
