import {
  MAX_INTERACTION_TEXT_LENGTH,
  META_ORGANIC_WEBHOOK_HANDLERS,
  handleInstagramComments,
  handleInstagramMentions,
  handlePageFeed,
  handlePageMention,
  resolveHandlerKey,
} from './meta-organic-webhook.handlers';
import type { MetaWebhookChange } from './meta-organic-webhook.parser';

function change(
  value: Record<string, unknown> | null,
  overrides: Partial<MetaWebhookChange> = {},
): MetaWebhookChange {
  return {
    entryIndex: 0,
    changeIndex: 0,
    externalAssetId: '100',
    entryTime: new Date('2024-09-10T20:26:40.000Z'),
    field: 'feed',
    value,
    ...overrides,
  };
}

function normalized(result: ReturnType<typeof handlePageFeed>) {
  if (result.outcome !== 'normalized') {
    throw new Error(`expected normalized, got ${result.safeErrorCode}`);
  }
  return result.interaction;
}

describe('handlePageFeed', () => {
  it('normalizes the documented "user publishes on a Page" example', () => {
    // Verbatim shape from docs/graph-api/webhooks/getting-started/webhooks-for-pages.
    const interaction = normalized(
      handlePageFeed(
        change({
          from: { id: 'user-1', name: 'Cinderella Hoover' },
          item: 'post',
          post_id: '100_200',
          verb: 'add',
          created_time: 1_520_544_814,
          is_hidden: false,
          message: "It's Thursday and I want to eat cake.",
        }),
      ),
    );

    expect(interaction).toMatchObject({
      surface: 'page_feed',
      interactionType: 'post_created',
      status: 'active',
      externalInteractionId: '100_200',
      externalContentId: '100_200',
      actorExternalId: 'user-1',
      actorDisplayName: 'Cinderella Hoover',
    });
    expect(interaction.providerCreatedAt?.toISOString()).toBe(
      '2018-03-08T21:33:34.000Z',
    );
  });

  it('identifies a comment by its comment id, not the post it sits on', () => {
    const interaction = normalized(
      handlePageFeed(
        change({
          item: 'comment',
          verb: 'add',
          post_id: '100_200',
          comment_id: '200_300',
          message: 'nice',
        }),
      ),
    );

    // Keying a comment by post_id would collapse every comment on a post into
    // a single row — the bug this assertion exists to prevent.
    expect(interaction.externalInteractionId).toBe('200_300');
    expect(interaction.externalContentId).toBe('100_200');
    expect(interaction.interactionType).toBe('comment_created');
  });

  it('treats a reply as parented by the parent comment', () => {
    const interaction = normalized(
      handlePageFeed(
        change({
          item: 'comment',
          verb: 'add',
          post_id: '100_200',
          comment_id: '200_400',
          parent_id: '200_300',
        }),
      ),
    );

    expect(interaction.externalParentId).toBe('200_300');
  });

  it('parents a top-level comment to its post', () => {
    const interaction = normalized(
      handlePageFeed(
        change({
          item: 'comment',
          verb: 'add',
          post_id: '100_200',
          comment_id: '200_300',
        }),
      ),
    );

    expect(interaction.externalParentId).toBe('100_200');
  });

  it.each([
    ['edit', 'comment_updated'],
    ['edited', 'comment_updated'],
    ['update', 'comment_updated'],
    ['remove', 'comment_removed'],
    ['delete', 'comment_removed'],
  ])('maps the documented verb %s onto %s', (verb, expected) => {
    const interaction = normalized(
      handlePageFeed(
        change({ item: 'comment', verb, post_id: 'p1', comment_id: 'c1' }),
      ),
    );

    // Meta documents both spellings of each; a caller must never have to know
    // which one arrived.
    expect(interaction.interactionType).toBe(expected);
  });

  it('marks a removal as removed rather than deleting the row', () => {
    const interaction = normalized(
      handlePageFeed(
        change({ item: 'post', verb: 'remove', post_id: '100_200' }),
      ),
    );

    expect(interaction.interactionType).toBe('post_removed');
    expect(interaction.status).toBe('removed');
  });

  it('classifies a documented non-post, non-comment subtype as page_feed_other', () => {
    const interaction = normalized(
      handlePageFeed(
        change({
          item: 'reaction',
          verb: 'add',
          post_id: '100_200',
          reaction_type: 'like',
        }),
      ),
    );

    // `feed` is not a comment feed. A reaction is a real event we record and
    // deliberately do not model — never one we relabel as a comment.
    expect(interaction.interactionType).toBe('page_feed_other');
    expect(interaction.metadata).toMatchObject({
      field: 'feed',
      item: 'reaction',
      verb: 'add',
    });
  });

  it('falls back to page_feed_other when item or verb is absent', () => {
    // Neither field is documented as always present (§17).
    expect(
      normalized(handlePageFeed(change({ post_id: '100_200' })))
        .interactionType,
    ).toBe('page_feed_other');
    expect(
      normalized(handlePageFeed(change({ item: 'post', post_id: '100_200' })))
        .interactionType,
    ).toBe('page_feed_other');
  });

  it('refuses a change with no usable external id', () => {
    const result = handlePageFeed(change({ item: 'post', verb: 'add' }));

    expect(result).toEqual({
      outcome: 'ignored',
      safeErrorCode: 'missing_external_id',
    });
  });

  it('refuses a change with no value object', () => {
    expect(handlePageFeed(change(null))).toEqual({
      outcome: 'ignored',
      safeErrorCode: 'malformed_payload',
    });
  });

  it('falls back to the entry time when the value has no created_time', () => {
    const interaction = normalized(
      handlePageFeed(change({ item: 'post', verb: 'add', post_id: 'p1' })),
    );

    expect(interaction.providerCreatedAt).toBeNull();
    expect(interaction.occurredAt.toISOString()).toBe(
      '2024-09-10T20:26:40.000Z',
    );
  });

  it('truncates long text rather than storing an unbounded caption', () => {
    const interaction = normalized(
      handlePageFeed(
        change({
          item: 'post',
          verb: 'add',
          post_id: 'p1',
          message: 'x'.repeat(MAX_INTERACTION_TEXT_LENGTH + 500),
        }),
      ),
    );

    expect(interaction.text).toHaveLength(MAX_INTERACTION_TEXT_LENGTH);
  });
});

