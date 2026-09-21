import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { createResolvedAdCredential } from '../credentials/resolved-ad-credential';
import type { MetaAdsGraphService } from './meta-ads-graph.service';
import { MetaAdsReachReaderService } from './meta-ads-reach-reader.service';

const ACCOUNT_ID = 'act_415877197389621';
const WINDOW = { since: '2026-08-01', until: '2026-08-31' };

function credential(): ResolvedAdCredential {
  return createResolvedAdCredential({
    connectionId: 'connection-id',
    tenantId: 'tenant-a',
    workspaceId: 'workspace-a',
    agencyClientId: null,
    provider: 'meta_ads',
    authorizationMethod: 'business_login',
    externalAccountId: ACCOUNT_ID,
    currency: 'BRL',
    timezone: 'America/Sao_Paulo',
    credentialVersion: 1,
    tokenExpiresAt: null,
    accessToken: 'token-abc',
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
        apiCalls: 1,
      });
    }),
  };

  return {
    reader: new MetaAdsReachReaderService(
      graph as unknown as MetaAdsGraphService,
    ),
    graph,
    requests,
  };
}

describe('MetaAdsReachReaderService — the request', () => {
  it('asks for the range without time_increment', async () => {
    const harness = createReader({ rows: [{ reach: '9140' }] });

    await harness.reader.measure({ credential: credential(), window: WINDOW });

    const params = harness.requests[0].params as Record<string, string>;

    /**
     * The single most important assertion in this slice.
     *
     * With `time_increment=1` Meta returns one row per day, each de-duplicated
     * over that day alone, and no local arithmetic recovers the range's reach —
     * the overlap between days never leaves Meta. Omitting it is what makes the
     * response a genuine period measurement. A refactor that "unified" this with
     * the daily reader by passing a shared parameter map would reintroduce the
     * sum this whole table exists to avoid.
     */
    expect(params).not.toHaveProperty('time_increment');

    expect(params.time_range).toBe(
      JSON.stringify({ since: '2026-08-01', until: '2026-08-31' }),
    );
    expect(params.level).toBe('account');
    // The figure has to be the one the account owner sees in Ads Manager, or
    // the dashboard loses the only comparison a client actually makes.
    expect(params.use_account_attribution_setting).toBe('true');
  });

  it('asks for reach and nothing else', async () => {
    const harness = createReader({ rows: [{ reach: '9140' }] });

    await harness.reader.measure({ credential: credential(), window: WINDOW });

    // Every other metric is already stored at a grain that sums correctly, so
    // asking for it here would pay CPU quota to learn something known.
    expect(harness.requests[0].fields).toBe('reach');
    expect(harness.requests[0].path).toBe(`${ACCOUNT_ID}/insights`);
  });

  it('expects exactly one row', async () => {
    const harness = createReader({ rows: [{ reach: '9140' }] });

    await harness.reader.measure({ credential: credential(), window: WINDOW });

    expect(harness.requests[0].limit).toBe(1);
    expect(harness.requests[0].maxPages).toBe(1);
  });
});

describe('MetaAdsReachReaderService — the answer', () => {
  it('reads the reach of the single row', async () => {
    const harness = createReader({ rows: [{ reach: '9140' }] });

    const measurement = await harness.reader.measure({
      credential: credential(),
      window: WINDOW,
    });

    expect(measurement).toEqual({
      reach: '9140',
      apiCalls: 1,
      truncated: false,
    });
  });

  it('answers null rather than zero when Meta reported no reach', async () => {
    // Three shapes of "not reported", and none of them is a zero-reach account.
    for (const rows of [[], [{}], [{ reach: null }], [{ reach: 'n/a' }]]) {
      const harness = createReader({ rows });

      const measurement = await harness.reader.measure({
        credential: credential(),
        window: WINDOW,
      });

      expect(measurement.reach).toBeNull();
    }
  });

  it('reads a genuine zero as a zero', async () => {
    const harness = createReader({ rows: [{ reach: '0' }] });

    const measurement = await harness.reader.measure({
      credential: credential(),
      window: WINDOW,
    });

    // The distinction the nullable column exists for: an account that reached
    // nobody said so, and that is a measurement rather than a missing one.
    expect(measurement.reach).toBe('0');
  });

  it('refuses a fractional reach rather than rounding it', async () => {
    const harness = createReader({ rows: [{ reach: '91.4' }] });

    const measurement = await harness.reader.measure({
      credential: credential(),
      window: WINDOW,
    });

    // People are whole. A fractional value means the field being read is not the
    // field expected, and rounding it would store a plausible wrong number.
    expect(measurement.reach).toBeNull();
  });

  it('reports a truncated page rather than taking the first row', async () => {
    const harness = createReader({
      rows: [{ reach: '9140' }, { reach: '11' }],
      truncated: true,
    });

    const measurement = await harness.reader.measure({
      credential: credential(),
      window: WINDOW,
    });

    // The caller refuses on this. A period read has exactly one row, so a second
    // page means Meta answered a different question than the one asked.
    expect(measurement.truncated).toBe(true);
  });

  it('never carries the token into anything a caller can read', async () => {
    const harness = createReader({ rows: [{ reach: '9140' }] });

    const measurement = await harness.reader.measure({
      credential: credential(),
      window: WINDOW,
    });

    expect(JSON.stringify(measurement)).not.toContain('token-abc');
  });
});
