import {
  compareTimelinePositions,
  decodeConversationCursor,
  encodeConversationCursor,
  readApprovalCard,
  approvalCardBody,
  timelineSourceRank,
  type ClientConversationTimelineSource,
} from '../client-conversation.types';
import {
  isBeforeCursor,
  mergeTimelinePage,
} from './client-conversation-timeline';

/**
 * CCOM2 §19/§22/§23/§53 — the ordering and pagination rules, as pure logic.
 *
 * These are the cases that justify `source` being in the sort key at all. The
 * PostgreSQL matrix proves the same properties end to end through the real
 * guards and two real tables; this suite proves the rule itself, so a failure
 * points at the comparison rather than at a fixture.
 */

const T = (iso: string) => new Date(iso);
const uuid = (n: number) =>
  `0000000${n}-0000-4000-8000-000000000000`.slice(-36);

type Row = {
  createdAt: Date;
  source: ClientConversationTimelineSource;
  id: string;
  label: string;
};

const row = (
  iso: string,
  source: ClientConversationTimelineSource,
  n: number,
  label = `${source}:${n}`,
): Row => ({ createdAt: T(iso), source, id: uuid(n), label });

const split = (rows: Row[]) => [
  rows.filter((r) => r.source === 'conversation_message'),
  rows.filter((r) => r.source === 'approval_comment'),
];

describe('timeline ordering', () => {
  it('orders by timestamp first', () => {
    const older = row('2026-10-01T10:00:00.000Z', 'approval_comment', 9);
    const newer = row('2026-10-01T11:00:00.000Z', 'conversation_message', 1);
    expect(compareTimelinePositions(older, newer)).toBeLessThan(0);
  });

  /**
   * The case that makes `source` necessary. Same instant, different tables —
   * `id` is unique only within its own table, so without the source rank the
   * two could compare equal and a page boundary would repeat or skip one.
   */
  it('breaks a timestamp tie by source before id', () => {
    const message = row('2026-10-01T10:00:00.000Z', 'conversation_message', 9);
    const comment = row('2026-10-01T10:00:00.000Z', 'approval_comment', 1);

    expect(compareTimelinePositions(message, comment)).toBeLessThan(0);
    expect(timelineSourceRank('conversation_message')).toBeLessThan(
      timelineSourceRank('approval_comment'),
    );
  });

  it('breaks a timestamp-and-source tie by id', () => {
    const first = row('2026-10-01T10:00:00.000Z', 'conversation_message', 1);
    const second = row('2026-10-01T10:00:00.000Z', 'conversation_message', 2);
    expect(compareTimelinePositions(first, second)).toBeLessThan(0);
  });

  it('is a total order: no two distinct rows compare equal', () => {
    const rows = [
      row('2026-10-01T10:00:00.000Z', 'conversation_message', 1),
      row('2026-10-01T10:00:00.000Z', 'conversation_message', 2),
      row('2026-10-01T10:00:00.000Z', 'approval_comment', 1),
      row('2026-10-01T10:00:00.000Z', 'approval_comment', 2),
    ];

    for (const left of rows) {
      for (const right of rows) {
        if (left === right) continue;
        expect(compareTimelinePositions(left, right)).not.toBe(0);
      }
    }
  });
});

