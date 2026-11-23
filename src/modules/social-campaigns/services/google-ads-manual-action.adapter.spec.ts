import {
  GoogleAdManualActionError,
  GoogleAdsManualActionAdapter,
  type GoogleAdActionInput,
  type GoogleAdWritableState,
} from './google-ads-manual-action.adapter';

const CUSTOMER = '1234567890';
const scope = {
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  companyContextId: null,
};

function setup(searchResults: Array<Array<Record<string, unknown>>>) {
  const credential = {
    connectionId: 'c1',
    accessToken: 'token',
    externalAccountId: CUSTOMER,
  };
  const credentials = { resolve: jest.fn().mockResolvedValue(credential) };
  const client = {
    search: jest.fn(),
    mutate: jest.fn().mockResolvedValue({ resourceNames: [] }),
  };
  for (const rows of searchResults) client.search.mockResolvedValueOnce(rows);
  const adapter = new GoogleAdsManualActionAdapter(
    credentials as never,
    client as never,
  );
  return { adapter, client };
}

const empty: GoogleAdWritableState = {
  status: null,
  budget: null,
  criterionResourceName: null,
};

function input(partial: Partial<GoogleAdActionInput>): GoogleAdActionInput {
  return {
    ...scope,
    connectionId: 'c1',
    actionType: 'set_status',
    target: { kind: 'campaign', id: '24460619718', adGroupId: null },
    change: {},
    ...partial,
  };
}

