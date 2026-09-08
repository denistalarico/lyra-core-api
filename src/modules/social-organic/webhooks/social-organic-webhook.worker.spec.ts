import { SocialOrganicWebhookWorker } from './social-organic-webhook.worker';

type EventRow = {
  id: string;
  provider: string;
  objectType: string;
  scopeResolution: string;
  rawPayload: Record<string, unknown>;
};

const RESOLVED_SCOPE = {
  scopeResolution: 'resolved',
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  agencyClientId: null,
  assetId: 'asset-1',
};

/** A delivery carrying one handled Page comment on Page `100`. */
function pageCommentPayload(overrides: Record<string, unknown> = {}) {
  return {
    object: 'page',
    entry: [
      {
        id: '100',
        time: 1_726_000_000,
        changes: [
          {
            field: 'feed',
            value: {
              item: 'comment',
              verb: 'add',
              post_id: '100_200',
              comment_id: '200_300',
              created_time: 1_726_000_000,
              from: { id: 'user-1', name: 'Ada Lovelace' },
              message: 'nice post',
              ...overrides,
            },
          },
        ],
      },
    ],
  };
}

function eventRow(id: string, payload?: Record<string, unknown>): EventRow {
  return {
    id,
    provider: 'meta',
    objectType: 'page',
    scopeResolution: 'resolved',
    rawPayload: payload ?? pageCommentPayload(),
  };
}

