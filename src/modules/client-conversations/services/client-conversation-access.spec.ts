import {
  conversationRoom,
  evaluateConversationAccess,
  toConversationScope,
  unreadWatermark,
  type ClientConversationScope,
  type ConversationAccessSubject,
} from './client-conversation-access';
import {
  decodeConversationCursor,
  encodeConversationCursor,
} from '../client-conversation.types';

const scope: ClientConversationScope = {
  tenantId: 'tenant-a',
  workspaceId: 'workspace-a',
  agencyClientId: 'client-a',
  companyContextId: 'company-a',
};

function conversation(
  overrides: Partial<ConversationAccessSubject> = {},
): ConversationAccessSubject {
  return {
    id: 'conversation-1',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: 'client-a',
    companyContextId: 'company-a',
    status: 'active',
    ...overrides,
  };
}

describe('evaluateConversationAccess', () => {
  it('allows a conversation whose full scope tuple matches', () => {
    expect(evaluateConversationAccess(scope, conversation())).toEqual({
      allowed: true,
    });
  });

  it('denies another tenant', () => {
    expect(
      evaluateConversationAccess(scope, conversation({ tenantId: 'tenant-b' })),
    ).toEqual({ allowed: false, reason: 'tenant_mismatch' });
  });

  it('denies another workspace', () => {
    expect(
      evaluateConversationAccess(
        scope,
        conversation({ workspaceId: 'workspace-b' }),
      ),
    ).toEqual({ allowed: false, reason: 'workspace_mismatch' });
  });

  /**
   * The Agency chat compared tenant and workspace only, which is why a channel
   * UUID was enough to read another team's conversation. These two cases are
   * the regression guard for that class of bug in this domain.
   */
  it('denies another Agency Client inside the same workspace', () => {
    expect(
      evaluateConversationAccess(
        scope,
        conversation({ agencyClientId: 'client-b' }),
      ),
    ).toEqual({ allowed: false, reason: 'client_mismatch' });
  });

  it('denies another Company Context of the same client', () => {
    expect(
      evaluateConversationAccess(
        scope,
        conversation({ companyContextId: 'company-b' }),
      ),
    ).toEqual({ allowed: false, reason: 'company_mismatch' });
  });

  it('reads an archived conversation but refuses to write to it', () => {
    const archived = conversation({ status: 'archived' });

    expect(evaluateConversationAccess(scope, archived)).toEqual({
      allowed: true,
    });
    expect(
      evaluateConversationAccess(scope, archived, { requireActive: true }),
    ).toEqual({ allowed: false, reason: 'archived' });
  });

  it('checks scope before archival, so another company never leaks a reason', () => {
    expect(
      evaluateConversationAccess(
        scope,
        conversation({ companyContextId: 'company-b', status: 'archived' }),
      ),
    ).toEqual({ allowed: false, reason: 'company_mismatch' });
  });
});

describe('conversationRoom', () => {
  it('separates the two surfaces for the same conversation', () => {
    const client = conversationRoom('client_area', scope, 'conversation-1');
    const agency = conversationRoom('agency', scope, 'conversation-1');

    expect(client).toBe(
      'client:tenant-a:company-a:conversation:conversation-1',
    );
    expect(agency).toBe(
      'agency:tenant-a:company-a:conversation:conversation-1',
    );
    expect(client).not.toBe(agency);
  });

  it('separates companies and tenants', () => {
    expect(
      conversationRoom(
        'client_area',
        { ...scope, companyContextId: 'company-b' },
        'conversation-1',
      ),
    ).not.toBe(conversationRoom('client_area', scope, 'conversation-1'));

    expect(
      conversationRoom(
        'client_area',
        { ...scope, tenantId: 'tenant-b' },
        'conversation-1',
      ),
    ).not.toBe(conversationRoom('client_area', scope, 'conversation-1'));
  });
});

describe('toConversationScope', () => {
  it('narrows a full company scope', () => {
    expect(
      toConversationScope({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        companyContextId: 'company-a',
      }),
    ).toEqual(scope);
  });

  /**
   * `CompanyAwareScope` permits null ids for agency-wide and `legacy_unassigned`
   * rows. Letting those through would hand a null to a query, which matches
   * nothing *silently* — so the narrowing throws instead.
   */
  it('refuses an agency-wide scope rather than passing null through', () => {
    expect(() =>
      toConversationScope({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: null,
        companyContextId: null,
      }),
    ).toThrow(/Agency Client and a Company Context/);
  });

  it('refuses a legacy client-only scope', () => {
    expect(() =>
      toConversationScope({
        tenantId: 'tenant-a',
        workspaceId: 'workspace-a',
        agencyClientId: 'client-a',
        companyContextId: null,
      }),
    ).toThrow(/Company Context/);
  });
});