describe('GoogleAdsManualActionAdapter (GA-WRITE)', () => {
  it('pauses an asset group with an update on status only', async () => {
    const { adapter, client } = setup([
      [{ assetGroup: { id: '9', status: 'ENABLED' } }],
      [{ assetGroup: { id: '9', status: 'PAUSED' } }],
    ]);
    const result = await adapter.execute({
      ...input({
        target: { kind: 'asset_group', id: '9', adGroupId: null },
        change: { status: 'PAUSED' },
      }),
      expected: { ...empty, status: 'ENABLED' },
    });

    expect(client.search.mock.calls[0][1]).toContain('FROM asset_group');
    expect(client.mutate).toHaveBeenCalledWith(
      expect.anything(),
      'assetGroups',
      [
        {
          update: {
            resourceName: `customers/${CUSTOMER}/assetGroups/9`,
            status: 'PAUSED',
          },
          updateMask: 'status',
        },
      ],
      { validateOnly: false },
    );
    expect(result).toMatchObject({ providerAccepted: true, verified: true });
  });

  it('names an ad by ad group and ad id', async () => {
    const { adapter, client } = setup([]);
    await adapter.validate({
      ...input({
        target: { kind: 'ad_group_ad', id: '77', adGroupId: '55' },
        change: { status: 'ACTIVE' },
      }),
      expected: { ...empty, status: 'PAUSED' },
    });
    const [, resource, operations, options] = client.mutate.mock.calls[0];
    expect(resource).toBe('adGroupAds');
    expect(operations[0].update).toEqual({
      resourceName: `customers/${CUSTOMER}/adGroupAds/55~77`,
      status: 'ENABLED',
    });
    expect(options).toEqual({ validateOnly: true });
  });

  it('reads the campaign budget and converts minor units to micros', async () => {
    const { adapter, client } = setup([
      [
        {
          campaign: { id: '24460619718', status: 'ENABLED' },
          campaignBudget: {
            resourceName: `customers/${CUSTOMER}/campaignBudgets/31`,
            amountMicros: '50000000',
            period: 'DAILY',
          },
        },
      ],
    ]);
    const state = await adapter.inspect(
      input({
        actionType: 'set_budget',
        change: { budgetKind: 'daily', budgetAmountMinor: 5100 },
      }),
    );
    expect(state.budget).toEqual({
      resourceName: `customers/${CUSTOMER}/campaignBudgets/31`,
      amountMinor: '5000',
      period: 'DAILY',
      shared: false,
    });

    await adapter.validate({
      ...input({
        actionType: 'set_budget',
        change: { budgetKind: 'daily', budgetAmountMinor: 5100 },
      }),
      expected: state,
    });
    expect(client.mutate.mock.calls[0][1]).toBe('campaignBudgets');
    expect(client.mutate.mock.calls[0][2]).toEqual([
      {
        update: {
          resourceName: `customers/${CUSTOMER}/campaignBudgets/31`,
          amountMicros: '51000000',
        },
        updateMask: 'amount_micros',
      },
    ]);
  });

  it('never builds a write on a shared budget', async () => {
    const { adapter, client } = setup([]);
    await expect(
      adapter.validate({
        ...input({
          actionType: 'set_budget',
          change: { budgetKind: 'daily', budgetAmountMinor: 5100 },
        }),
        expected: {
          ...empty,
          budget: {
            resourceName: `customers/${CUSTOMER}/campaignBudgets/31`,
            amountMinor: '5000',
            period: 'DAILY',
            shared: true,
          },
        },
      }),
    ).rejects.toThrow(new GoogleAdManualActionError('google_budget_shared'));
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it('refuses to write when the live state moved since the preflight', async () => {
    const { adapter, client } = setup([
      [{ campaign: { id: '24460619718', status: 'PAUSED' } }],
    ]);
    await expect(
      adapter.execute({
        ...input({ change: { status: 'PAUSED' } }),
        expected: { ...empty, status: 'ENABLED' },
      }),
    ).rejects.toThrow(new GoogleAdManualActionError('provider_state_changed'));
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it('adds a negative keyword without putting the text in GAQL', async () => {
    const { adapter, client } = setup([[], []]);
    const change = { op: 'add', text: "grátis' OR 1=1", matchType: 'PHRASE' };
    const state = await adapter.inspect(
      input({ actionType: 'negative_keyword', change }),
    );
    expect(state.criterionResourceName).toBeNull();
    expect(client.search.mock.calls[0][1]).not.toContain('grátis');
    expect(client.search.mock.calls[0][1]).toContain(
      `campaign_criterion.campaign = 'customers/${CUSTOMER}/campaigns/24460619718'`,
    );

    await adapter.validate({
      ...input({ actionType: 'negative_keyword', change }),
      expected: state,
    });
    expect(client.mutate.mock.calls[0][1]).toBe('campaignCriteria');
    expect(client.mutate.mock.calls[0][2]).toEqual([
      {
        create: {
          campaign: `customers/${CUSTOMER}/campaigns/24460619718`,
          negative: true,
          keyword: { text: "grátis' OR 1=1", matchType: 'PHRASE' },
        },
      },
    ]);
  });

  it('removes a keyword by the resource name Google returned', async () => {
    const criterion = `customers/${CUSTOMER}/adGroupCriteria/55~901`;
    const { adapter, client } = setup([
      [
        {
          adGroupCriterion: {
            resourceName: criterion,
            keyword: { text: 'Curso  Online', matchType: 'EXACT' },
          },
        },
      ],
      [],
    ]);
    const change = { op: 'remove', text: 'curso online', matchType: 'EXACT' };
    const result = await adapter.execute({
      ...input({
        actionType: 'keyword',
        target: { kind: 'ad_group', id: '55', adGroupId: null },
        change,
      }),
      expected: { ...empty, criterionResourceName: criterion },
    });
    expect(client.mutate.mock.calls[0][1]).toBe('adGroupCriteria');
    expect(client.mutate.mock.calls[0][2]).toEqual([{ remove: criterion }]);
    expect(result).toMatchObject({ verified: true });
  });

  it('pauses an ad group keyword with an update on its status only', async () => {
    const criterion = `customers/${CUSTOMER}/adGroupCriteria/55~901`;
    const row = (status: string) => ({
      adGroupCriterion: {
        resourceName: criterion,
        status,
        keyword: { text: 'curso online', matchType: 'PHRASE' },
      },
    });
    const { adapter, client } = setup([[row('ENABLED')], [row('PAUSED')]]);
    const result = await adapter.execute({
      ...input({
        actionType: 'keyword',
        target: { kind: 'ad_group', id: '55', adGroupId: null },
        change: { op: 'pause', text: 'curso online', matchType: 'PHRASE' },
      }),
      expected: {
        ...empty,
        status: 'ENABLED',
        criterionResourceName: criterion,
      },
    });
    expect(client.mutate.mock.calls[0][1]).toBe('adGroupCriteria');
    expect(client.mutate.mock.calls[0][2]).toEqual([
      {
        update: { resourceName: criterion, status: 'PAUSED' },
        updateMask: 'status',
      },
    ]);
    expect(result).toMatchObject({ verified: true });
  });

  it('refuses to pause a negative keyword', async () => {
    const criterion = `customers/${CUSTOMER}/campaignCriteria/24460619718~5`;
    const { adapter, client } = setup([
      [
        {
          campaignCriterion: {
            resourceName: criterion,
            keyword: { text: 'grátis', matchType: 'PHRASE' },
          },
        },
      ],
    ]);
    await expect(
      adapter.execute({
        ...input({
          actionType: 'negative_keyword',
          change: { op: 'pause', text: 'grátis', matchType: 'PHRASE' },
        }),
        expected: { ...empty, criterionResourceName: criterion },
      }),
    ).rejects.toBeInstanceOf(GoogleAdManualActionError);
    expect(client.mutate).not.toHaveBeenCalled();
  });

  it('lists Search keywords with status and period metrics, zero when idle', async () => {
    const { adapter, client } = setup([
      [
        {
          adGroup: { id: '55' },
          adGroupCriterion: {
            criterionId: '901',
            status: 'ENABLED',
            keyword: { text: 'curso', matchType: 'EXACT' },
          },
        },
        {
          adGroup: { id: '55' },
          adGroupCriterion: {
            criterionId: '902',
            status: 'PAUSED',
            keyword: { text: 'aula', matchType: 'BROAD' },
          },
        },
      ],
      [
        {
          adGroup: { id: '55' },
          adGroupCriterion: { criterionId: '901' },
          metrics: {
            impressions: '120',
            clicks: '9',
            interactions: '10',
            conversions: 2.5,
          },
        },
      ],
    ]);
    const items = await adapter.listKeywords({
      ...scope,
      connectionId: 'c1',
      campaignId: '24460619718',
      channelType: 'SEARCH',
      groups: [{ id: '55', name: 'Grupo', kind: 'ad_group' }],
      since: '2026-11-01',
      until: '2026-11-20',
    });
    expect(client.search.mock.calls[1][1]).toContain(
      "segments.date BETWEEN '2026-11-01' AND '2026-11-20'",
    );
    expect(items).toEqual([
      expect.objectContaining({
        text: 'curso',
        status: 'ENABLED',
        groupName: 'Grupo',
        impressions: '120',
        interactions: '10',
        conversions: '2.5',
      }),
      expect.objectContaining({
        text: 'aula',
        status: 'PAUSED',
        impressions: '0',
        conversions: '0',
      }),
    ]);
  });

  it('refuses a malformed period before any Google request', async () => {
    const { adapter, client } = setup([]);
    await expect(
      adapter.listKeywords({
        ...scope,
        connectionId: 'c1',
        campaignId: '24460619718',
        channelType: 'SEARCH',
        groups: [],
        since: "2026-11-01' OR 1=1",
        until: '2026-11-20',
      }),
    ).rejects.toBeInstanceOf(GoogleAdManualActionError);
    expect(client.search).not.toHaveBeenCalled();
  });

  it('does not treat another match type as the same keyword', async () => {
    const { adapter } = setup([
      [
        {
          campaignCriterion: {
            resourceName: `customers/${CUSTOMER}/campaignCriteria/24460619718~5`,
            keyword: { text: 'curso', matchType: 'BROAD' },
          },
        },
      ],
    ]);
    const state = await adapter.inspect(
      input({
        actionType: 'negative_keyword',
        change: { op: 'add', text: 'curso', matchType: 'EXACT' },
      }),
    );
    expect(state.criterionResourceName).toBeNull();
  });

  it('adds a search theme to a PMax asset group', async () => {
    const { adapter, client } = setup([]);
    await adapter.validate({
      ...input({
        actionType: 'search_theme',
        target: { kind: 'asset_group', id: '9', adGroupId: null },
        change: { op: 'add', text: 'aulas de inglês', matchType: null },
      }),
      expected: empty,
    });
    expect(client.mutate.mock.calls[0][1]).toBe('assetGroupSignals');
    expect(client.mutate.mock.calls[0][2]).toEqual([
      {
        create: {
          assetGroup: `customers/${CUSTOMER}/assetGroups/9`,
          searchTheme: { text: 'aulas de inglês' },
        },
      },
    ]);
  });

  it('reports accepted but unverified when the read back fails', async () => {
    const { adapter, client } = setup([
      [{ campaign: { id: '24460619718', status: 'ENABLED' } }],
    ]);
    client.search.mockRejectedValueOnce(new Error('timeout'));
    const result = await adapter.execute({
      ...input({ change: { status: 'PAUSED' } }),
      expected: { ...empty, status: 'ENABLED' },
    });
    expect(result).toMatchObject({ providerAccepted: true, verified: false });
  });

  it('refuses ids that are not digits before any request', async () => {
    const { adapter, client } = setup([]);
    await expect(
      adapter.inspect(
        input({
          target: { kind: 'campaign', id: '1 OR 1=1', adGroupId: null },
        }),
      ),
    ).rejects.toThrow(new GoogleAdManualActionError('google_object_not_found'));
    expect(client.search).not.toHaveBeenCalled();
  });
});