describe('SocialOrganicWebhookWorker', () => {
  let webhooks: {
    claim: jest.Mock;
    recoverStale: jest.Mock;
    settle: jest.Mock;
    resolveScope: jest.Mock;
  };
  let interactions: { record: jest.Mock };
  let worker: SocialOrganicWebhookWorker;

  function settledCall(index = 0) {
    return (
      webhooks.settle.mock.calls[index] as [
        {
          eventId: string;
          lockedBy: string;
          status: string;
          safeErrorCode: string | null;
        },
      ]
    )[0];
  }

  beforeEach(() => {
    webhooks = {
      claim: jest.fn().mockResolvedValue([]),
      recoverStale: jest
        .fn()
        .mockResolvedValue({ requeued: 0, deadLettered: 0 }),
      settle: jest.fn().mockResolvedValue(true),
      resolveScope: jest.fn().mockResolvedValue(RESOLVED_SCOPE),
    };
    interactions = {
      record: jest
        .fn()
        .mockResolvedValue({ interactionId: 'interaction-1', created: true }),
    };
    worker = new SocialOrganicWebhookWorker(
      webhooks as never,
      interactions as never,
    );
    jest.spyOn(worker['logger'], 'log').mockImplementation(() => undefined);
    jest.spyOn(worker['logger'], 'warn').mockImplementation(() => undefined);
    jest.spyOn(worker['logger'], 'error').mockImplementation(() => undefined);
  });

  it('processes a handled change and settles the receipt as processed', async () => {
    webhooks.claim.mockResolvedValue([eventRow('event-1')]);

    expect(await worker.processDue()).toBe(1);

    expect(interactions.record).toHaveBeenCalledTimes(1);
    const settled = settledCall();
    expect(settled.eventId).toBe('event-1');
    expect(settled.lockedBy).toContain('organic-webhooks');
    expect(settled.status).toBe('processed');
    expect(settled.safeErrorCode).toBeNull();
  });

  it('scopes each entry of a multi-entry batch to its own asset', async () => {
    webhooks.resolveScope
      .mockResolvedValueOnce({ ...RESOLVED_SCOPE, assetId: 'asset-a' })
      .mockResolvedValueOnce({
        ...RESOLVED_SCOPE,
        tenantId: 'tenant-2',
        assetId: 'asset-b',
      });
    webhooks.claim.mockResolvedValue([
      eventRow('event-1', {
        object: 'page',
        entry: [
          { ...pageCommentPayload().entry[0], id: '100' },
          { ...pageCommentPayload().entry[0], id: '900' },
        ],
      }),
    ]);

    await worker.processDue();

    expect(
      (webhooks.resolveScope.mock.calls as [{ externalAssetId: string }][]).map(
        ([call]) => call.externalAssetId,
      ),
    ).toEqual(['100', '900']);
    const written = (
      interactions.record.mock.calls as [{ scope: { assetId: string } }][]
    ).map(([call]) => call.scope);
    expect(written[0].assetId).toBe('asset-a');
    expect(written[1]).toMatchObject({
      tenantId: 'tenant-2',
      assetId: 'asset-b',
    });
  });

  it('does not lose a good change because a sibling change is unhandled', async () => {
    const payload = pageCommentPayload();
    (payload.entry[0].changes as unknown[]).push({
      field: 'story_insights',
      value: { impressions: 3 },
    });
    webhooks.claim.mockResolvedValue([eventRow('event-1', payload)]);

    await worker.processDue();

    // The comment was still written, and the receipt says the delivery was
    // only partly handled rather than pretending it was clean.
    expect(interactions.record).toHaveBeenCalledTimes(1);
    const settled = settledCall();
    expect(settled.status).toBe('processed');
    expect(settled.safeErrorCode).toBe('partial:no_handler_registered');
  });

  it('settles an unknown field as unhandled without retrying', async () => {
    webhooks.claim.mockResolvedValue([
      eventRow('event-1', {
        object: 'page',
        entry: [
          { id: '100', time: 1, changes: [{ field: 'ratings', value: {} }] },
        ],
      }),
    ]);

    await worker.processDue();

    expect(interactions.record).not.toHaveBeenCalled();
    const settled = settledCall();
    expect(settled.status).toBe('unhandled');
    expect(settled.safeErrorCode).toBe('no_handler_registered');
  });

  it('settles a messaging field as unhandled and never writes a domain row', async () => {
    webhooks.claim.mockResolvedValue([
      eventRow('event-1', {
        object: 'page',
        entry: [
          {
            id: '100',
            time: 1,
            changes: [{ field: 'messages', value: { text: 'hi' } }],
          },
        ],
      }),
    ]);

    await worker.processDue();

    expect(interactions.record).not.toHaveBeenCalled();
    expect(settledCall().status).toBe('unhandled');
  });

  it('settles an unresolvable asset as unhandled, not failed', async () => {
    // The Meta console's test event (asset id `0`) is exactly this case.
    webhooks.resolveScope.mockResolvedValue({
      scopeResolution: 'unresolved_unknown_asset',
      tenantId: null,
      workspaceId: null,
      agencyClientId: null,
      assetId: null,
    });
    webhooks.claim.mockResolvedValue([eventRow('event-1')]);

    await worker.processDue();

    expect(interactions.record).not.toHaveBeenCalled();
    const settled = settledCall();
    expect(settled.status).toBe('unhandled');
    expect(settled.safeErrorCode).toBe('unknown_asset');
  });

  it('reports an ambiguous asset under its own safe code', async () => {
    webhooks.resolveScope.mockResolvedValue({
      scopeResolution: 'unresolved_ambiguous',
      tenantId: null,
      workspaceId: null,
      agencyClientId: null,
      assetId: null,
    });
    webhooks.claim.mockResolvedValue([eventRow('event-1')]);

    await worker.processDue();

    expect(settledCall().safeErrorCode).toBe('ambiguous_asset');
  });

  it('fails the receipt when a domain write fails, so it is retried', async () => {
    interactions.record.mockRejectedValue(new Error('deadlock detected'));
    webhooks.claim.mockResolvedValue([eventRow('event-1')]);

    await worker.processDue();

    const settled = settledCall();
    expect(settled.status).toBe('failed');
    expect(settled.safeErrorCode).toBe('domain_write_failed');
  });

  it('settles a malformed envelope as unhandled', async () => {
    webhooks.claim.mockResolvedValue([eventRow('event-1', { object: 'page' })]);

    await worker.processDue();

    const settled = settledCall();
    expect(settled.status).toBe('unhandled');
    expect(settled.safeErrorCode).toBe('malformed_payload');
  });

  it('records a malformed entry without discarding its healthy siblings', async () => {
    const payload = pageCommentPayload();
    (payload.entry as unknown[]).unshift('not-an-entry');
    webhooks.claim.mockResolvedValue([eventRow('event-1', payload)]);

    await worker.processDue();

    expect(interactions.record).toHaveBeenCalledTimes(1);
    const settled = settledCall();
    expect(settled.status).toBe('processed');
    expect(settled.safeErrorCode).toBe('partial:malformed_payload');
  });

  it('never retries an unhandled event into a loop', async () => {
    webhooks.claim.mockResolvedValue([
      eventRow('event-1', { object: 'page', entry: [] }),
    ]);

    await worker.processDue();

    // `unhandled` is terminal: it is not in the queue's `received` predicate,
    // so the row is never leased again.
    expect(settledCall().status).toBe('unhandled');
    expect(webhooks.claim).toHaveBeenCalledTimes(1);
  });

  it('keeps processing the batch when one event fails', async () => {
    webhooks.claim.mockResolvedValue([
      eventRow('event-1'),
      eventRow('event-2'),
      eventRow('event-3'),
    ]);
    webhooks.settle.mockImplementation(({ eventId }: { eventId: string }) => {
      if (eventId === 'event-2' && webhooks.settle.mock.calls.length === 2) {
        return Promise.reject(new Error('transient write failure'));
      }
      return Promise.resolve(true);
    });

    expect(await worker.processDue()).toBe(3);

    const touched = webhooks.settle.mock.calls.map(
      ([call]: [{ eventId: string }]) => call.eventId,
    );
    expect(touched).toContain('event-1');
    expect(touched).toContain('event-3');
  });

  it('marks an event that threw with a safe code and no provider text', async () => {
    webhooks.claim.mockResolvedValue([eventRow('event-1')]);
    interactions.record.mockRejectedValue(
      new Error('Meta said: token EAAG... is invalid'),
    );
    webhooks.settle
      .mockRejectedValueOnce(new Error('Meta said: token EAAG... is invalid'))
      .mockResolvedValueOnce(true);

    await worker.processDue();

    const lastCall = webhooks.settle.mock.calls.at(-1) as [
      {
        eventId: string;
        lockedBy: string;
        status: string;
        safeErrorCode: string;
      },
    ];
    expect(lastCall[0].eventId).toBe('event-1');
    expect(typeof lastCall[0].lockedBy).toBe('string');
    expect(lastCall[0].status).toBe('failed');
    const logged = JSON.stringify(
      (worker['logger'].error as jest.Mock).mock.calls,
    );
    expect(logged).not.toContain('EAAG');
    expect(logged).not.toContain('token');
  });

  it('never logs comment text, author names or the raw payload', async () => {
    webhooks.claim.mockResolvedValue([eventRow('event-1')]);

    await worker.processDue();

    const logged = JSON.stringify([
      (worker['logger'].log as jest.Mock).mock.calls,
      (worker['logger'].warn as jest.Mock).mock.calls,
      (worker['logger'].error as jest.Mock).mock.calls,
    ]);
    expect(logged).not.toContain('nice post');
    expect(logged).not.toContain('Ada Lovelace');
    expect(logged).not.toContain('user-1');
  });

  it('survives a settle that also fails', async () => {
    webhooks.claim.mockResolvedValue([eventRow('event-1')]);
    webhooks.settle.mockRejectedValue(new Error('database unavailable'));

    await expect(worker.processDue()).resolves.toBe(1);
  });

  it('recovers stale leases before claiming on each tick', async () => {
    const order: string[] = [];
    webhooks.recoverStale.mockImplementation(() => {
      order.push('recover');
      return Promise.resolve({ requeued: 0, deadLettered: 0 });
    });
    webhooks.claim.mockImplementation(() => {
      order.push('claim');
      return Promise.resolve([]);
    });

    await worker.tick();

    expect(order).toEqual(['recover', 'claim']);
  });

  it('does not overlap ticks', async () => {
    let release: () => void = () => undefined;
    webhooks.recoverStale.mockImplementation(
      () =>
        new Promise((resolve) => {
          release = () => resolve({ requeued: 0, deadLettered: 0 });
        }),
    );

    const first = worker.tick();
    await worker.tick();
    expect(webhooks.recoverStale).toHaveBeenCalledTimes(1);

    release();
    await first;
  });

  it('never lets a cycle failure escape the tick', async () => {
    webhooks.recoverStale.mockRejectedValue(new Error('database unavailable'));

    await expect(worker.tick()).resolves.toBeUndefined();
  });

  it('performs no provider call of its own', () => {
    // W1.2's worker has exactly two collaborators: the receipt store and the
    // interaction store. A Graph client, publisher or notification service
    // appearing here would mean an outbound side effect landed in an inbound
    // handler (§15).
    expect(SocialOrganicWebhookWorker.length).toBe(2);
  });
});
