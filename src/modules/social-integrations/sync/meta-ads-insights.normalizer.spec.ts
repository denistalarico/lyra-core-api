import { META_ACTION_MAPPING_VERSION } from './meta-action-mapping';
import type { InsightsNormalizeContext } from './meta-ads-insights.normalizer';
import { normalizeMetricRow } from './meta-ads-insights.normalizer';

const SYNCED_AT = new Date('2026-08-26T12:00:00.000Z');

function context(
  overrides: Partial<InsightsNormalizeContext> = {},
): InsightsNormalizeContext {
  return {
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    connectionId: 'connection-a',
    provider: 'meta_ads',
    source: 'paid',
    attributionSetting: 'account_default',
    entityLevel: 'account',
    accountExternalId: 'act_415877197389621',
    accountTimezone: 'America/Sao_Paulo',
    currency: 'BRL',
    isPartial: false,
    syncedAt: SYNCED_AT,
    ...overrides,
  };
}

/** A row shaped exactly like the ones the real account returned. */
const ACCOUNT_ROW = {
  date_start: '2026-07-10',
  date_stop: '2026-07-10',
  spend: '11.51',
  impressions: '412',
  reach: '380',
  clicks: '5',
  inline_link_clicks: '3',
  actions: [
    { action_type: 'video_view', value: '72' },
    { action_type: 'lead', value: '2' },
    { action_type: 'onsite_conversion.lead', value: '2' },
    {
      action_type: 'onsite_conversion.messaging_conversation_started_7d',
      value: '1',
    },
  ],
};

describe('normalizeMetricRow — account level', () => {
  it('normalizes a real account row', () => {
    const row = normalizeMetricRow(ACCOUNT_ROW, context());

    expect(row).toMatchObject({
      entityLevel: 'account',
      entityExternalId: 'act_415877197389621',
      campaignExternalId: null,
      metricDate: '2026-07-10',
      accountTimezone: 'America/Sao_Paulo',
      currency: 'BRL',
      source: 'paid',
      attributionSetting: 'account_default',
      spend: '11.510000',
      impressions: '412',
      reach: '380',
      clicks: '5',
      linkClicks: '3',
      leads: '2',
      videoViews: '72',
      isPartial: false,
      syncedAt: SYNCED_AT,
    });
  });

  it('takes the account id from the credential, never from the payload', () => {
    const row = normalizeMetricRow(
      { ...ACCOUNT_ROW, account_id: '999', id: 'act_999' },
      context(),
    );

    // The resolver already validated the bound account. Reading it back out of
    // a response would let a redirected read write facts under an unchecked id.
    expect(row?.entityExternalId).toBe('act_415877197389621');
  });

  it('carries the scope of the run onto every row', () => {
    const row = normalizeMetricRow(
      ACCOUNT_ROW,
      context({ agencyClientId: 'client-a' }),
    );

    expect(row).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: 'client-a',
      connectionId: 'connection-a',
      provider: 'meta_ads',
    });
  });

  it('uses date_start verbatim, with no timezone conversion', () => {
    const row = normalizeMetricRow(
      { ...ACCOUNT_ROW, date_start: '2026-01-01', date_stop: '2026-01-01' },
      context(),
    );

    // An account three hours behind UTC would have its first day of the year
    // read as the last day of the previous one.
    expect(row?.metricDate).toBe('2026-01-01');
  });

  it('stores both action maps, so the mapping can be re-derived', () => {
    const row = normalizeMetricRow(
      { ...ACCOUNT_ROW, action_values: [{ action_type: 'lead', value: '40' }] },
      context(),
    );

    expect(row?.actions).toEqual({
      mappingVersion: META_ACTION_MAPPING_VERSION,
      counts: {
        video_view: '72.000000',
        lead: '2.000000',
        'onsite_conversion.lead': '2.000000',
        'onsite_conversion.messaging_conversation_started_7d': '1.000000',
      },
      values: { lead: '40.000000' },
    });
  });
});

describe('normalizeMetricRow — campaign level', () => {
  it('keys the row by the campaign Meta reported', () => {
    const row = normalizeMetricRow(
      { ...ACCOUNT_ROW, campaign_id: '120244382299410411' },
      context({ entityLevel: 'campaign' }),
    );

    expect(row).toMatchObject({
      entityLevel: 'campaign',
      entityExternalId: '120244382299410411',
      campaignExternalId: '120244382299410411',
    });
  });

  it('normalizes a campaign that has no row in the hierarchy mirror', () => {
    // Facts carry no foreign key to `social_ad_entities` on purpose: a campaign
    // created since the last hierarchy sync must still get its spend recorded.
    const row = normalizeMetricRow(
      { ...ACCOUNT_ROW, campaign_id: '999999999999999' },
      context({ entityLevel: 'campaign' }),
    );

    expect(row?.entityExternalId).toBe('999999999999999');
  });

  it('skips a campaign row with no usable campaign id', () => {
    for (const campaignId of [undefined, '', 'act_1', 'abc']) {
      expect(
        normalizeMetricRow(
          { ...ACCOUNT_ROW, campaign_id: campaignId },
          context({ entityLevel: 'campaign' }),
        ),
      ).toBeNull();
    }
  });
});

