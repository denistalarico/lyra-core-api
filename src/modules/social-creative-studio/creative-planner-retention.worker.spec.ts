import { CreativePlannerRetentionWorker } from './creative-planner-retention.worker';

const upload = {
  media_asset_id: 'media',
  content_item_id: 'item',
  tenant_id: 't',
  workspace_id: 'w',
  agency_client_id: 'c',
  company_context_id: 'co',
  created_by_id: 'u',
};

function harness(untracked: object[], published: object[]) {
  const updates: unknown[][] = [];
  const dataSource = {
    query: jest.fn(async (sql: string, params: unknown[]) => {
      if (sql.includes('UPDATE')) {
        updates.push(params);
        return [];
      }
      return sql.includes('social_destination_creatives d\n    JOIN')
        ? untracked
        : published;
    }),
  };
  const assets = { adoptPlannerUpload: jest.fn(async () => ({})) };
  return {
    worker: new CreativePlannerRetentionWorker(
      dataSource as never,
      assets as never,
    ),
    assets,
    updates,
    dataSource,
  };
}

describe('CreativePlannerRetentionWorker', () => {
  it('adopts an upload in the scope of its media', async () => {
    const h = harness([upload], []);
    await expect(h.worker.run()).resolves.toEqual({ adopted: 1, trashed: 0 });
    expect(h.assets.adoptPlannerUpload).toHaveBeenCalledWith(
      {
        tenantId: 't',
        workspaceId: 'w',
        agencyClientId: 'c',
        companyContextId: 'co',
      },
      'u',
      { mediaAssetId: 'media', contentItemId: 'item' },
    );
  });

  it('keeps going when one upload fails', async () => {
    const h = harness([upload, upload], []);
    h.assets.adoptPlannerUpload.mockRejectedValueOnce(new Error('storage'));
    await expect(h.worker.run()).resolves.toEqual({ adopted: 1, trashed: 0 });
  });

  it('sends a published upload to the Lixeira with the period of its context', async () => {
    const h = harness([], [{ id: 'asset', days: 7 }]);
    await expect(h.worker.run()).resolves.toEqual({ adopted: 0, trashed: 1 });
    expect(h.updates).toEqual([['asset', 7]]);
  });

  it('ignores bindings from before the feature existed', async () => {
    const h = harness([], []);
    await h.worker.run();
    expect(h.dataSource.query.mock.calls[0][1]).toEqual([
      '2026-11-08T00:00:00.000Z',
      50,
    ]);
  });
});
