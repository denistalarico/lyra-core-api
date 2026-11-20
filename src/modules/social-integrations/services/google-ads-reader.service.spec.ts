import type { GoogleAdsCredentialResolver } from '../../social-google/google-ads-credential.resolver';
import type { ResolvedAdCredential } from '../credentials/resolved-ad-credential';
import { GoogleAdsError } from '../sync/google-ads-error';
import { classifySocialAdSyncRetry } from '../sync/social-ad-sync-retry';
import { GoogleAdsReaderService } from './google-ads-reader.service';
import type { SocialAdSyncConfigService } from './social-ad-sync-config.service';

const CREDENTIAL = {
  connectionId: 'c',
  tenantId: 't',
  workspaceId: 'w',
  agencyClientId: null,
  provider: 'google_ads',
  externalAccountId: '1234567890',
  accessToken: 'test-access-token',
} as unknown as ResolvedAdCredential;

const WINDOW = { since: '2026-11-01', until: '2026-11-07', days: 7 };

function build(budget = 100, loginCustomerId: string | null = null) {
  const config = {
    googleAdsDailyOperationBudget: budget,
  } as SocialAdSyncConfigService;
  const resolver = {
    loginCustomerId: jest.fn(async () => loginCustomerId),
  } as unknown as GoogleAdsCredentialResolver;

  return new GoogleAdsReaderService(config, resolver);
}

function respond(status: number, body: unknown, headers: HeadersInit = {}) {
  // A fresh Response per call: the `adset` level reads twice (D-G1).
  return jest
    .spyOn(global, 'fetch')
    .mockImplementation(
      async () => new Response(JSON.stringify(body), { status, headers }),
    );
}