describe('handlePageMention', () => {
  it('normalizes a mention in a post', () => {
    const interaction = normalized(
      handlePageMention(
        change(
          {
            post_id: '100_200',
            item: 'post',
            verb: 'add',
            message: 'hey @page',
            created_time: 1_726_000_000,
          },
          { field: 'mention' },
        ),
      ),
    );

    expect(interaction).toMatchObject({
      surface: 'page_mention',
      interactionType: 'mention_created',
      externalInteractionId: '100_200',
      externalContentId: '100_200',
      status: 'active',
    });
    expect(interaction.metadata).toMatchObject({ mentionTarget: 'post' });
  });

  it('identifies a mention inside a comment by that comment', () => {
    const interaction = normalized(
      handlePageMention(
        change(
          { post_id: '100_200', comment_id: '200_300', message: '@page' },
          { field: 'mention' },
        ),
      ),
    );

    expect(interaction.externalInteractionId).toBe('200_300');
    expect(interaction.metadata).toMatchObject({ mentionTarget: 'comment' });
  });

  it('accepts a mention with no actor, because from is Workplace-only', () => {
    const interaction = normalized(
      handlePageMention(change({ post_id: '100_200' }, { field: 'mention' })),
    );

    // A consumer Page mention genuinely has no `from`; that is not malformed.
    expect(interaction.actorExternalId).toBeNull();
    expect(interaction.actorDisplayName).toBeNull();
  });

  it('never emits a mention lifecycle Meta does not document', () => {
    // Even carrying a removal verb, a mention is only ever a creation here.
    const interaction = normalized(
      handlePageMention(
        change({ post_id: '100_200', verb: 'remove' }, { field: 'mention' }),
      ),
    );

    expect(interaction.interactionType).toBe('mention_created');
    expect(interaction.status).toBe('active');
    // The evidence is kept without being acted on.
    expect(interaction.metadata).toMatchObject({ verb: 'remove' });
  });

  it('refuses a mention with no ids at all', () => {
    expect(
      handlePageMention(change({ message: '@page' }, { field: 'mention' })),
    ).toEqual({ outcome: 'ignored', safeErrorCode: 'missing_external_id' });
  });

  it('refuses a mention with no value object', () => {
    expect(handlePageMention(change(null, { field: 'mention' }))).toEqual({
      outcome: 'ignored',
      safeErrorCode: 'malformed_payload',
    });
  });

  it('is deterministic, so a redelivery yields the same identity', () => {
    const payload = { post_id: '100_200', comment_id: '200_300' };
    const first = normalized(
      handlePageMention(change({ ...payload }, { field: 'mention' })),
    );
    const second = normalized(
      handlePageMention(change({ ...payload }, { field: 'mention' })),
    );

    // Idempotency at the database is keyed on this id; if the handler were
    // nondeterministic the unique index could not do its job.
    expect(first.externalInteractionId).toBe(second.externalInteractionId);
  });
});

