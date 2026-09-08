import { SocialOrganicInteractionService } from './social-organic-interaction.service';
import type { NormalizedOrganicInteraction } from './meta/meta-organic-webhook.handlers';

function interaction(
  overrides: Partial<NormalizedOrganicInteraction> = {},
): NormalizedOrganicInteraction {
  return {
    surface: 'page_feed',
    interactionType: 'comment_created',
    status: 'active',
    externalInteractionId: '200_300',
    externalParentId: '100_200',
    externalContentId: '100_200',
    actorExternalId: 'user-1',
    actorDisplayName: 'Ada Lovelace',
    text: 'nice post',
    providerCreatedAt: new Date('2024-09-10T20:26:40.000Z'),
    occurredAt: new Date('2024-09-10T20:26:40.000Z'),
    metadata: { field: 'feed', item: 'comment', verb: 'add' },
    ...overrides,
  };
}

describe('SocialOrganicInteractionService', () => {
  let builder: {
    insert: jest.Mock;
    into: jest.Mock;
    values: jest.Mock;
    orUpdate: jest.Mock;
    returning: jest.Mock;
    execute: jest.Mock;
  };
  let service: SocialOrganicInteractionService;

  const scope = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    agencyClientId: null,
    assetId: 'asset-1',
  };

  beforeEach(() => {
    builder = {
      insert: jest.fn(() => builder),
      into: jest.fn(() => builder),
      values: jest.fn(() => builder),
      orUpdate: jest.fn(() => builder),
      returning: jest.fn(() => builder),
      execute: jest
        .fn()
        .mockResolvedValue({ raw: [{ id: 'row-1', inserted: true }] }),
    };
    service = new SocialOrganicInteractionService({
      createQueryBuilder: () => builder,
    } as never);
  });

  it('writes one row carrying the resolved scope', async () => {
    const result = await service.record({
      provider: 'meta',
      scope,
      interaction: interaction(),
      sourceWebhookEventId: 'event-1',
    });

    expect(result).toEqual({ interactionId: 'row-1', created: true });
    const [values] = builder.values.mock.calls[0] as [Record<string, unknown>];
    expect(values).toMatchObject({
      tenantId: 'tenant-1',
      workspaceId: 'workspace-1',
      agencyClientId: null,
      assetId: 'asset-1',
      provider: 'meta',
      externalInteractionId: '200_300',
      sourceWebhookEventId: 'event-1',
    });
  });

  it('upserts on the provider/asset/external-id key', async () => {
    await service.record({
      provider: 'meta',
      scope,
      interaction: interaction(),
      sourceWebhookEventId: null,
    });

    const [updatedColumns, conflictColumns] = builder.orUpdate.mock
      .calls[0] as [string[], string[]];

    // The conflict target is the database's idempotency guarantee; a
    // read-then-write would leave a race open between two workers.
    expect(conflictColumns).toEqual([
      'provider',
      'asset_id',
      'external_interaction_id',
    ]);
    expect(updatedColumns).toEqual(
      expect.arrayContaining(['interaction_type', 'status', 'text']),
    );
  });

  it('never overwrites the scope on a conflicting redelivery', async () => {
    await service.record({
      provider: 'meta',
      scope,
      interaction: interaction(),
      sourceWebhookEventId: null,
    });

    const [updatedColumns] = builder.orUpdate.mock.calls[0] as [string[]];

    // A row's tenant is decided once, at creation. Letting an update move it
    // would let a later ambiguous resolution migrate data between tenants.
    for (const column of [
      'tenant_id',
      'workspace_id',
      'agency_client_id',
      'asset_id',
      'provider',
      'external_interaction_id',
    ]) {
      expect(updatedColumns).not.toContain(column);
    }
  });

  it('reports a conflicting write as not created', async () => {
    builder.execute.mockResolvedValue({
      raw: [{ id: 'row-1', inserted: false }],
    });

    const result = await service.record({
      provider: 'meta',
      scope,
      interaction: interaction(),
      sourceWebhookEventId: null,
    });

    expect(result).toEqual({ interactionId: 'row-1', created: false });
  });

  it('persists no raw payload', async () => {
    await service.record({
      provider: 'meta',
      scope,
      interaction: interaction(),
      sourceWebhookEventId: 'event-1',
    });

    const [values] = builder.values.mock.calls[0] as [Record<string, unknown>];

    // §10: the payload exists exactly once, on the receipt. The domain row
    // links to it by id instead of copying it.
    expect(values).not.toHaveProperty('rawPayload');
    expect(JSON.stringify(values)).not.toContain('entry');
  });

  it('stores only bounded, non-PII metadata', async () => {
    await service.record({
      provider: 'meta',
      scope,
      interaction: interaction(),
      sourceWebhookEventId: null,
    });

    const [values] = builder.values.mock.calls[0] as [
      { metadata: Record<string, unknown> },
    ];

    // Names, text and ids have columns; the metadata bag must not shadow them.
    expect(Object.keys(values.metadata).sort()).toEqual([
      'field',
      'item',
      'verb',
    ]);
    expect(JSON.stringify(values.metadata)).not.toContain('Ada Lovelace');
    expect(JSON.stringify(values.metadata)).not.toContain('nice post');
  });

  it('lets a write failure propagate so the worker can retry it', async () => {
    builder.execute.mockRejectedValue(new Error('deadlock detected'));

    await expect(
      service.record({
        provider: 'meta',
        scope,
        interaction: interaction(),
        sourceWebhookEventId: null,
      }),
    ).rejects.toThrow('deadlock detected');
  });
});
