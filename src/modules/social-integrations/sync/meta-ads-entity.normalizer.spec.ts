import {
  normalizeAccount,
  normalizeAd,
  normalizeAdSet,
  normalizeCampaign,
  parseMetaTime,
  parseMinorUnits,
} from './meta-ads-entity.normalizer';

const ACCOUNT_ID = 'act_415877197389621';
const CAMPAIGN_ID = '23851234567890123';
const ADSET_ID = '23851234567890456';

describe('account normalization', () => {
  const payload = {
    id: ACCOUNT_ID,
    account_id: '415877197389621',
    name: 'Lyra — Institucional',
    currency: 'brl',
    timezone_name: 'America/Sao_Paulo',
    account_status: 1,
    business: { id: '99887766', name: 'Lyra' },
  };

  it('keys the account by its canonical handle', () => {
    const account = normalizeAccount(payload, ACCOUNT_ID);

    // Meta sends both spellings; two spellings must not become two rows.
    expect(account?.externalId).toBe(ACCOUNT_ID);
    expect(
      normalizeAccount({ account_id: '415877197389621' }, ACCOUNT_ID)
        ?.externalId,
    ).toBe(ACCOUNT_ID);
  });

  it('roots the tree, because the table refuses an account with a parent', () => {
    const account = normalizeAccount(payload, ACCOUNT_ID);

    expect(account?.parentExternalId).toBeNull();
    expect(account?.campaignExternalId).toBeNull();
    expect(account?.entityLevel).toBe('account');
  });

  it('keeps the account status as the code Meta actually publishes', () => {
    // 1 is active, 2 disabled, 101 closed. Translating those to words here
    // would be inventing a vocabulary Meta does not document as stable.
    expect(normalizeAccount(payload, ACCOUNT_ID)?.status).toBe('1');
  });

  it('carries only auxiliary facts that have no column', () => {
    const account = normalizeAccount(payload, ACCOUNT_ID);

    expect(account?.currency).toBe('BRL');
    expect(account?.metadata).toEqual({
      timezone: 'America/Sao_Paulo',
      businessId: '99887766',
      businessName: 'Lyra',
    });
  });

  it('falls back to the bound account when the payload names none', () => {
    expect(normalizeAccount({ name: 'x' }, ACCOUNT_ID)?.externalId).toBe(
      ACCOUNT_ID,
    );
  });
});

describe('campaign normalization', () => {
  const context = { accountExternalId: ACCOUNT_ID, currency: 'BRL' };
  const payload = {
    id: CAMPAIGN_ID,
    name: 'Sempre-ativo | Leads',
    status: 'ACTIVE',
    effective_status: 'ACTIVE',
    objective: 'OUTCOME_LEADS',
    daily_budget: '5000',
    budget_remaining: '0',
    start_time: '2026-08-01T00:00:00-0300',
    stop_time: null,
    created_time: '2026-07-30T11:22:33-0300',
    updated_time: '2026-08-20T09:00:00-0300',
  };

  it('parents the campaign to the account it was read from', () => {
    const campaign = normalizeCampaign(payload, context);

    // The campaigns edge returns no account id — the account being synced is
    // known with certainty by the caller, and guessing it from the payload
    // would mean not filling it at all.
    expect(campaign?.parentExternalId).toBe(ACCOUNT_ID);
    // A campaign is its own campaign, so "spend by campaign" reads one column.
    expect(campaign?.campaignExternalId).toBe(CAMPAIGN_ID);
  });

  it('maps the fields the read model has columns for', () => {
    const campaign = normalizeCampaign(payload, context);

    expect(campaign).toMatchObject({
      entityLevel: 'campaign',
      externalId: CAMPAIGN_ID,
      name: 'Sempre-ativo | Leads',
      status: 'ACTIVE',
      effectiveStatus: 'ACTIVE',
      objective: 'OUTCOME_LEADS',
      currency: 'BRL',
    });
    expect(campaign?.startTime?.toISOString()).toBe('2026-08-01T03:00:00.000Z');
    expect(campaign?.providerUpdatedTime?.toISOString()).toBe(
      '2026-08-20T12:00:00.000Z',
    );
  });

  it('drops a row it could never key again', () => {
    expect(normalizeCampaign({ name: 'no id' }, context)).toBeNull();
    expect(normalizeCampaign('not an object', context)).toBeNull();
  });
});

