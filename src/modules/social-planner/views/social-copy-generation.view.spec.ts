import type {
  SocialCopyGenerationProposalEntity,
  SocialCopyGenerationRunEntity,
} from '../entities';
import {
  fromColumnField,
  toColumnField,
  toSocialCopyGenerationProposalView,
  toSocialCopyGenerationRunView,
} from './social-copy-generation.view';

const TENANT_ID = '11111111-1111-4111-8111-111111111111';
const WORKSPACE_ID = '22222222-2222-4222-8222-222222222222';
const CLIENT_ID = '33333333-3333-4333-8333-333333333333';

function buildRun(
  overrides: Partial<SocialCopyGenerationRunEntity> = {},
): SocialCopyGenerationRunEntity {
  return {
    id: '77777777-7777-4777-8777-777777777777',
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    agencyClientId: CLIENT_ID,
    planId: '44444444-4444-4444-8444-444444444444',
    contentItemId: '55555555-5555-4555-8555-555555555555',
    runKind: 'content_copy',
    idempotencyKey: 'planner-copy:content:1',
    status: 'succeeded',
    attempts: 1,
    maxAttempts: 3,
    availableAt: new Date('2026-09-10T00:00:00.000Z'),
    lockedAt: null,
    lockedBy: 'host:1:social-copy-generation',
    startedAt: new Date('2026-09-10T00:00:05.000Z'),
    completedAt: new Date('2026-09-10T00:00:09.000Z'),
    failedAt: null,
    cancelledAt: null,
    deadLetteredAt: null,
    lastError: null,
    provider: 'openai-compatible',
    model: 'gpt-test',
    promptVersion: 'planner-copy-v1',
    contextVersion: 'planner-context-v1',
    inputTokens: 1_200,
    cachedInputTokens: 200,
    outputTokens: 300,
    costCents: 12,
    costIsEstimated: true,
    latencyMs: 4_000,
    requestedFields: ['caption'],
    instruction: 'mais curto',
    requestedById: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa',
    createdAt: new Date('2026-09-10T00:00:00.000Z'),
    updatedAt: new Date('2026-09-10T00:00:09.000Z'),
    ...overrides,
  } as SocialCopyGenerationRunEntity;
}

function buildProposal(
  overrides: Partial<SocialCopyGenerationProposalEntity> = {},
): SocialCopyGenerationProposalEntity {
  return {
    id: '99999999-9999-4999-8999-999999999999',
    tenantId: TENANT_ID,
    workspaceId: WORKSPACE_ID,
    agencyClientId: CLIENT_ID,
    runId: '77777777-7777-4777-8777-777777777777',
    contentItemId: '55555555-5555-4555-8555-555555555555',
    field: 'caption',
    value: 'legenda gerada',
    baseValue: 'legenda atual',
    rationale: 'Tom mais direto.',
    status: 'pending',
    appliedRevisionId: null,
    decidedById: null,
    decidedAt: null,
    createdAt: new Date('2026-09-10T00:00:09.000Z'),
    ...overrides,
  } as SocialCopyGenerationProposalEntity;
}

describe('toSocialCopyGenerationRunView', () => {
  /**
   * The scope triple must not cross the boundary, same rule every other view in
   * this module states.
   */
  it('never echoes the scope triple back to the caller', () => {
    const view = toSocialCopyGenerationRunView(buildRun()) as Record<
      string,
      unknown
    >;

    expect(view.tenantId).toBeUndefined();
    expect(view.workspaceId).toBeUndefined();
    expect(view.agencyClientId).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain(TENANT_ID);
    expect(JSON.stringify(view)).not.toContain(CLIENT_ID);
  });

  /**
   * The worker id names a host and a process. It is operational detail about our
   * own infrastructure and has no business reaching a browser.
   */
  it('never exposes the worker lease identity', () => {
    const view = toSocialCopyGenerationRunView(buildRun()) as Record<
      string,
      unknown
    >;

    expect(view.lockedBy).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain('social-copy-generation');
  });

  it('exposes the provenance a generated revision needs to be auditable', () => {
    const view = toSocialCopyGenerationRunView(buildRun());

    expect(view).toMatchObject({
      provider: 'openai-compatible',
      model: 'gpt-test',
      promptVersion: 'planner-copy-v1',
      contextVersion: 'planner-context-v1',
      inputTokens: 1_200,
      outputTokens: 300,
      latencyMs: 4_000,
    });
  });

  /** A token-derived figure must never be presented as a provider invoice. */
  it('reports cost together with the fact that it is an estimate', () => {
    const view = toSocialCopyGenerationRunView(buildRun());

    expect(view.costCents).toBe(12);
    expect(view.costIsEstimated).toBe(true);
  });

  it('serializes every timestamp as ISO and keeps nulls null', () => {
    const view = toSocialCopyGenerationRunView(
      buildRun({ startedAt: null, completedAt: null }),
    );

    expect(view.createdAt).toBe('2026-09-10T00:00:00.000Z');
    expect(view.startedAt).toBeNull();
    expect(view.completedAt).toBeNull();
  });
});

describe('toSocialCopyGenerationProposalView', () => {
  it('maps the stored column vocabulary onto the contract field name', () => {
    const view = toSocialCopyGenerationProposalView(
      buildProposal({ field: 'first_comment' }),
    );

    expect(view.field).toBe('firstComment');
  });

  it('keeps both sides of the change so the UI can show a diff', () => {
    const view = toSocialCopyGenerationProposalView(buildProposal());

    expect(view.value).toBe('legenda gerada');
    expect(view.baseValue).toBe('legenda atual');
  });

  it('passes a hashtag array through as an array', () => {
    const view = toSocialCopyGenerationProposalView(
      buildProposal({ field: 'hashtags', value: ['#a', '#b'], baseValue: [] }),
    );

    expect(view.value).toEqual(['#a', '#b']);
    expect(view.baseValue).toEqual([]);
  });

  /**
   * jsonb is `unknown` at the type level. A row holding something that is
   * neither a string nor a string array must not become a value an operator can
   * accept onto their content.
   */
  it('reports a malformed stored value as empty rather than casting it', () => {
    const view = toSocialCopyGenerationProposalView(
      buildProposal({ value: { unexpected: true }, baseValue: 42 }),
    );

    expect(view.value).toBe('');
    expect(view.baseValue).toBeNull();
  });

  it('drops non-string entries from a stored array', () => {
    const view = toSocialCopyGenerationProposalView(
      buildProposal({ value: ['#a', 7, null, '#b'] }),
    );

    expect(view.value).toEqual(['#a', '#b']);
  });

  it('never echoes the scope triple back to the caller', () => {
    const view = toSocialCopyGenerationProposalView(buildProposal()) as Record<
      string,
      unknown
    >;

    expect(view.tenantId).toBeUndefined();
    expect(JSON.stringify(view)).not.toContain(TENANT_ID);
  });
});

describe('field vocabulary mapping', () => {
  it('round-trips every field between the column and the contract', () => {
    for (const field of [
      'copy',
      'caption',
      'script',
      'cta',
      'hashtags',
      'firstComment',
    ] as const) {
      expect(fromColumnField(toColumnField(field))).toBe(field);
    }
  });

  it('maps only firstComment to a different column name', () => {
    expect(toColumnField('firstComment')).toBe('first_comment');
    expect(toColumnField('caption')).toBe('caption');
  });
});
