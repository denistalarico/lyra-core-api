import { NotFoundException } from '@nestjs/common';
import { MetaChannelUnavailableError } from '../channels/meta/services/meta-channel-resolver.service';
import { InboxCommentIngestionService } from './inbox-comment-ingestion.service';

describe('InboxCommentIngestionService (IX3 webhook changes[])', () => {
  const channel = { id: 'ch', tenantId: 't', workspaceId: 'w' };
  function harness() {
    const resolver = {
      findFacebookMessengerChannelByPageId: jest
        .fn()
        .mockResolvedValue(channel),
      findInstagramChannelByAccountId: jest.fn().mockResolvedValue(channel),
    };
    const comments = {
      ingest: jest.fn().mockResolvedValue({
        comment: { id: 'row', externalCommentId: 'c_1', direction: 'inbound' },
        created: true,
      }),
    };
    const agent = {
      consider: jest
        .fn()
        .mockResolvedValue({ planned: true, reasonCode: 'keyword_match' }),
    };
    const webhookLog = { create: jest.fn().mockResolvedValue(undefined) };
    const service = new InboxCommentIngestionService(
      resolver as never,
      comments as never,
      agent as never,
      webhookLog as never,
    );
    return { service, resolver, comments, agent, webhookLog };
  }
  const feed = (value: Record<string, unknown>, id = 'page-1') => ({
    object: 'page',
    entry: [{ id, changes: [{ field: 'feed', value }] }],
  });
  const comment = {
    item: 'comment',
    verb: 'add',
    comment_id: 'c_1',
    post_id: 'p_1',
    message: 'oi',
  };

  it('ingests a comment, plans the agent and logs event_type comment with ids only', async () => {
    const h = harness();
    const result = await h.service.processWebhook({
      workload: 'messenger',
      payload: feed(comment),
      signatureReceived: true,
    });
    expect(
      h.resolver.findFacebookMessengerChannelByPageId,
    ).toHaveBeenCalledWith('page-1');
    expect(result).toMatchObject({
      commentsProcessed: 1,
      commentResults: [
        { commentId: 'row', outcome: 'created', agent: 'planned' },
      ],
    });
    expect(h.webhookLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        eventType: 'comment',
        status: 'processed',
        tenantId: 't',
        channelId: 'ch',
        payload: {},
      }),
    );
    expect(JSON.stringify(h.webhookLog.create.mock.calls)).not.toContain(
      '"oi"',
    );
  });

  it('the rest of the feed and unknown accounts are ignored with safe codes', async () => {
    const h = harness();
    h.resolver.findFacebookMessengerChannelByPageId
      .mockRejectedValueOnce(new NotFoundException())
      .mockRejectedValueOnce(new MetaChannelUnavailableError({} as never));
    const result = await h.service.processWebhook({
      workload: 'messenger',
      payload: {
        object: 'page',
        entry: [
          {
            id: 'p',
            changes: [
              {
                field: 'feed',
                value: { item: 'reaction', verb: 'add', post_id: 'p_1' },
              },
            ],
          },
          { id: 'unknown', changes: [{ field: 'feed', value: comment }] },
          { id: 'off', changes: [{ field: 'feed', value: comment }] },
        ],
      },
      signatureReceived: true,
    });
    expect(result.ignored).toEqual({
      unsupported_feed_item: 1,
      unresolved_channel: 1,
      channel_unavailable: 1,
    });
    expect(h.comments.ingest).not.toHaveBeenCalled();
    expect(h.webhookLog.create).toHaveBeenCalledWith(
      expect.objectContaining({ eventType: 'comment', status: 'ignored' }),
    );
  });

  it('an agent planning failure keeps the comment and is recorded, not swallowed', async () => {
    const h = harness();
    h.agent.consider.mockRejectedValue(new Error('db down'));
    const result = await h.service.processWebhook({
      workload: 'messenger',
      payload: feed(comment),
      signatureReceived: true,
    });
    expect(result.commentResults[0].agent).toBe('agent_plan_failed');
  });

  it('a storage failure is logged as failed and rethrown so Meta retries', async () => {
    const h = harness();
    h.comments.ingest.mockRejectedValue(new Error('boom'));
    await expect(
      h.service.processWebhook({
        workload: 'messenger',
        payload: feed(comment),
        signatureReceived: true,
      }),
    ).rejects.toThrow('boom');
    expect(h.webhookLog.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'failed',
        errorMessage: 'comment_effect_failed',
      }),
    );
  });

  it('own-account and reconciled echoes never wake the agent', async () => {
    const h = harness();
    h.comments.ingest.mockResolvedValue({
      comment: { id: 'row', externalCommentId: 'c_1', direction: 'outbound' },
      created: true,
    });
    await h.service.processWebhook({
      workload: 'messenger',
      payload: feed(comment),
      signatureReceived: true,
    });
    expect(h.agent.consider).not.toHaveBeenCalled();
  });
});