/**
 * Ad set level — the grain that makes paid media destination measurable.
 *
 * `ADSET_ROW` carries both ids because Meta returns both at this level: the
 * shape is taken from a real `level=adset` read of the production account,
 * where every row had a numeric `adset_id` and its parent `campaign_id`.
 */
describe('normalizeMetricRow — ad set level', () => {
  const ADSET_ROW = {
    ...ACCOUNT_ROW,
    adset_id: '120244382526760411',
    campaign_id: '120244382299410411',
  };

  const adsetContext = () => context({ entityLevel: 'adset' });

  it('keys the row by the ad set, not by its campaign', () => {
    // The distinction the whole level exists for. Keying on the campaign would
    // collapse every ad set of one campaign onto a single row per day and
    // overwrite them in turn, under a unique key that would never complain.
    const row = normalizeMetricRow(ADSET_ROW, adsetContext());

    expect(row).toMatchObject({
      entityLevel: 'adset',
      entityExternalId: '120244382526760411',
      campaignExternalId: '120244382299410411',
    });
  });

  it('keeps two ad sets of one campaign as two distinct facts', () => {
    const first = normalizeMetricRow(ADSET_ROW, adsetContext());
    const second = normalizeMetricRow(
      { ...ADSET_ROW, adset_id: '120244382526760412' },
      adsetContext(),
    );

    expect(first?.entityExternalId).not.toBe(second?.entityExternalId);
    // Same parent, so a campaign roll-up still finds both.
    expect(first?.campaignExternalId).toBe(second?.campaignExternalId);
  });

  it('normalizes an ad set that has no row in the hierarchy mirror', () => {
    // Same tolerance the campaign level has, and for the same reason: an ad set
    // created since the last hierarchy sweep must still get its spend recorded.
    const row = normalizeMetricRow(
      { ...ADSET_ROW, adset_id: '999999999999999' },
      adsetContext(),
    );

    expect(row?.entityExternalId).toBe('999999999999999');
  });

  it('skips an ad set row with no usable ad set id', () => {
    for (const adsetId of [undefined, '', 'act_1', 'abc', null, 12345]) {
      expect(
        normalizeMetricRow({ ...ADSET_ROW, adset_id: adsetId }, adsetContext()),
      ).toBeNull();
    }
  });

  it('skips an ad set row that names no campaign', () => {
    // Meta returns both together at this level, so one without the other is a
    // payload this code does not understand. A skip is counted where a
    // half-attributed fact would not be.
    expect(
      normalizeMetricRow(
        { ...ADSET_ROW, campaign_id: undefined },
        adsetContext(),
      ),
    ).toBeNull();
  });

  it('ignores adset_id at the levels that are not about an ad set', () => {
    // A stray field must never change what a row is keyed by.
    expect(
      normalizeMetricRow(ADSET_ROW, context({ entityLevel: 'account' })),
    ).toMatchObject({
      entityExternalId: 'act_415877197389621',
      campaignExternalId: null,
    });

    expect(
      normalizeMetricRow(ADSET_ROW, context({ entityLevel: 'campaign' })),
    ).toMatchObject({
      entityExternalId: '120244382299410411',
      campaignExternalId: '120244382299410411',
    });
  });

  it('measures an ad set row exactly as it measures the coarser levels', () => {
    // §11: one mapping, one version, three levels. The probe against the real
    // account confirmed the provider agrees — identical spend and identical
    // lead counts at account, campaign and ad set for the same window.
    const account = normalizeMetricRow(ACCOUNT_ROW, context());
    const adset = normalizeMetricRow(ADSET_ROW, adsetContext());

    for (const field of [
      'spend',
      'impressions',
      'reach',
      'clicks',
      'linkClicks',
      'leads',
      'conversions',
      'conversionValue',
      'videoViews',
    ] as const) {
      expect(adset?.[field]).toEqual(account?.[field]);
    }

    expect(adset?.actions).toEqual(account?.actions);
    expect((adset?.actions as { mappingVersion: number }).mappingVersion).toBe(
      META_ACTION_MAPPING_VERSION,
    );
  });

  it('keeps reach nullable rather than zero at ad set level too', () => {
    // §10: reach is non-additive at every grain. A zero would be summed by
    // anyone who did not know that, and ad set is the level most likely to be
    // summed into a per-destination total.
    const row = normalizeMetricRow(
      { ...ADSET_ROW, reach: undefined },
      adsetContext(),
    );

    expect(row?.reach).toBeNull();
  });

  it('carries the run scope and attribution onto an ad set fact', () => {
    const row = normalizeMetricRow(ADSET_ROW, adsetContext());

    expect(row).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      connectionId: 'connection-a',
      source: 'paid',
      attributionSetting: 'account_default',
      accountTimezone: 'America/Sao_Paulo',
      isPartial: false,
    });
  });

  it('takes is_partial from the run at ad set level, not from the date', () => {
    const row = normalizeMetricRow(
      ADSET_ROW,
      context({ entityLevel: 'adset', isPartial: true }),
    );

    expect(row?.isPartial).toBe(true);
  });
});

