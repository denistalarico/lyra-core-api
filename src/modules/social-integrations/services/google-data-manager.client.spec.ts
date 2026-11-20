import {
  GoogleDataManagerClient,
  GoogleDataManagerError,
} from './google-data-manager.client';

const credential = {
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  companyContextId: null,
  provider: 'google_ads',
  accessToken: 'secret-token',
  externalAccountId: '1234567890',
} as never;

const event = {
  conversionCustomerId: '1234567890',
  conversionActionId: '555',
  gclid: 'test-gclid-001',
  eventAt: new Date('2026-11-20T12:00:00Z'),
  transactionId: '00000000-0000-4000-8000-000000000001:won',
  value: 1500.5,
  currency: 'BRL',
};

function setup(
  response: { status: number; body: unknown },
  login: string | null = '9876543210',
) {
  const resolver = { loginCustomerId: jest.fn().mockResolvedValue(login) };
  const fetchMock = jest.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    json: () => Promise.resolve(response.body),
  });
  global.fetch = fetchMock as never;
  return { client: new GoogleDataManagerClient(resolver as never), fetchMock };
}

const call = (fetchMock: jest.Mock) => {
  const [url, init] = fetchMock.mock.calls[0] as [
    string,
    { headers: Record<string, string>; body: string },
  ];
  return { url, headers: init.headers, body: JSON.parse(init.body) };
};

describe('GoogleDataManagerClient (GA-CONV, D-G6 revised)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('posts one event to events:ingest with the documented shape', async () => {
    const { client, fetchMock } = setup({
      status: 200,
      body: { requestId: 'req-1' },
    });
    const result = await client.ingestClickConversion(credential, event, {
      validateOnly: false,
    });
    const { url, body } = call(fetchMock);
    expect(url).toBe('https://datamanager.googleapis.com/v1/events:ingest');
    expect(body).toEqual({
      destinations: [
        {
          operatingAccount: {
            accountType: 'GOOGLE_ADS',
            accountId: '1234567890',
          },
          loginAccount: { accountType: 'GOOGLE_ADS', accountId: '9876543210' },
          productDestinationId: '555',
        },
      ],
      encoding: 'HEX',
      events: [
        {
          adIdentifiers: { gclid: 'test-gclid-001' },
          eventTimestamp: '2026-11-20T12:00:00.000Z',
          transactionId: '00000000-0000-4000-8000-000000000001:won',
          eventSource: 'WEB',
          conversionValue: 1500.5,
          currency: 'BRL',
        },
      ],
      validateOnly: false,
    });
    expect(result.requestId).toBe('req-1');
  });

  it('sends OAuth only: no developer token, no login-customer-id header', async () => {
    const { client, fetchMock } = setup({ status: 200, body: {} });
    await client.ingestClickConversion(credential, event, {
      validateOnly: true,
    });
    const { headers } = call(fetchMock);
    expect(headers.Authorization).toBe('Bearer secret-token');
    expect(
      Object.keys(headers).filter((key) => /developer|login/i.test(key)),
    ).toEqual([]);
  });

  it('omits the login account and the value when there is none', async () => {
    const { client, fetchMock } = setup({ status: 200, body: {} }, null);
    await client.ingestClickConversion(
      credential,
      { ...event, value: null, currency: null },
      { validateOnly: false },
    );
    const { body } = call(fetchMock);
    expect(body.destinations[0].loginAccount).toBeUndefined();
    expect(body.events[0]).not.toHaveProperty('conversionValue');
  });

  it('maps a missing scope and a disabled API to auth codes', async () => {
    const scope = setup({
      status: 403,
      body: {
        error: { details: [{ reason: 'ACCESS_TOKEN_SCOPE_INSUFFICIENT' }] },
      },
    });
    await expect(
      scope.client.ingestClickConversion(credential, event, {
        validateOnly: false,
      }),
    ).rejects.toMatchObject({
      kind: 'auth',
      code: 'google_data_manager_scope_missing',
    });

    const disabled = setup({
      status: 403,
      body: { error: { details: [{ reason: 'SERVICE_DISABLED' }] } },
    });
    await expect(
      disabled.client.ingestClickConversion(credential, event, {
        validateOnly: false,
      }),
    ).rejects.toMatchObject({ code: 'google_data_manager_api_disabled' });
  });

  it('keeps the field violation enum and nothing else from a 400', async () => {
    const { client } = setup({
      status: 400,
      body: {
        error: {
          message: 'gclid test-gclid-001 is not valid for this account',
          details: [
            { reason: 'INVALID_ARGUMENT' },
            {
              fieldViolations: [
                { reason: 'INVALID_AD_IDENTIFIER_FOR_ACCOUNT' },
              ],
            },
          ],
        },
      },
    });
    const error = (await client
      .ingestClickConversion(credential, event, { validateOnly: false })
      .catch((caught: unknown) => caught)) as GoogleDataManagerError;
    expect(error).toBeInstanceOf(GoogleDataManagerError);
    expect(error.kind).toBe('permanent');
    expect(error.reason).toBe('INVALID_AD_IDENTIFIER_FOR_ACCOUNT');
    expect(JSON.stringify(error)).not.toContain('test-gclid-001');
  });

  it('treats 429, 5xx and network failures as retryable', async () => {
    const limited = setup({ status: 429, body: {} });
    await expect(
      limited.client.ingestClickConversion(credential, event, {
        validateOnly: false,
      }),
    ).rejects.toMatchObject({ kind: 'rate_limited' });
    const down = setup({ status: 503, body: {} });
    await expect(
      down.client.ingestClickConversion(credential, event, {
        validateOnly: false,
      }),
    ).rejects.toMatchObject({ kind: 'transient' });
    global.fetch = jest.fn().mockRejectedValue(new Error('timeout')) as never;
    await expect(
      down.client.ingestClickConversion(credential, event, {
        validateOnly: false,
      }),
    ).rejects.toMatchObject({ kind: 'transient' });
  });

  it('refuses malformed ids before any request', async () => {
    const { client, fetchMock } = setup({ status: 200, body: {} });
    await expect(
      client.ingestClickConversion(
        credential,
        { ...event, conversionActionId: 'customers/1/conversionActions/2' },
        { validateOnly: false },
      ),
    ).rejects.toMatchObject({ kind: 'permanent' });
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
