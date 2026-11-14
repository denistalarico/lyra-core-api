import { GoogleApiClient, GoogleApiError } from './google-api.client';

const json = (status: number, body: unknown) =>
  Promise.resolve(new Response(JSON.stringify(body), { status }));

describe('GoogleApiClient', () => {
  const client = new GoogleApiClient();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    delete process.env.GOOGLE_ADS_API_VERSION;
    delete process.env.SOCIAL_GOOGLE_ADS_LOGIN_CUSTOMER_ID;
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });
  afterEach(() => fetchMock.mockRestore());

  const adsFixture = (url: string) => {
    if (url.endsWith('listAccessibleCustomers')) {
      return json(200, { resourceNames: ['customers/1111111111'] });
    }
    return json(200, {
      results: [
        {
          customer: {
            descriptiveName: 'Loja',
            currencyCode: 'BRL',
            timeZone: 'America/Sao_Paulo',
            manager: false,
            status: 'ENABLED',
          },
        },
      ],
    });
  };

  it('uses the configured API version in the URL', async () => {
    process.env.GOOGLE_ADS_API_VERSION = 'v26';
    fetchMock.mockImplementation((url: string) => adsFixture(url));
    await client.listAdsCustomers('tok');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v26/');
  });

  it('defaults the API version to v25', async () => {
    fetchMock.mockImplementation((url: string) => adsFixture(url));
    await client.listAdsCustomers('tok');
    expect(String(fetchMock.mock.calls[0][0])).toContain('/v25/');
  });

  it('never sends a developer-token header', async () => {
    fetchMock.mockImplementation((url: string) => adsFixture(url));
    await client.listAdsCustomers('tok');
    const sent = fetchMock.mock.calls.map((call) =>
      JSON.stringify(call[1]?.headers).toLowerCase(),
    );
    expect(sent.some((headers) => headers.includes('developer-token'))).toBe(
      false,
    );
  });

  it('maps a customer with currency and timezone', async () => {
    fetchMock.mockImplementation((url: string) => adsFixture(url));
    const [customer] = await client.listAdsCustomers('tok');
    expect(customer).toMatchObject({
      customerId: '1111111111',
      currency: 'BRL',
      timezone: 'America/Sao_Paulo',
      isManager: false,
      accessVia: 'direct',
    });
  });

  it('expands manager accounts into children reached via the manager', async () => {
    fetchMock.mockImplementation((url: string) => {
      if (url.endsWith('listAccessibleCustomers')) {
        return json(200, { resourceNames: ['customers/2222222222'] });
      }
      if (url.includes('customers/2222222222')) {
        const isClients = fetchMock.mock.calls.length > 2;
        return json(
          200,
          isClients
            ? {
                results: [
                  {
                    customerClient: {
                      id: '3333333333',
                      descriptiveName: 'Filha',
                      currencyCode: 'USD',
                      timeZone: 'UTC',
                      manager: false,
                      status: 'ENABLED',
                    },
                  },
                ],
              }
            : { results: [{ customer: { manager: true, status: 'ENABLED' } }] },
        );
      }
      return json(404, {});
    });
    const all = await client.listAdsCustomers('tok');
    expect(all.find((c) => c.customerId === '3333333333')?.accessVia).toBe(
      '2222222222',
    );
  });

  it('drops canceled accounts', async () => {
    fetchMock.mockImplementation((url: string) =>
      url.endsWith('listAccessibleCustomers')
        ? json(200, { resourceNames: ['customers/1111111111'] })
        : json(200, { results: [{ customer: { status: 'CANCELED' } }] }),
    );
    expect(await client.listAdsCustomers('tok')).toEqual([]);
  });

  it('fails explicitly on a malformed API version', async () => {
    process.env.GOOGLE_ADS_API_VERSION = 'latest';
    await expect(client.listAdsCustomers('tok')).rejects.toMatchObject({
      code: 'google_ads_not_configured',
    });
  });

  it.each([
    [401, 'reauth_required'],
    [403, 'permission_denied'],
    [429, 'transient'],
    [503, 'transient'],
    [400, 'bad_request'],
  ])('maps HTTP %i to %s without the provider body', async (status, code) => {
    fetchMock.mockImplementation(() =>
      json(status, { secret: 'SHOULD-NOT-LEAK' }),
    );
    const error = await client.listGa4PropertySummaries('tok').catch((e) => e);
    expect(error).toBeInstanceOf(GoogleApiError);
    expect(error.code).toBe(code);
    expect(JSON.stringify(error)).not.toContain('SHOULD-NOT-LEAK');
  });

  it('maps GA4 account summaries to property candidates', async () => {
    fetchMock.mockImplementation(() =>
      json(200, {
        accountSummaries: [
          {
            account: 'accounts/10',
            displayName: 'Conta',
            propertySummaries: [
              { property: 'properties/99', displayName: 'Site' },
            ],
          },
        ],
      }),
    );
    expect(await client.listGa4PropertySummaries('tok')).toEqual([
      {
        propertyId: '99',
        displayName: 'Site',
        accountId: '10',
        accountName: 'Conta',
      },
    ]);
  });
});