describe('normalizeMetricRow — absence and invalidity', () => {
  it('reads an omitted metric as zero, because Meta omits what is zero', () => {
    const row = normalizeMetricRow(
      { date_start: '2026-07-06', spend: '0.16', impressions: '2' },
      context(),
    );

    expect(row).toMatchObject({
      spend: '0.160000',
      impressions: '2',
      clicks: '0',
      linkClicks: '0',
      leads: '0',
      conversions: '0.000000',
      conversionValue: '0.000000',
      videoViews: '0',
      actions: {
        mappingVersion: META_ACTION_MAPPING_VERSION,
        counts: {},
        values: {},
      },
    });
  });

  it('stamps the mapping version even on a row with no actions', () => {
    const row = normalizeMetricRow(
      { date_start: '2026-07-06', spend: '0.16' },
      context(),
    );

    // Without it there is no way to tell, later, which definition of `leads`
    // produced this row's zero.
    expect((row?.actions as { mappingVersion: number }).mappingVersion).toBe(
      META_ACTION_MAPPING_VERSION,
    );
  });

  it('keeps an action type no family claims, alongside the version', () => {
    const row = normalizeMetricRow(
      {
        ...ACCOUNT_ROW,
        actions: [{ action_type: 'omni_view_content_2027', value: '9' }],
      },
      context(),
    );

    expect(row?.actions).toEqual({
      mappingVersion: META_ACTION_MAPPING_VERSION,
      counts: { omni_view_content_2027: '9.000000' },
      values: {},
    });
  });

  it('leaves an absent reach null rather than zero', () => {
    const row = normalizeMetricRow(
      { date_start: '2026-07-06', spend: '0.16' },
      context(),
    );

    // Reach is de-duplicated people and never additive. A zero would be summed
    // by anybody who did not know that; a null cannot be.
    expect(row?.reach).toBeNull();
  });

  it('skips a row whose numbers are present and unreadable', () => {
    // Substituting a zero would produce a row indistinguishable from a real day
    // with no delivery — it sums into totals and nothing marks it as invented.
    expect(
      normalizeMetricRow({ ...ACCOUNT_ROW, spend: 'R$ 11,51' }, context()),
    ).toBeNull();

    expect(
      normalizeMetricRow({ ...ACCOUNT_ROW, impressions: '-5' }, context()),
    ).toBeNull();

    expect(
      normalizeMetricRow({ ...ACCOUNT_ROW, reach: 'many' }, context()),
    ).toBeNull();
  });

  it('skips a row with no usable day', () => {
    for (const date of [undefined, '', '2026-07', '2026-07-10T00:00:00Z', 5]) {
      expect(
        normalizeMetricRow({ ...ACCOUNT_ROW, date_start: date }, context()),
      ).toBeNull();
    }
  });

  it('skips anything that is not an object', () => {
    expect(normalizeMetricRow(null, context())).toBeNull();
    expect(normalizeMetricRow('row', context())).toBeNull();
  });
});

describe('normalizeMetricRow — provisional rows', () => {
  it('takes is_partial from the run, not from the date', () => {
    const row = normalizeMetricRow(ACCOUNT_ROW, context({ isPartial: true }));

    expect(row?.isPartial).toBe(true);
    // The same payload, the same date, the opposite flag. Only the coordinator
    // knows whether the day was still running when it was read; inferring it
    // here would be wrong in both directions around the account's midnight.
    expect(normalizeMetricRow(ACCOUNT_ROW, context())?.isPartial).toBe(false);
  });

  it('keeps the mapping version and the action payload on a provisional row', () => {
    const row = normalizeMetricRow(ACCOUNT_ROW, context({ isPartial: true }));

    // Backfill and intraday use the same mapper as every other read. A second
    // shape here would make two rows of one campaign incomparable.
    expect(row?.actions).toMatchObject({
      mappingVersion: META_ACTION_MAPPING_VERSION,
      counts: expect.any(Object) as Record<string, string>,
      values: expect.any(Object) as Record<string, string>,
    });
  });
});