describe('handleInstagramComments', () => {
  const igChange = (value: Record<string, unknown> | null) =>
    change(value, { field: 'comments', externalAssetId: '17841400000000000' });

  it('normalizes the documented comments value', () => {
    const interaction = normalized(
      handleInstagramComments(
        igChange({
          id: '17865799348089039',
          text: 'love this',
          from: { id: '1088699134808877', username: 'ada' },
          media: { id: '17862178884026420', media_product_type: 'FEED' },
        }),
      ),
    );

    expect(interaction).toMatchObject({
      surface: 'instagram_comments',
      interactionType: 'comment_created',
      status: 'active',
      externalInteractionId: '17865799348089039',
      externalContentId: '17862178884026420',
      actorExternalId: '1088699134808877',
      actorDisplayName: 'ada',
      text: 'love this',
    });
    expect(interaction.metadata).toMatchObject({
      field: 'comments',
      mediaProductType: 'FEED',
    });
  });

  it('records a reply through parent_id', () => {
    const interaction = normalized(
      handleInstagramComments(
        igChange({ id: 'c2', parent_id: 'c1', media: { id: 'm1' } }),
      ),
    );

    expect(interaction.externalParentId).toBe('c1');
  });

  it('leaves parent_id null for a top-level comment', () => {
    const interaction = normalized(
      handleInstagramComments(igChange({ id: 'c1', media: { id: 'm1' } })),
    );

    expect(interaction.externalParentId).toBeNull();
  });

  it('emits only comment_created, because Meta documents no IG comment lifecycle', () => {
    // A `verb` on this field is undocumented; inventing deletion semantics
    // from one would be exactly the extrapolation §6 forbids.
    const interaction = normalized(
      handleInstagramComments(
        igChange({ id: 'c1', media: { id: 'm1' }, verb: 'delete' }),
      ),
    );

    expect(interaction.interactionType).toBe('comment_created');
    expect(interaction.status).toBe('active');
  });

  it('uses the entry time when the payload carries no timestamp', () => {
    const interaction = normalized(
      handleInstagramComments(igChange({ id: 'c1', media: { id: 'm1' } })),
    );

    expect(interaction.providerCreatedAt).toBeNull();
    expect(interaction.occurredAt.toISOString()).toBe(
      '2024-09-10T20:26:40.000Z',
    );
  });

  it('refuses a comment with no id', () => {
    expect(handleInstagramComments(igChange({ text: 'orphan' }))).toEqual({
      outcome: 'ignored',
      safeErrorCode: 'missing_external_id',
    });
  });

  it('refuses a malformed comment value', () => {
    expect(handleInstagramComments(igChange(null))).toEqual({
      outcome: 'ignored',
      safeErrorCode: 'malformed_payload',
    });
  });

  it('tolerates a missing media object without losing the comment', () => {
    const interaction = normalized(
      handleInstagramComments(igChange({ id: 'c1' })),
    );

    expect(interaction.externalContentId).toBeNull();
    expect(interaction.externalInteractionId).toBe('c1');
  });
});

