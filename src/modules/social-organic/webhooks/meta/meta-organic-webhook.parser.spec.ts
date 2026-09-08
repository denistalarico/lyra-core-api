import {
  readExternalId,
  readUnixSeconds,
  splitMetaWebhookDelivery,
} from './meta-organic-webhook.parser';

describe('splitMetaWebhookDelivery', () => {
  it('splits a single entry with a single change', () => {
    const result = splitMetaWebhookDelivery({
      object: 'page',
      entry: [
        {
          id: '100',
          time: 1_726_000_000,
          changes: [{ field: 'feed', value: { item: 'post', verb: 'add' } }],
        },
      ],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0]).toMatchObject({
      entryIndex: 0,
      changeIndex: 0,
      externalAssetId: '100',
      field: 'feed',
    });
    expect(result.changes[0].entryTime?.toISOString()).toBe(
      '2024-09-10T20:26:40.000Z',
    );
  });

  it('keeps each entry of a multi-entry batch on its own asset', () => {
    const result = splitMetaWebhookDelivery({
      object: 'page',
      entry: [
        { id: '100', time: 1, changes: [{ field: 'feed', value: {} }] },
        { id: '900', time: 2, changes: [{ field: 'mention', value: {} }] },
      ],
    });

    // The W1.1 behaviour this replaces attributed a batch to no asset at all;
    // the one thing that must never happen is both changes claiming entry[0].
    expect(result.changes.map((change) => change.externalAssetId)).toEqual([
      '100',
      '900',
    ]);
    expect(result.changes.map((change) => change.field)).toEqual([
      'feed',
      'mention',
    ]);
  });

  it('splits multiple changes inside one entry', () => {
    const result = splitMetaWebhookDelivery({
      object: 'instagram',
      entry: [
        {
          id: '17841400000000000',
          time: 5,
          changes: [
            { field: 'comments', value: { id: 'c1' } },
            { field: 'mentions', value: { media_id: 'm1' } },
          ],
        },
      ],
    });

    expect(result.changes).toHaveLength(2);
    expect(result.changes.map((change) => change.changeIndex)).toEqual([0, 1]);
    expect(
      result.changes.every(
        (change) => change.externalAssetId === '17841400000000000',
      ),
    ).toBe(true);
  });

  it('counts a malformed entry without dropping its siblings', () => {
    const result = splitMetaWebhookDelivery({
      object: 'page',
      entry: [
        'not-an-object',
        { id: '100', time: 1, changes: [{ field: 'feed', value: {} }] },
        { id: '200', time: 2, changes: 'not-an-array' },
      ],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].externalAssetId).toBe('100');
    expect(result.malformedEntries).toBe(2);
  });

  it('counts a malformed change without dropping its siblings', () => {
    const result = splitMetaWebhookDelivery({
      object: 'page',
      entry: [
        {
          id: '100',
          time: 1,
          changes: [null, { field: 'feed', value: {} }],
        },
      ],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.malformedChanges).toBe(1);
  });

  it('reports a missing entry array as a malformed envelope', () => {
    expect(splitMetaWebhookDelivery({ object: 'page' }).malformedEnvelope).toBe(
      true,
    );
    expect(splitMetaWebhookDelivery({}).malformedEnvelope).toBe(true);
    expect(splitMetaWebhookDelivery(null).malformedEnvelope).toBe(true);
  });

  it('yields no change for an entry that carries messaging instead of changes', () => {
    // A messaging delivery has `entry[].messaging`, not `entry[].changes`. It
    // must produce nothing here rather than be misread as an organic change.
    const result = splitMetaWebhookDelivery({
      object: 'page',
      entry: [{ id: '100', time: 1, messaging: [{ sender: { id: 'u1' } }] }],
    });

    expect(result.changes).toHaveLength(0);
    expect(result.malformedEntries).toBe(1);
  });

  it('preserves a change whose field is missing, so the worker can classify it', () => {
    const result = splitMetaWebhookDelivery({
      object: 'page',
      entry: [{ id: '100', time: 1, changes: [{ value: { item: 'post' } }] }],
    });

    expect(result.changes).toHaveLength(1);
    expect(result.changes[0].field).toBeNull();
  });

  it('reports a null value rather than substituting an empty object', () => {
    const result = splitMetaWebhookDelivery({
      object: 'page',
      entry: [{ id: '100', time: 1, changes: [{ field: 'feed', value: 42 }] }],
    });

    expect(result.changes[0].value).toBeNull();
  });

  it('accepts an empty entry array as a valid delivery about nothing', () => {
    const result = splitMetaWebhookDelivery({ object: 'page', entry: [] });

    expect(result.malformedEnvelope).toBe(false);
    expect(result.changes).toHaveLength(0);
  });
});

describe('readExternalId', () => {
  it('accepts strings and numerics, including the console test id', () => {
    expect(readExternalId('100')).toBe('100');
    expect(readExternalId(100)).toBe('100');
    // The Meta console's test event sends `0`, as a string or a number. Both
    // are syntactically valid ids; whether `0` names a managed asset is the
    // scope resolver's question, and its answer is `unresolved_unknown_asset`.
    expect(readExternalId('0')).toBe('0');
    expect(readExternalId(0)).toBe('0');
  });

  it('rejects blanks and non-scalars', () => {
    expect(readExternalId('   ')).toBeNull();
    expect(readExternalId(null)).toBeNull();
    expect(readExternalId({ id: '1' })).toBeNull();
    expect(readExternalId(Number.NaN)).toBeNull();
  });

  it('bounds the id to the column width', () => {
    expect(readExternalId('9'.repeat(500))).toHaveLength(180);
  });
});

describe('readUnixSeconds', () => {
  it('reads Meta seconds, not milliseconds', () => {
    expect(readUnixSeconds(1_726_000_000)?.toISOString()).toBe(
      '2024-09-10T20:26:40.000Z',
    );
    expect(readUnixSeconds('1726000000')?.toISOString()).toBe(
      '2024-09-10T20:26:40.000Z',
    );
  });

  it('returns null rather than a nonsense date', () => {
    expect(readUnixSeconds(0)).toBeNull();
    expect(readUnixSeconds(-5)).toBeNull();
    expect(readUnixSeconds('soon')).toBeNull();
    expect(readUnixSeconds(undefined)).toBeNull();
  });
});
