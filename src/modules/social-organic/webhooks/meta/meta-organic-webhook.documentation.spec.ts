import { META_ORGANIC_GRAPH_API_VERSION } from '../../providers/meta/meta-organic-oauth.support';
import {
  META_ORGANIC_WEBHOOK_DOCUMENTED_FACTS,
  META_ORGANIC_WEBHOOK_GRAPH_VERSION,
  META_ORGANIC_WEBHOOK_HANDLED_FIELDS,
  META_ORGANIC_WEBHOOK_OBJECT_TYPES,
  META_PAGE_FEED_ITEMS,
  META_PAGE_FEED_VERBS,
} from './meta-organic-webhook.contract';
import {
  META_ORGANIC_WEBHOOK_HANDLERS,
  handlePageFeed,
} from './meta-organic-webhook.handlers';

/**
 * Ties the parsers to the documentation they were written from.
 *
 * The task's §1 requires the official payload shapes to be established before
 * any parser is written, and §22 requires one Graph version across all four
 * fields. Both are the kind of claim that decays silently, so they are asserted
 * here rather than left in prose.
 */
describe('Meta organic webhook documentation contract', () => {
  it('uses one Graph version for every field, matching the module', () => {
    // §22: no mixing versions per field. The subscription in the Meta console
    // is configured against this same version.
    expect(META_ORGANIC_WEBHOOK_GRAPH_VERSION).toBe(
      META_ORGANIC_GRAPH_API_VERSION,
    );
    expect(META_ORGANIC_WEBHOOK_GRAPH_VERSION).toMatch(/^v\d+\.\d+$/);
  });

  it('records every documented fact the parsers depend on', () => {
    expect(META_ORGANIC_WEBHOOK_DOCUMENTED_FACTS.length).toBeGreaterThanOrEqual(
      13,
    );
    for (const fact of META_ORGANIC_WEBHOOK_DOCUMENTED_FACTS) {
      expect(fact.statement.length).toBeGreaterThan(20);
      expect(fact.source).toContain('docs/');
    }
  });

  it('subscribes to exactly the two documented object types', () => {
    expect([...META_ORGANIC_WEBHOOK_OBJECT_TYPES]).toEqual([
      'page',
      'instagram',
    ]);
  });

  it('registers a handler for exactly the declared fields, and no others', () => {
    const declared = Object.entries(META_ORGANIC_WEBHOOK_HANDLED_FIELDS)
      .flatMap(([object, fields]) =>
        fields.map((field) => `${object}:${field}`),
      )
      .sort();

    // The registry and the documented field list cannot drift apart: one is
    // what the code does, the other is what the Meta console is configured for.
    expect(Object.keys(META_ORGANIC_WEBHOOK_HANDLERS).sort()).toEqual(declared);
  });

  it('records the full documented feed enums rather than only the handled ones', () => {
    // The point of keeping the whole enum is that "documented but unmodelled"
    // and "never seen" are different situations.
    expect(META_PAGE_FEED_ITEMS).toContain('post');
    expect(META_PAGE_FEED_ITEMS).toContain('comment');
    expect(META_PAGE_FEED_ITEMS).toContain('reaction');
    expect(META_PAGE_FEED_ITEMS.length).toBeGreaterThan(20);

    expect(META_PAGE_FEED_VERBS).toEqual(
      expect.arrayContaining(['add', 'edit', 'edited', 'remove', 'delete']),
    );
  });

  it('classifies every documented feed item without throwing', () => {
    // §17: `item` and `verb` come from wide enums, and an unhandled
    // combination must degrade to a classified row, never to an exception.
    for (const item of META_PAGE_FEED_ITEMS) {
      for (const verb of META_PAGE_FEED_VERBS) {
        const result = handlePageFeed({
          entryIndex: 0,
          changeIndex: 0,
          externalAssetId: '100',
          entryTime: new Date('2024-09-10T20:26:40.000Z'),
          field: 'feed',
          value: { item, verb, post_id: 'p1', comment_id: 'c1' },
        });

        expect(result.outcome).toBe('normalized');
      }
    }
  });

  it('never maps a non-comment item onto a comment interaction type', () => {
    // The specific misreading §4 warns about: treating all of `feed` as
    // comments. Only `item: "comment"` may produce a comment_* type.
    for (const item of META_PAGE_FEED_ITEMS) {
      if (item === 'comment') continue;

      const result = handlePageFeed({
        entryIndex: 0,
        changeIndex: 0,
        externalAssetId: '100',
        entryTime: null,
        field: 'feed',
        value: { item, verb: 'add', post_id: 'p1' },
      });

      if (result.outcome !== 'normalized') continue;
      expect(result.interaction.interactionType).not.toMatch(/^comment_/);
    }
  });
});