describe('ad set normalization', () => {
  const OBSERVED_AT = new Date('2026-08-28T12:00:00.000Z');
  const context = { currency: 'BRL', observedAt: OBSERVED_AT };

  it('parents the ad set to its campaign and denormalizes it', () => {
    const adSet = normalizeAdSet(
      {
        id: ADSET_ID,
        campaign_id: CAMPAIGN_ID,
        name: 'SP | 25-44',
        optimization_goal: 'LEAD_GENERATION',
        billing_event: 'IMPRESSIONS',
        end_time: '2026-09-01T00:00:00-0300',
      },
      context,
    );

    expect(adSet).toMatchObject({
      entityLevel: 'adset',
      externalId: ADSET_ID,
      parentExternalId: CAMPAIGN_ID,
      campaignExternalId: CAMPAIGN_ID,
      optimizationGoal: 'LEAD_GENERATION',
      billingEvent: 'IMPRESSIONS',
    });
    // Campaigns end at `stop_time`, ad sets at `end_time`: one column, two
    // provider names.
    expect(adSet?.stopTime?.toISOString()).toBe('2026-09-01T03:00:00.000Z');
  });

  it('degrades to a rootless row instead of dropping the object', () => {
    const adSet = normalizeAdSet({ id: ADSET_ID }, context);

    // The ad set exists and will carry spend. A name attached to nothing beats
    // spend attached to nothing, and only accounts are constrained to have no
    // parent.
    expect(adSet?.externalId).toBe(ADSET_ID);
    expect(adSet?.parentExternalId).toBeNull();
  });
});

describe('ad normalization', () => {
  const campaignByAdSetId = new Map([[ADSET_ID, CAMPAIGN_ID]]);
  const context = { currency: 'BRL', campaignByAdSetId };

  it('parents the ad to its ad set', () => {
    const ad = normalizeAd(
      { id: '999', adset_id: ADSET_ID, campaign_id: CAMPAIGN_ID },
      context,
    );

    expect(ad).toMatchObject({
      entityLevel: 'ad',
      externalId: '999',
      parentExternalId: ADSET_ID,
      campaignExternalId: CAMPAIGN_ID,
    });
  });

  it('resolves the campaign from the ad sets already read this run', () => {
    // The alternative is one Graph call per ad against a shared business quota,
    // to learn something the previous level already said.
    const ad = normalizeAd({ id: '999', adset_id: ADSET_ID }, context);

    expect(ad?.campaignExternalId).toBe(CAMPAIGN_ID);
  });

  it('leaves the campaign null when nothing in the run can supply it', () => {
    const ad = normalizeAd({ id: '999', adset_id: 'unknown-adset' }, context);

    expect(ad?.parentExternalId).toBe('unknown-adset');
    expect(ad?.campaignExternalId).toBeNull();
  });
});

describe('budgets', () => {
  it('stores minor units exactly as Meta reports them', () => {
    // "1000" on a BRL account is R$ 10,00. Dividing here would be a rounding
    // error that then propagates into every derived KPI.
    expect(parseMinorUnits('1000')).toBe('1000');
    expect(parseMinorUnits(2500)).toBe('2500');
    expect(parseMinorUnits('0010')).toBe('10');
  });

  it('keeps a real zero, which is a budget and not an absence', () => {
    expect(parseMinorUnits('0')).toBe('0');
  });

  it('answers null for an absent budget rather than zero', () => {
    // Campaign-budget optimization leaves ad set budgets unset; writing 0 there
    // would claim the ad set may not spend.
    for (const absent of [undefined, null, '', '  ']) {
      expect(parseMinorUnits(absent)).toBeNull();
    }
  });

  it('refuses a value it cannot vouch for', () => {
    // A parsed-wrong budget either violates the non-negative check and aborts
    // the batch, or stores a number nobody can explain.
    for (const invalid of ['12.50', '-100', 'R$10', {}, Number.NaN, 1.5]) {
      expect(parseMinorUnits(invalid)).toBeNull();
    }
  });

  it('survives a budget larger than a JS integer', () => {
    expect(parseMinorUnits('90071992547409910')).toBe('90071992547409910');
  });

  it('carries budgets and currency together down the tree', () => {
    const adSet = normalizeAdSet(
      { id: ADSET_ID, lifetime_budget: '250000', budget_remaining: '125000' },
      { currency: 'BRL', observedAt: new Date() },
    );

    // Meta reports currency only on the account node; a minor-unit amount
    // without it cannot be rendered.
    expect(adSet).toMatchObject({
      lifetimeBudgetMinor: '250000',
      budgetRemainingMinor: '125000',
      dailyBudgetMinor: null,
      currency: 'BRL',
    });
  });
});

describe('timestamps', () => {
  it('reads Meta compact offsets as a standard parse', () => {
    // `-0300` is legal ISO 8601 but not what `Date` is specified to accept;
    // engines take it by extension, and one that stopped would silently null
    // every date in the mirror.
    expect(parseMetaTime('2026-08-20T13:45:00-0300')?.toISOString()).toBe(
      '2026-08-20T16:45:00.000Z',
    );
    expect(parseMetaTime('2026-08-20T16:45:00Z')?.toISOString()).toBe(
      '2026-08-20T16:45:00.000Z',
    );
  });

  it('answers null for anything it cannot parse', () => {
    for (const invalid of [undefined, null, '', 'ontem', 12345]) {
      expect(parseMetaTime(invalid)).toBeNull();
    }
  });
});