describe('cross-source pagination', () => {
  /**
   * §53's required shape: message @T1, comment @T2, message @T3, comment @T4,
   * walked backwards in pages of two.
   */
  const interleaved = [
    row('2026-10-01T10:00:01.000Z', 'conversation_message', 1, 'm@T1'),
    row('2026-10-01T10:00:02.000Z', 'approval_comment', 2, 'c@T2'),
    row('2026-10-01T10:00:03.000Z', 'conversation_message', 3, 'm@T3'),
    row('2026-10-01T10:00:04.000Z', 'approval_comment', 4, 'c@T4'),
  ];

  /** Walks every page the way the service does, and reports what it saw. */
  function walk(rows: Row[], limit: number) {
    const seen: string[][] = [];
    let cursor = null as ReturnType<typeof decodeConversationCursor>;

    for (let guard = 0; guard < 20; guard += 1) {
      const windows = split(
        rows
          .filter((candidate) => isBeforeCursor(candidate, cursor))
          // Each source returns its own newest `limit + 1`, exactly as the two
          // queries do.
          .sort((left, right) => compareTimelinePositions(right, left)),
      ).map((source) => source.slice(0, limit + 1));

      const page = mergeTimelinePage(windows, limit);
      seen.push(page.items.map((item) => item.label));
      if (!page.nextCursor) break;
      cursor = decodeConversationCursor(page.nextCursor);
    }

    return seen;
  }

  it('walks the interleaved timeline newest-page-first with no gap', () => {
    const pages = walk(interleaved, 2);

    // Each page renders oldest → newest; the walk goes backwards in time.
    expect(pages).toEqual([
      ['m@T3', 'c@T4'],
      ['m@T1', 'c@T2'],
    ]);
  });

  it('never repeats and never skips a row, at every page size', () => {
    for (const limit of [1, 2, 3, 4, 5]) {
      const flat = walk(interleaved, limit).flat();
      expect(new Set(flat).size).toBe(flat.length);
      expect(flat.sort()).toEqual(interleaved.map((item) => item.label).sort());
    }
  });

  /**
   * §23/§53 — the hard case: a message and a comment at the *same* instant,
   * straddling a page boundary of one. Without the source rank in the key,
   * exactly this loses or duplicates a line.
   */
  it('handles a message and a comment at the same timestamp', () => {
    const tied = [
      row('2026-10-01T10:00:00.000Z', 'conversation_message', 1, 'm@T'),
      row('2026-10-01T10:00:00.000Z', 'approval_comment', 2, 'c@T'),
      row('2026-10-01T09:00:00.000Z', 'conversation_message', 3, 'm@T-1'),
    ];

    for (const limit of [1, 2, 3]) {
      const flat = walk(tied, limit).flat();
      expect(new Set(flat).size).toBe(flat.length);
      expect(flat.sort()).toEqual(['c@T', 'm@T', 'm@T-1']);
    }
  });

  /**
   * §24 — `limit` bounds the timeline, not each source. Two sources holding
   * four rows each must still answer a page of three with three rows.
   */
  it('respects limit as the size of the merged page, not of each source', () => {
    const many = [
      ...[1, 2, 3, 4].map((n) =>
        row(`2026-10-01T10:00:0${n}.000Z`, 'conversation_message', n),
      ),
      ...[5, 6, 7, 8].map((n) =>
        row(`2026-10-01T10:00:0${n}.000Z`, 'approval_comment', n),
      ),
    ];

    const page = mergeTimelinePage(
      split(many.sort((a, b) => compareTimelinePositions(b, a))),
      3,
    );
    expect(page.items).toHaveLength(3);
    expect(page.nextCursor).toBeTruthy();
  });

  /**
   * §23 — a row newer than the page being walked must not disturb the walk. The
   * cursor names a position, not an offset, so inserting at the top is
   * invisible to a backward page.
   */
  it('is unaffected by a newer row inserted mid-walk', () => {
    const first = mergeTimelinePage(
      split(
        interleaved
          .slice()
          .sort((left, right) => compareTimelinePositions(right, left)),
      ),
      2,
    );
    const cursor = decodeConversationCursor(first.nextCursor);

    const withNewcomer = [
      ...interleaved,
      row('2026-10-01T23:59:59.000Z', 'conversation_message', 9, 'm@LATE'),
    ];
    const second = mergeTimelinePage(
      split(
        withNewcomer
          .filter((candidate) => isBeforeCursor(candidate, cursor))
          .sort((left, right) => compareTimelinePositions(right, left)),
      ),
      2,
    );

    expect(second.items.map((item) => item.label)).toEqual(['m@T1', 'c@T2']);
    expect(second.items.map((item) => item.label)).not.toContain('m@LATE');
  });

  it('reports no next cursor once the window is exhausted', () => {
    const page = mergeTimelinePage(split(interleaved), 10);
    expect(page.items).toHaveLength(4);
    expect(page.nextCursor).toBeNull();
  });

  it('treats a null cursor as the first page rather than as "everything"', () => {
    expect(isBeforeCursor(interleaved[0], null)).toBe(true);
    // §54 — a malformed cursor decodes to null, and null is the first page.
    expect(decodeConversationCursor('not-a-cursor!!')).toBeNull();
  });

  it('round-trips the cursor of the page it emitted', () => {
    const page = mergeTimelinePage(split(interleaved), 2);
    const cursor = decodeConversationCursor(page.nextCursor);

    expect(cursor).toEqual({
      createdAt: T('2026-10-01T10:00:03.000Z'),
      source: 'conversation_message',
      id: uuid(3),
    });
    expect(encodeConversationCursor(cursor!)).toBe(page.nextCursor);
  });
});

describe('approval card metadata', () => {
  const card = {
    kind: 'approval_card',
    approvalId: uuid(7),
    title: 'Post Carnaval',
    version: 'v2',
  };

  it('reads a well-formed card', () => {
    expect(readApprovalCard({ card })).toEqual(card);
  });

  it('builds the textual fallback body (§3)', () => {
    expect(approvalCardBody('Post Carnaval', 'v2')).toBe(
      'Nova aprovação disponível: Post Carnaval (v2)',
    );
  });

  /**
   * §15 — a card whose `approvalId` is not even a UUID must degrade to "no
   * card" rather than reach the resolver, where it would query by a malformed
   * value. The resolver's own scope filter is the real defence; this is the
   * layer that keeps a malformed row from becoming a 500.
   */
  it.each([
    ['no metadata', null],
    ['no card', {}],
    ['card is not an object', { card: 'approval_card' as unknown }],
    ['unknown card kind', { card: { ...card, kind: 'something_else' } }],
    ['missing approvalId', { card: { kind: 'approval_card' } }],
    ['non-uuid approvalId', { card: { ...card, approvalId: '../../etc' } }],
  ])('rejects %s', (_label, metadata) => {
    expect(readApprovalCard(metadata as never)).toBeNull();
  });

  /**
   * §4 — nothing volatile is read back out of the card, because nothing
   * volatile is in it. A row that somehow carries a stored status must not
   * surface it: the reader emits only the four contract fields.
   */
  it('ignores a status smuggled into stored metadata', () => {
    const resolved = readApprovalCard({
      card: { ...card, status: 'approved', actionsPermitted: ['decide'] },
    });

    expect(resolved).toEqual(card);
    expect(resolved).not.toHaveProperty('status');
    expect(resolved).not.toHaveProperty('actionsPermitted');
  });
});
