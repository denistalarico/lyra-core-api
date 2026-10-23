/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any */
import {
  extractMetaCommentChanges,
  normalizeMetaCommentChange,
  type MetaCommentChange,
} from './meta-comment.normalizer';

const first = (payload: unknown): MetaCommentChange => {
  const [change] = extractMetaCommentChanges(payload);
  if (!change) throw new Error('no change');
  return change;
};

describe('meta-comment.normalizer (IX3)', () => {
  it('Instagram, Facebook Login variant: reads comment_id and the ad fields (AI-06)', () => {
    const result = normalizeMetaCommentChange(
      first({
        object: 'instagram',
        entry: [
          {
            id: '17841400000000001',
            time: 1_760_000_000,
            changes: [
              {
                field: 'comments',
                value: {
                  from: { id: '6100000000001', username: 'marina.souza' },
                  comment_id: '17900000000000001',
                  text: 'Quero saber o preço',
                  media: {
                    id: '18000000000000001',
                    ad_id: '120200000000001',
                    ad_title: 'Black Friday',
                    original_media_id: '18000000000000000',
                    media_product_type: 'FEED',
                  },
                },
              },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual({
      outcome: 'normalized',
      comment: expect.objectContaining({
        surface: 'instagram',
        accountExternalId: '17841400000000001',
        lifecycle: 'created',
        externalCommentId: '17900000000000001',
        externalParentId: null,
        externalContentId: '18000000000000001',
        contentKind: 'ad',
        adExternalId: '120200000000001',
        adTitle: 'Black Friday',
        authorExternalId: '6100000000001',
        authorUsername: 'marina.souza',
        fromOwnAccount: false,
        text: 'Quero saber o preço',
        occurredAt: new Date(1_760_000_000_000),
        metadata: expect.objectContaining({
          originalMediaId: '18000000000000000',
        }),
      }),
    });
  });

  it('Instagram, Instagram Login variant: falls back to value.id; reels and replies', () => {
    const result = normalizeMetaCommentChange(
      first({
        object: 'instagram',
        entry: [
          {
            id: '17841400000000001',
            changes: [
              {
                field: 'comments',
                value: {
                  id: '17900000000000002',
                  parent_id: '17900000000000001',
                  from: { id: '17841400000000001', username: 'loja' },
                  text: 'Te chamei no direct!',
                  media: {
                    id: '18000000000000002',
                    media_product_type: 'REELS',
                  },
                },
              },
            ],
          },
        ],
      }),
    );
    expect(result.outcome).toBe('normalized');
    if (result.outcome !== 'normalized') return;
    expect(result.comment).toMatchObject({
      externalCommentId: '17900000000000002',
      externalParentId: '17900000000000001',
      contentKind: 'reel',
      fromOwnAccount: true,
      adExternalId: null,
    });
  });

  it('Instagram live_comments is a live content kind', () => {
    const result = normalizeMetaCommentChange(
      first({
        object: 'instagram',
        entry: [
          {
            id: '1',
            changes: [
              {
                field: 'live_comments',
                value: { id: '2', text: 'oi', media: { id: '3' } },
              },
            ],
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      outcome: 'normalized',
      comment: { contentKind: 'live' },
    });
  });

  it('Facebook feed comment: post id is content, parent equal to post is not a parent', () => {
    const result = normalizeMetaCommentChange(
      first({
        object: 'page',
        entry: [
          {
            id: '100000000000001',
            time: 1_760_000_100,
            changes: [
              {
                field: 'feed',
                value: {
                  from: { id: '7000000000001', name: 'Marina Souza' },
                  item: 'comment',
                  verb: 'add',
                  post_id: '100000000000001_200000000000001',
                  comment_id: '200000000000001_300000000000001',
                  parent_id: '100000000000001_200000000000001',
                  message: 'Tem para entrega?',
                  created_time: 1_760_000_050,
                  post: { is_published: false, id: 'x' },
                },
              },
            ],
          },
        ],
      }),
    );
    expect(result).toEqual({
      outcome: 'normalized',
      comment: expect.objectContaining({
        surface: 'facebook',
        lifecycle: 'created',
        externalCommentId: '200000000000001_300000000000001',
        externalParentId: null,
        externalContentId: '100000000000001_200000000000001',
        contentKind: 'ad',
        authorName: 'Marina Souza',
        authorUsername: null,
        fromOwnAccount: false,
        text: 'Tem para entrega?',
        providerCreatedAt: new Date(1_760_000_050_000),
      }),
    });
  });

  it.each([
    ['edited', 'updated'],
    ['remove', 'removed'],
    ['delete', 'removed'],
    ['hide', 'hidden'],
    ['unhide', 'unhidden'],
  ])('Facebook verb %s is lifecycle %s', (verb, lifecycle) => {
    const result = normalizeMetaCommentChange(
      first({
        object: 'page',
        entry: [
          {
            id: 'p',
            changes: [
              {
                field: 'feed',
                value: {
                  item: 'comment',
                  verb,
                  comment_id: 'c_1',
                  post_id: 'p_1',
                  parent_id: 'c_0',
                },
              },
            ],
          },
        ],
      }),
    );
    expect(result).toMatchObject({
      outcome: 'normalized',
      comment: { lifecycle, externalParentId: 'c_0' },
    });
  });

  it.each([
    [
      { item: 'reaction', verb: 'add', post_id: 'p_1' },
      'unsupported_feed_item',
    ],
    [{ item: 'post', verb: 'add', post_id: 'p_1' }, 'unsupported_feed_item'],
    [
      { item: 'comment', verb: 'block', comment_id: 'c' },
      'unsupported_feed_verb',
    ],
    [{ item: 'comment', verb: 'add' }, 'missing_external_id'],
  ])(
    'the rest of the feed is ignored with a safe code (%o)',
    (value, reason) => {
      expect(
        normalizeMetaCommentChange(
          first({
            object: 'page',
            entry: [{ id: 'p', changes: [{ field: 'feed', value }] }],
          }),
        ),
      ).toEqual({ outcome: 'ignored', reason });
    },
  );

  it('other fields and malformed values never normalize', () => {
    expect(
      normalizeMetaCommentChange(
        first({
          object: 'instagram',
          entry: [{ id: '1', changes: [{ field: 'mentions', value: {} }] }],
        }),
      ),
    ).toEqual({ outcome: 'ignored', reason: 'unsupported_field' });
    expect(
      normalizeMetaCommentChange(
        first({
          object: 'instagram',
          entry: [{ id: '1', changes: [{ field: 'comments' }] }],
        }),
      ),
    ).toEqual({ outcome: 'ignored', reason: 'malformed_payload' });
    expect(
      normalizeMetaCommentChange(
        first({
          object: 'instagram',
          entry: [
            {
              id: '1',
              changes: [{ field: 'comments', value: { id: '../x' } }],
            },
          ],
        }),
      ),
    ).toEqual({ outcome: 'ignored', reason: 'missing_external_id' });
  });

  it('a messaging-only body carries no comment changes', () => {
    expect(
      extractMetaCommentChanges({
        object: 'page',
        entry: [{ id: 'p', messaging: [{ message: { text: 'oi' } }] }],
      }),
    ).toEqual([]);
    expect(
      extractMetaCommentChanges({ object: 'whatsapp_business_account' }),
    ).toEqual([]);
  });
});