describe('unreadWatermark', () => {
  const joined = new Date('2026-01-01T00:00:00.000Z');
  const read = new Date('2026-02-01T00:00:00.000Z');

  it('prefers last_read_at', () => {
    expect(unreadWatermark({ lastReadAt: read, joinedAt: joined })).toBe(read);
  });

  it('falls back to joined_at, so pre-join history is not unread', () => {
    expect(unreadWatermark({ lastReadAt: null, joinedAt: joined })).toBe(
      joined,
    );
  });

  /**
   * A legacy row with neither timestamp yields null, which callers count as
   * zero. Under-counting a badge is the safe direction; the Agency chat's
   * `count(*)` fallback showed every member of an old channel its entire
   * history as unread.
   */
  it('yields null when neither timestamp exists', () => {
    expect(unreadWatermark({ lastReadAt: null, joinedAt: null })).toBeNull();
  });
});

describe('keyset cursor', () => {
  /**
   * CCOM2 §20 — the cursor gained `source`, so the round-trip now carries the
   * full `(created_at, source, id)` key. The CCOM1 two-part form is still
   * accepted; that case is below.
   */
  it('round-trips a cursor', () => {
    const cursor = {
      createdAt: new Date('2026-03-04T05:06:07.008Z'),
      source: 'conversation_message' as const,
      id: '7f3d1c2e-0b4a-4d5e-8f90-1a2b3c4d5e6f',
    };

    expect(decodeConversationCursor(encodeConversationCursor(cursor))).toEqual(
      cursor,
    );
  });

  it('round-trips an approval-comment cursor', () => {
    const cursor = {
      createdAt: new Date('2026-03-04T05:06:07.008Z'),
      source: 'approval_comment' as const,
      id: '7f3d1c2e-0b4a-4d5e-8f90-1a2b3c4d5e6f',
    };

    expect(decodeConversationCursor(encodeConversationCursor(cursor))).toEqual(
      cursor,
    );
  });

  /**
   * CCOM2 §21 — a cursor issued by CCOM1 is still in the hands of any open
   * client, and must keep working rather than silently resetting them to the
   * newest page. It adapts to the lowest source rank, which is the only source
   * it could ever have pointed at and also the conservative direction: the next
   * page starts strictly before that message, so a comment sharing its exact
   * timestamp is re-read rather than skipped.
   */
  it('adapts a CCOM1 two-part cursor deterministically', () => {
    const legacy = Buffer.from(
      '2026-03-04T05:06:07.008Z|7f3d1c2e-0b4a-4d5e-8f90-1a2b3c4d5e6f',
    ).toString('base64url');

    expect(decodeConversationCursor(legacy)).toEqual({
      createdAt: new Date('2026-03-04T05:06:07.008Z'),
      source: 'conversation_message',
      id: '7f3d1c2e-0b4a-4d5e-8f90-1a2b3c4d5e6f',
    });
  });

  it('rejects an unknown source instead of guessing one', () => {
    const forged = Buffer.from(
      '2026-03-04T05:06:07.008Z|not_a_source|7f3d1c2e-0b4a-4d5e-8f90-1a2b3c4d5e6f',
    ).toString('base64url');

    expect(decodeConversationCursor(forged)).toBeNull();
  });

  it.each([
    ['empty', ''],
    ['not a string', 42],
    ['garbage', 'not-base64-at-all!!'],
    [
      'missing id',
      Buffer.from('2026-03-04T05:06:07.008Z').toString('base64url'),
    ],
    [
      'non-uuid id',
      Buffer.from('2026-03-04T05:06:07.008Z|nope').toString('base64url'),
    ],
    [
      'invalid date',
      Buffer.from('never|7f3d1c2e-0b4a-4d5e-8f90-1a2b3c4d5e6f').toString(
        'base64url',
      ),
    ],
  ])('rejects a %s cursor instead of widening the page', (_label, value) => {
    expect(decodeConversationCursor(value)).toBeNull();
  });
});
