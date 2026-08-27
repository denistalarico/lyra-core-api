import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { createResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { MetaAdsInsightsReaderService } from './meta-ads-insights-reader.service';
import type { MetaAdsGraphService } from './meta-ads-graph.service';

const ACCOUNT_ID = 'act_415877197389621';
const WINDOW = { since: '2026-07-06', until: '2026-07-22', days: 17 };
const SYNCED_AT = new Date('2026-08-26T12:00:00.000Z');

function credential(
  overrides: Partial<{
    accessToken: string;
    authorizationMethod: 'business_login' | 'internal_system_user';
  }> = {},
): ResolvedAdCredential {
  return createResolvedAdCredential({
    connectionId: 'connection-id',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    provider: 'meta_ads',
    authorizationMethod: overrides.authorizationMethod ?? 'business_login',
    externalAccountId: ACCOUNT_ID,
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    credentialVersion: 1,
    tokenExpiresAt: null,
    accessToken: overrides.accessToken ?? 'token-abc',
  });
}

function createReader(
  page: { rows: unknown[]; truncated?: boolean } = { rows: [] },
) {
  const requests: Record<string, unknown>[] = [];

  const graph = {
    readEdge: jest.fn((input: Record<string, unknown>) => {
      requests.push(input);

      return Promise.resolve({
        rows: page.rows,
        usage: {},
        truncated: page.truncated ?? false,
      });
    }),
  };

  return {
    reader: new MetaAdsInsightsReaderService(
      graph as unknown as MetaAdsGraphService,
    ),
    graph,
    requests,
  };
}

const ROW = {
  date_start: '2026-07-10',
  date_stop: '2026-07-10',
  spend: '11.51',
  impressions: '412',
  reach: '380',
  clicks: '5',
  inline_link_clicks: '3',
  actions: [{ action_type: 'lead', value: '2' }],
};

describe('MetaAdsInsightsReaderService — the request', () => {
  it('asks for daily rows under the account attribution setting', async () => {
    const harness = createReader();

    await harness.reader.read({
      credential: credential(),
      level: 'account',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    expect(harness.requests[0]).toMatchObject({
      path: `${ACCOUNT_ID}/insights`,
      params: {
        level: 'account',
        // Without this Meta answers one aggregated row for the range, and the
        // daily grain this table is built on would silently become a total.
        time_increment: '1',
        time_range: '{"since":"2026-07-06","until":"2026-07-22"}',
        use_account_attribution_setting: 'true',
      },
    });
  });

  it('names the level explicitly at account level too', async () => {
    const harness = createReader();

    await harness.reader.read({
      credential: credential(),
      level: 'account',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    // Relying on the edge's default would make the account read depend on a
    // value Meta can change without us noticing.
    expect((harness.requests[0].params as Record<string, string>).level).toBe(
      'account',
    );
  });

  it('asks for the campaign id only at campaign level', async () => {
    const harness = createReader();
    const resolved = credential();

    await harness.reader.read({
      credential: resolved,
      level: 'account',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });
    await harness.reader.read({
      credential: resolved,
      level: 'campaign',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    expect(String(harness.requests[0].fields)).not.toContain('campaign_id');
    expect(String(harness.requests[1].fields)).toContain('campaign_id');
  });

  it('asks for no ratio and no campaign name', async () => {
    const harness = createReader();

    await harness.reader.read({
      credential: credential(),
      level: 'campaign',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    const fields = String(harness.requests[0].fields);

    // Every ratio is a quotient of columns already requested, and a stored
    // quotient is wrong the moment two rows are summed.
    for (const forbidden of [
      'ctr',
      'cpc',
      'cpm',
      'frequency',
      'cost_per_action_type',
      // Names belong to the hierarchy mirror; storing one on a fact would make
      // last quarter's report show today's name.
      'campaign_name',
    ]) {
      expect(fields).not.toContain(forbidden);
    }
  });

  it('asks for no extra video field, since video_view rides inside actions', async () => {
    const harness = createReader();

    await harness.reader.read({
      credential: credential(),
      level: 'account',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    expect(String(harness.requests[0].fields)).not.toContain('video_');
  });

  it('pages through the shared walker rather than a loop of its own', async () => {
    const harness = createReader();

    await harness.reader.read({
      credential: credential(),
      level: 'account',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    // Every guarantee of the S2.1 walker — our token on every page, a `next`
    // bound to the same edge, a repeated cursor ending the walk — is a property
    // of that loop and of nothing a second implementation would have.
    expect(harness.graph.readEdge).toHaveBeenCalledTimes(1);
    expect(harness.requests[0].maxPages).toBeGreaterThan(1);
    expect(harness.requests[0].limit).toBeGreaterThan(1);
  });
});

describe('MetaAdsInsightsReaderService — the answer', () => {
  it('normalizes every readable row and counts the rest', async () => {
    const harness = createReader({
      rows: [
        ROW,
        { ...ROW, date_start: 'yesterday' },
        { ...ROW, spend: 'free' },
      ],
    });

    const page = await harness.reader.read({
      credential: credential(),
      level: 'account',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    expect(page.rows).toHaveLength(1);
    expect(page.skipped).toBe(2);
  });

  it('stamps every row with the connection scope and timezone', async () => {
    const harness = createReader({ rows: [ROW] });

    const page = await harness.reader.read({
      credential: credential(),
      level: 'account',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    expect(page.rows[0]).toMatchObject({
      tenantId: 'tenant-a',
      workspaceId: 'workspace-a',
      agencyClientId: null,
      connectionId: 'connection-id',
      accountTimezone: 'America/Sao_Paulo',
      currency: 'BRL',
      source: 'paid',
      attributionSetting: 'account_default',
      isPartial: false,
      syncedAt: SYNCED_AT,
    });
  });

  it('carries truncation through instead of reporting a prefix as the answer', async () => {
    const harness = createReader({ rows: [ROW], truncated: true });

    const page = await harness.reader.read({
      credential: credential(),
      level: 'campaign',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    expect(page.truncated).toBe(true);
  });

  it('reads both authorization methods through one identical pipeline', async () => {
    const business = createReader({ rows: [ROW] });
    const internal = createReader({ rows: [ROW] });

    const first = await business.reader.read({
      credential: credential({ authorizationMethod: 'business_login' }),
      level: 'account',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });
    const second = await internal.reader.read({
      credential: credential({
        authorizationMethod: 'internal_system_user',
        accessToken: 'system-user-token',
      }),
      level: 'account',
      window: WINDOW,
      isPartial: false,
      syncedAt: SYNCED_AT,
    });

    // The reader cannot tell them apart, which is the whole point of the
    // credential boundary: a second path would drift from the first.
    expect(first).toEqual(second);
    expect(business.requests[0].params).toEqual(internal.requests[0].params);
    expect(business.requests[0].fields).toBe(internal.requests[0].fields);
  });
});