describe('GoogleAdsReaderService', () => {
  afterEach(() => {
    jest.restoreAllMocks();
    delete process.env.GOOGLE_ADS_API_VERSION;
  });

  it('never sends a developer credential header', async () => {
    const fetchSpy = respond(200, [{ results: [] }]);

    await build().readDailyMetrics(CREDENTIAL, 'campaign', WINDOW);

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;

    // Built from parts so the boundary spec's source scan stays meaningful.
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain(
      ['developer', 'token'].join('-'),
    );
  });

  it('GL2: reads lead-form submissions since the given day in one query', async () => {
    const fetchSpy = respond(200, [
      { results: [{ leadFormSubmissionData: { id: 'x' } }] },
    ]);

    const page = await build().readLeadSubmissions(CREDENTIAL, '2026-10-20');

    const { query } = JSON.parse(
      (fetchSpy.mock.calls[0][1] as RequestInit).body as string,
    ) as { query: string };
    expect(query).toBe(
      "SELECT lead_form_submission_data.id, lead_form_submission_data.gclid, lead_form_submission_data.submission_date_time, lead_form_submission_data.lead_form_submission_fields, lead_form_submission_data.custom_lead_form_submission_fields, campaign.id, asset.id FROM lead_form_submission_data WHERE lead_form_submission_data.submission_date_time >= '2026-10-20 00:00:00'",
    );
    expect(page).toMatchObject({
      rows: [{ leadFormSubmissionData: { id: 'x' } }],
      apiCalls: 1,
    });
  });

  it('GL2: refuses a malformed day before any request', async () => {
    const fetchSpy = respond(200, [{ results: [] }]);
    await expect(
      build().readLeadSubmissions(CREDENTIAL, "2026-10-20' OR 1=1"),
    ).rejects.toThrow(GoogleAdsError);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('takes the API version from the environment', async () => {
    process.env.GOOGLE_ADS_API_VERSION = 'v26';
    const fetchSpy = respond(200, [{ results: [] }]);

    await build().readDailyMetrics(CREDENTIAL, 'campaign', WINDOW);

    expect(String(fetchSpy.mock.calls[0][0])).toContain('/v26/customers/');
  });

  it('sends login-customer-id only when the account is reached through a manager', async () => {
    const fetchSpy = respond(200, [{ results: [] }]);

    await build(100, '9998887776').readDailyMetrics(
      CREDENTIAL,
      'campaign',
      WINDOW,
    );

    const headers = (fetchSpy.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;

    expect(headers['login-customer-id']).toBe('9998887776');
  });

  it('reads one wide query for the whole window', async () => {
    const fetchSpy = respond(200, [{ results: [] }]);

    await build().readDailyMetrics(CREDENTIAL, 'adset', WINDOW);

    expect(
      JSON.parse((fetchSpy.mock.calls[0][1] as RequestInit).body as string)
        .query,
    ).toContain("BETWEEN '2026-11-01' AND '2026-11-07'");
  });

  it('D-G1: reads asset groups with the hierarchy', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify([{ results: [] }])),
      );

    const raw = await build().readHierarchy(CREDENTIAL);

    const queries = fetchSpy.mock.calls.map(
      ([, init]) => JSON.parse(String((init as RequestInit).body)).query,
    );
    expect([queries, raw.assetGroups.apiCalls]).toEqual([
      expect.arrayContaining([
        'SELECT asset_group.id, asset_group.name, asset_group.status, campaign.id FROM asset_group',
      ]),
      1,
    ]);
  });

  it('D-G1: reads the adset level as ad groups plus asset groups in one page', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockResolvedValueOnce(
        new Response(JSON.stringify([{ results: [{ adGroup: { id: '1' } }] }])),
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify([{ results: [{ assetGroup: { id: '2' } }] }]),
        ),
      );

    const page = await build().readDailyMetrics(CREDENTIAL, 'adset', WINDOW);

    const froms = fetchSpy.mock.calls.map(
      ([, init]) =>
        String(JSON.parse(String((init as RequestInit).body)).query).match(
          /FROM (\w+)/,
        )?.[1],
    );
    expect([froms, page.rows.length, page.apiCalls]).toEqual([
      ['ad_group', 'asset_group'],
      2,
      2,
    ]);
  });

  it('D-G1: never asks asset_group for a metric v25 does not offer there', async () => {
    const fetchSpy = respond(200, [{ results: [] }]);

    await build().readDailyMetrics(CREDENTIAL, 'adset', WINDOW);

    const assetGroupQuery = String(
      JSON.parse(String((fetchSpy.mock.calls[1][1] as RequestInit).body)).query,
    );
    expect(assetGroupQuery).not.toContain('video_trueview_views');
  });

  it('flattens the batches of searchStream into rows', async () => {
    respond(200, [{ results: [{ a: 1 }] }, { results: [{ a: 2 }] }]);

    const page = await build().readDailyMetrics(CREDENTIAL, 'campaign', WINDOW);

    expect(page.rows).toHaveLength(2);
  });

  it('refuses before the request once the daily budget is spent', async () => {
    const fetchSpy = respond(200, [{ results: [] }]);
    const reader = build(1);

    await reader.readDailyMetrics(CREDENTIAL, 'campaign', WINDOW);

    await expect(
      reader.readDailyMetrics(CREDENTIAL, 'campaign', WINDOW),
    ).rejects.toMatchObject({ code: 'quota_budget_exhausted' });
    expect(fetchSpy).toHaveBeenCalledTimes(1);
  });

  it('asks to come back after the quota reset when the budget is spent', async () => {
    respond(200, [{ results: [] }]);
    const reader = build(1);

    await reader.readDailyMetrics(CREDENTIAL, 'campaign', WINDOW);
    const error = await reader
      .readDailyMetrics(CREDENTIAL, 'campaign', WINDOW)
      .catch((caught: GoogleAdsError) => caught);

    expect((error as GoogleAdsError).retryAfterMs).toBeGreaterThan(0);
  });

  it('classifies an exhausted budget as a rate limit for the queue', () => {
    expect(
      classifySocialAdSyncRetry(
        new GoogleAdsError('rate_limited', 'quota_budget_exhausted', 3600000),
      ).action,
    ).toBe('rate_limit');
  });

  it('classifies 401 as an auth stop', async () => {
    respond(401, {});

    await expect(
      build().readDailyMetrics(CREDENTIAL, 'campaign', WINDOW),
    ).rejects.toMatchObject({
      kind: 'auth',
      code: 'google_ads_reauth_required',
    });
  });

  it('names the project-approval refusal without echoing the body', async () => {
    respond(403, {
      error: {
        message: 'customer 1234567890 secret detail',
        details: [
          {
            errors: [
              {
                errorCode: {
                  authorizationError:
                    'CLOUD_PROJECT_NOT_APPROVED_FOR_PRODUCTION',
                },
              },
            ],
          },
        ],
      },
    });

    const error = await build()
      .readDailyMetrics(CREDENTIAL, 'campaign', WINDOW)
      .catch((caught: GoogleAdsError) => caught);

    expect([(error as GoogleAdsError).code, (error as Error).message]).toEqual([
      'google_ads_project_not_approved',
      'google_ads_project_not_approved',
    ]);
  });

  // Field list reviewed against https://developers.google.com/google-ads/api/fields/v25
  it('only asks for fields that exist in v25', async () => {
    const fetchSpy = jest
      .spyOn(global, 'fetch')
      .mockImplementation(
        async () => new Response(JSON.stringify([{ results: [] }])),
      );
    const reader = build();

    await reader.readHierarchy(CREDENTIAL);
    for (const level of ['account', 'campaign', 'adset', 'ad'] as const) {
      await reader.readDailyMetrics(CREDENTIAL, level, WINDOW);
    }

    const queries = fetchSpy.mock.calls
      .map(([, init]) => JSON.parse(String((init as RequestInit).body)).query)
      .join('\n');

    expect(queries).toContain('campaign.start_date_time');
    expect(queries).toContain('campaign.end_date_time');
    expect(queries).toContain('metrics.video_trueview_views');
    expect(queries).not.toMatch(/campaign\.(start|end)_date\b/);
    expect(queries).not.toContain('metrics.video_views');
  });

  it('counts the request that failed against the quota', async () => {
    respond(400, {});

    await expect(
      build().readDailyMetrics(CREDENTIAL, 'campaign', WINDOW),
    ).rejects.toMatchObject({ code: 'google_ads_bad_request', apiCalls: 1 });
  });

  it('treats 429 as rate limited and honours Retry-After', async () => {
    respond(429, {}, { 'retry-after': '120' });

    await expect(
      build().readDailyMetrics(CREDENTIAL, 'campaign', WINDOW),
    ).rejects.toMatchObject({ kind: 'rate_limited', retryAfterMs: 120000 });
  });

  it('treats 5xx as transient', async () => {
    respond(503, {});

    await expect(
      build().readDailyMetrics(CREDENTIAL, 'campaign', WINDOW),
    ).rejects.toMatchObject({ kind: 'transient' });
  });

  it('stops retrying a permanent bad request', () => {
    expect(
      classifySocialAdSyncRetry(
        new GoogleAdsError('permanent', 'google_ads_bad_request'),
      ).action,
    ).toBe('stop');
  });

  it('refuses a malformed API version instead of building a URL from it', async () => {
    process.env.GOOGLE_ADS_API_VERSION = '../evil';
    respond(200, [{ results: [] }]);

    await expect(
      build().readDailyMetrics(CREDENTIAL, 'campaign', WINDOW),
    ).rejects.toMatchObject({ code: 'google_ads_not_configured' });
  });

  it('never leaves the access token in a thrown error', async () => {
    respond(500, {});

    const error = await build()
      .readDailyMetrics(CREDENTIAL, 'campaign', WINDOW)
      .catch((caught: Error) => caught);

    expect(JSON.stringify(error) + (error as Error).message).not.toContain(
      'test-access-token',
    );
  });
});