describe('handleInstagramMentions', () => {
  const igChange = (value: Record<string, unknown> | null) =>
    change(value, { field: 'mentions', externalAssetId: '17841400000000000' });

  it('normalizes a mention in a comment', () => {
    const interaction = normalized(
      handleInstagramMentions(igChange({ media_id: 'm1', comment_id: 'c1' })),
    );

    expect(interaction).toMatchObject({
      surface: 'instagram_mentions',
      interactionType: 'mention_created',
      externalInteractionId: 'c1',
      externalContentId: 'm1',
    });
    expect(interaction.metadata).toMatchObject({ mentionTarget: 'comment' });
  });

  it('normalizes a caption mention, identified by the media', () => {
    const interaction = normalized(
      handleInstagramMentions(igChange({ media_id: 'm1' })),
    );

    expect(interaction.externalInteractionId).toBe('m1');
    expect(interaction.metadata).toMatchObject({ mentionTarget: 'media' });
  });

  it('stores no actor or text, because the payload documents none', () => {
    const interaction = normalized(
      handleInstagramMentions(igChange({ media_id: 'm1', comment_id: 'c1' })),
    );

    // §16 is payload-first: the comment body and mentioning user are reachable
    // only through a Graph read, which this task deliberately does not perform.
    expect(interaction.actorExternalId).toBeNull();
    expect(interaction.actorDisplayName).toBeNull();
    expect(interaction.text).toBeNull();
    expect(interaction.providerCreatedAt).toBeNull();
  });

  it('does not assume parity with the Page mention payload', () => {
    // Page mention's `post_id` means nothing on this field; a value carrying
    // only that must not be silently accepted.
    expect(handleInstagramMentions(igChange({ post_id: 'p1' }))).toEqual({
      outcome: 'ignored',
      safeErrorCode: 'missing_external_id',
    });
  });

  it('refuses a malformed mention value', () => {
    expect(handleInstagramMentions(igChange(null))).toEqual({
      outcome: 'ignored',
      safeErrorCode: 'malformed_payload',
    });
  });

  it('is deterministic across a redelivery', () => {
    const first = normalized(
      handleInstagramMentions(igChange({ media_id: 'm1', comment_id: 'c1' })),
    );
    const second = normalized(
      handleInstagramMentions(igChange({ media_id: 'm1', comment_id: 'c1' })),
    );

    expect(first.externalInteractionId).toBe(second.externalInteractionId);
  });
});

describe('the handler registry', () => {
  it('registers exactly the four subscribed fields', () => {
    expect(Object.keys(META_ORGANIC_WEBHOOK_HANDLERS).sort()).toEqual([
      'instagram:comments',
      'instagram:mentions',
      'page:feed',
      'page:mention',
    ]);
  });

  it('resolves each subscribed field to a handler', () => {
    expect(resolveHandlerKey('page', 'feed')).toBe('page:feed');
    expect(resolveHandlerKey('page', 'mention')).toBe('page:mention');
    expect(resolveHandlerKey('instagram', 'comments')).toBe(
      'instagram:comments',
    );
    expect(resolveHandlerKey('instagram', 'mentions')).toBe(
      'instagram:mentions',
    );
  });

  it('does not cross object types', () => {
    // `mentions` is Instagram's spelling and `mention` is the Page's; neither
    // may be honoured on the other object.
    expect(resolveHandlerKey('page', 'mentions')).toBeNull();
    expect(resolveHandlerKey('instagram', 'mention')).toBeNull();
    expect(resolveHandlerKey('instagram', 'feed')).toBeNull();
  });

  it.each([
    'messages',
    'messaging_postbacks',
    'messaging_referrals',
    'messaging_handovers',
    'messaging_optins',
    'message_reactions',
    'message_reads',
    'message_echoes',
    'standby',
  ])('registers no handler for the messaging field %s', (field) => {
    // Messaging belongs to the Messaging app and the LeadFlow/Inbox surface.
    expect(resolveHandlerKey('page', field)).toBeNull();
    expect(resolveHandlerKey('instagram', field)).toBeNull();
  });

  it.each(['story_insights', 'live_comments', 'ratings', 'messaging_seen'])(
    'registers no handler for the out-of-scope field %s',
    (field) => {
      expect(resolveHandlerKey('page', field)).toBeNull();
      expect(resolveHandlerKey('instagram', field)).toBeNull();
    },
  );

  it('registers no handler for an unsubscribed object type', () => {
    expect(resolveHandlerKey('user', 'feed')).toBeNull();
    expect(
      resolveHandlerKey('whatsapp_business_account', 'messages'),
    ).toBeNull();
    expect(resolveHandlerKey('unknown', 'comments')).toBeNull();
  });

  it('treats a missing field as unhandled', () => {
    expect(resolveHandlerKey('page', null)).toBeNull();
  });

  it('cannot be extended at runtime', () => {
    expect(Object.isFrozen(META_ORGANIC_WEBHOOK_HANDLERS)).toBe(true);
  });

  it('never resolves through prototype keys', () => {
    // `key in obj` would otherwise match `toString` and dispatch to a function
    // that is not a handler at all.
    expect(resolveHandlerKey('page', 'toString')).toBeNull();
    expect(resolveHandlerKey('page', 'constructor')).toBeNull();
    expect(resolveHandlerKey('__proto__', 'feed')).toBeNull();
  });
});
