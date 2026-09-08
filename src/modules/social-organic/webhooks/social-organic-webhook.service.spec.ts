import { QueryFailedError } from 'typeorm';
import { SocialOrganicWebhookService } from './social-organic-webhook.service';

type Saved = Record<string, unknown>;

function uniqueViolation(): QueryFailedError {
  const error = new QueryFailedError('INSERT', [], new Error('duplicate key'));
  (error as unknown as { driverError: { code: string } }).driverError = {
    code: '23505',
  };
  return error;
}

describe('SocialOrganicWebhookService', () => {
  const tenantId = '11111111-1111-4111-8111-111111111111';
  const workspaceId = '22222222-2222-4222-8222-222222222222';
  const assetRowId = '33333333-3333-4333-8333-333333333333';

  let saved: Saved[];
  let events: {
    save: jest.Mock;
    create: jest.Mock;
    findOne: jest.Mock;
    find: jest.Mock;
  };
  let assets: { find: jest.Mock };
  let dataSource: { query: jest.Mock; transaction: jest.Mock };
  let service: SocialOrganicWebhookService;

  const ingestInput = {
    provider: 'meta',
    eventKey: 'meta:sha256:abc',
    objectType: 'page',
    externalAssetId: 'page-1',
    rawPayload: { object: 'page', entry: [{ id: 'page-1' }] },
  };

  const assetRow = {
    id: assetRowId,
    tenantId,
    workspaceId,
    agencyClientId: null,
  };

  beforeEach(() => {
    saved = [];
    events = {
      create: jest.fn((row: Saved) => row),
      save: jest.fn((row: Saved) => {
        saved.push(row);
        return Promise.resolve({ ...row, id: 'event-1' });
      }),
      findOne: jest.fn(),
      find: jest.fn(),
    };
    assets = { find: jest.fn().mockResolvedValue([]) };
    dataSource = { query: jest.fn(), transaction: jest.fn() };

    service = new SocialOrganicWebhookService(
      events as never,
      assets as never,
      dataSource as never,
    );
  });

  describe('scope resolution', () => {
    it('resolves tenant, workspace, client and asset from the provider id', async () => {
      assets.find.mockResolvedValue([assetRow]);

      const result = await service.ingest(ingestInput);

      expect(result.scopeResolution).toBe('resolved');
      expect(saved[0]).toMatchObject({
        tenantId,
        workspaceId,
        agencyClientId: null,
        assetId: assetRowId,
        scopeResolution: 'resolved',
      });
    });

    it('carries a managed client id through when the asset has one', async () => {
      const agencyClientId = '44444444-4444-4444-8444-444444444444';
      assets.find.mockResolvedValue([{ ...assetRow, agencyClientId }]);

      await service.ingest(ingestInput);

      expect(saved[0]).toMatchObject({ agencyClientId, assetId: assetRowId });
    });

    it('looks the asset up by provider and external id only', async () => {
      assets.find.mockResolvedValue([assetRow]);

      await service.ingest(ingestInput);

      expect(assets.find).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { provider: 'meta', externalAssetId: 'page-1' },
          take: 2,
        }),
      );
    });

    it('never guesses when two scopes claim the same external asset', async () => {
      assets.find.mockResolvedValue([
        assetRow,
        { ...assetRow, id: 'other', tenantId: 'other-tenant' },
      ]);

      const result = await service.ingest(ingestInput);

      expect(result.scopeResolution).toBe('unresolved_ambiguous');
      expect(saved[0]).toMatchObject({
        tenantId: null,
        workspaceId: null,
        agencyClientId: null,
        assetId: null,
      });
    });

    it('stays unresolved for an asset this platform does not manage', async () => {
      assets.find.mockResolvedValue([]);

      const result = await service.ingest(ingestInput);

      expect(result.scopeResolution).toBe('unresolved_unknown_asset');
      expect(saved[0]).toMatchObject({ tenantId: null, assetId: null });
    });

    it('stays unresolved when the envelope carries no asset id', async () => {
      const result = await service.ingest({
        ...ingestInput,
        externalAssetId: null,
      });

      expect(result.scopeResolution).toBe('unresolved_no_asset_id');
      expect(assets.find).not.toHaveBeenCalled();
      expect(saved[0]).toMatchObject({ tenantId: null, assetId: null });
    });

    it('ignores any scope the payload itself claims', async () => {
      assets.find.mockResolvedValue([assetRow]);

      await service.ingest({
        ...ingestInput,
        rawPayload: {
          object: 'page',
          tenantId: 'attacker-tenant',
          workspaceId: 'attacker-workspace',
          agencyClientId: 'attacker-client',
          entry: [{ id: 'page-1' }],
        },
      });

      expect(saved[0]).toMatchObject({
        tenantId,
        workspaceId,
        agencyClientId: null,
      });
    });
  });

  describe('persistence and dedupe', () => {
    it('persists the raw payload and the identifying fields', async () => {
      assets.find.mockResolvedValue([assetRow]);

      await service.ingest(ingestInput);

      expect(saved[0]).toMatchObject({
        provider: 'meta',
        eventKey: 'meta:sha256:abc',
        objectType: 'page',
        externalAssetId: 'page-1',
        status: 'received',
        rawPayload: ingestInput.rawPayload,
      });
    });

    it('stores no token, secret or signature alongside the event', async () => {
      assets.find.mockResolvedValue([assetRow]);

      await service.ingest(ingestInput);

      const serialized = JSON.stringify(saved[0]);
      for (const forbidden of [
        'assetToken',
        'accessToken',
        'appSecret',
        'signature',
        'verifyToken',
      ]) {
        expect(serialized).not.toContain(forbidden);
      }
      expect(Object.keys(saved[0])).not.toContain('metadata');
    });

    it('returns the existing row when the unique index rejects a redelivery', async () => {
      assets.find.mockResolvedValue([assetRow]);
      events.save.mockRejectedValueOnce(uniqueViolation());
      events.findOne.mockResolvedValue({
        id: 'existing-event',
        scopeResolution: 'resolved',
      });

      const result = await service.ingest(ingestInput);

      expect(result).toEqual({
        eventId: 'existing-event',
        duplicate: true,
        scopeResolution: 'resolved',
      });
      expect(events.findOne).toHaveBeenCalledWith({
        where: { provider: 'meta', eventKey: 'meta:sha256:abc' },
      });
    });

    it('rethrows a failure that is not a unique violation', async () => {
      assets.find.mockResolvedValue([assetRow]);
      events.save.mockRejectedValueOnce(new Error('connection lost'));

      await expect(service.ingest(ingestInput)).rejects.toThrow(
        'connection lost',
      );
    });
  });

  describe('queue', () => {
    it('leases only received rows that are due, skipping locked ones', async () => {
      const manager = {
        query: jest
          .fn()
          .mockResolvedValueOnce([{ id: 'event-1' }])
          .mockResolvedValueOnce([[{ id: 'event-1' }], 1]),
      };
      dataSource.transaction.mockImplementation((fn: (m: unknown) => unknown) =>
        Promise.resolve(fn(manager)),
      );
      events.find.mockResolvedValue([{ id: 'event-1' }]);

      const claimed = await service.claim({ workerId: 'w1', limit: 5 });

      expect(claimed).toHaveLength(1);
      const [selectSql] = manager.query.mock.calls[0] as [string, unknown[]];
      expect(selectSql).toContain("status = 'received'");
      expect(selectSql).toContain('FOR UPDATE SKIP LOCKED');
      const [updateSql] = manager.query.mock.calls[1] as [string, unknown[]];
      expect(updateSql).toContain('attempts = attempts + 1');
      expect(updateSql).toContain("status = 'received'");
    });

    it('claims nothing when no row is due', async () => {
      const manager = { query: jest.fn().mockResolvedValueOnce([]) };
      dataSource.transaction.mockImplementation((fn: (m: unknown) => unknown) =>
        Promise.resolve(fn(manager)),
      );

      expect(await service.claim({ workerId: 'w1', limit: 5 })).toEqual([]);
      expect(events.find).not.toHaveBeenCalled();
    });

    it('requeues an expired lease and dead-letters an exhausted one', async () => {
      dataSource.query.mockResolvedValue([
        [{ status: 'received' }, { status: 'dead_letter' }],
        2,
      ]);

      expect(await service.recoverStale()).toEqual({
        requeued: 1,
        deadLettered: 1,
      });
      const [sql] = dataSource.query.mock.calls[0] as [string, unknown[]];
      expect(sql).toContain("safe_error_code = 'lease_expired'");
    });

    it('settles only the row this worker still holds', async () => {
      dataSource.query.mockResolvedValue([[{ id: 'event-1' }], 1]);

      const settled = await service.settle({
        eventId: 'event-1',
        lockedBy: 'w1',
        status: 'unhandled',
        safeErrorCode: 'no_handler_registered',
      });

      expect(settled).toBe(true);
      const [sql, params] = dataSource.query.mock.calls[0] as [
        string,
        unknown[],
      ];
      expect(sql).toContain('locked_by = $4');
      expect(params).toEqual([
        'event-1',
        'unhandled',
        'no_handler_registered',
        'w1',
      ]);
    });

    it('reports a lost lease rather than overwriting another worker', async () => {
      dataSource.query.mockResolvedValue([[], 0]);

      expect(
        await service.settle({
          eventId: 'event-1',
          lockedBy: 'stale-worker',
          status: 'processed',
        }),
      ).toBe(false);
    });
  });
});
