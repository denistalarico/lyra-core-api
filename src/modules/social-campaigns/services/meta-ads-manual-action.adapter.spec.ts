import {
  MetaAdsManualActionAdapter,
  MetaAdManualActionError,
} from './meta-ads-manual-action.adapter';

jest.mock('../../social-integrations', () => ({}));
jest.mock(
  '../../social-integrations/services/meta-ads-graph.service',
  () => ({}),
);

const scope = {
  tenantId: '00000000-0000-4000-8000-000000000001',
  workspaceId: '00000000-0000-4000-8000-000000000002',
  agencyClientId: null,
  connectionId: '00000000-0000-4000-8000-000000000003',
};

describe('MetaAdsManualActionAdapter', () => {
  it('checks provider state before changing an existing daily budget', async () => {
    const credentials = {
      resolve: jest.fn().mockResolvedValue({ accessToken: 'secret' }),
    };
    const graph = {
      readNode: jest
        .fn()
        .mockResolvedValueOnce({ status: 'ACTIVE', daily_budget: '1000' })
        .mockResolvedValueOnce({ status: 'ACTIVE', daily_budget: '1200' }),
      mutateNode: jest.fn().mockResolvedValue({ success: true }),
    };
    const adapter = new MetaAdsManualActionAdapter(
      credentials as never,
      graph as never,
    );

    await expect(
      adapter.execute({
        ...scope,
        entityLevel: 'campaign',
        entityExternalId: '123456',
        actionType: 'set_budget',
        expected: {
          status: 'ACTIVE',
          dailyBudgetMinor: '1000',
          lifetimeBudgetMinor: null,
          endsAt: null,
        },
        change: { budgetKind: 'daily', budgetAmountMinor: 1200 },
      }),
    ).resolves.toMatchObject({ providerAccepted: true, verified: true });

    expect(graph.mutateNode).toHaveBeenCalledWith(
      expect.objectContaining({
        accessToken: 'secret',
        path: '123456',
        method: 'POST',
        params: { daily_budget: '1200' },
      }),
    );
  });

  it('blocks when the provider state changed and never mutates', async () => {
    const credentials = {
      resolve: jest.fn().mockResolvedValue({ accessToken: 'secret' }),
    };
    const graph = {
      readNode: jest.fn().mockResolvedValue({ status: 'PAUSED' }),
      mutateNode: jest.fn(),
    };
    const adapter = new MetaAdsManualActionAdapter(
      credentials as never,
      graph as never,
    );

    await expect(
      adapter.execute({
        ...scope,
        entityLevel: 'ad',
        entityExternalId: '98765',
        actionType: 'set_status',
        expected: {
          status: 'ACTIVE',
          dailyBudgetMinor: null,
          lifetimeBudgetMinor: null,
          endsAt: null,
        },
        change: { status: 'PAUSED' },
      }),
    ).rejects.toBeInstanceOf(MetaAdManualActionError);
    expect(graph.mutateNode).not.toHaveBeenCalled();
  });

  it('uses an explicit DELETE and reports provider confirmation', async () => {
    const credentials = {
      resolve: jest.fn().mockResolvedValue({ accessToken: 'secret' }),
    };
    const graph = {
      readNode: jest.fn().mockResolvedValue({ status: 'PAUSED' }),
      mutateNode: jest.fn().mockResolvedValue({ success: true }),
    };
    const adapter = new MetaAdsManualActionAdapter(
      credentials as never,
      graph as never,
    );

    await expect(
      adapter.execute({
        ...scope,
        entityLevel: 'ad',
        entityExternalId: '98765',
        actionType: 'delete',
        expected: {
          status: 'PAUSED',
          dailyBudgetMinor: null,
          lifetimeBudgetMinor: null,
          endsAt: null,
        },
        change: { irreversible: true },
      }),
    ).resolves.toMatchObject({ providerAccepted: true, verified: true });
    expect(graph.mutateNode).toHaveBeenCalledWith(
      expect.objectContaining({ method: 'DELETE' }),
    );
  });
});
