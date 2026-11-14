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
  return jest
    .spyOn(global, 'fetch')
    .mockResolvedValue(new Response(JSON.stringify(body), { status, headers }));
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
