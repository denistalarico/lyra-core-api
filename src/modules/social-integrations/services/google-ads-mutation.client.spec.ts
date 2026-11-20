import {
  GoogleAdsMutationClient,
  GoogleAdsMutationError,
} from './google-ads-mutation.client';

const credential = {
  connectionId: 'c1',
  tenantId: 't1',
  workspaceId: 'w1',
  agencyClientId: null,
  companyContextId: null,
  accessToken: 'secret-token',
  externalAccountId: '1234567890',
} as never;

function setup(response: { status: number; body: unknown }) {
  const resolver = {
    loginCustomerId: jest.fn().mockResolvedValue('9876543210'),
  };
  const fetchMock = jest.fn().mockResolvedValue({
    ok: response.status >= 200 && response.status < 300,
    status: response.status,
    headers: new Headers(),
    json: () => Promise.resolve(response.body),
  });
  global.fetch = fetchMock as never;
  return {
    client: new GoogleAdsMutationClient(resolver as never),
    fetchMock,
  };
}

describe('GoogleAdsMutationClient (GA-WRITE)', () => {
  const realFetch = global.fetch;
  afterEach(() => {
    global.fetch = realFetch;
  });

  it('sends validateOnly with OAuth and MCC headers and no developer header', async () => {
    const { client, fetchMock } = setup({
      status: 200,
      body: { results: [{ resourceName: 'customers/1234567890/campaigns/1' }] },
    });
    const result = await client.mutate(
      credential,
      'campaigns',
      [
        {
          update: { resourceName: 'x', status: 'PAUSED' },
          updateMask: 'status',
        },
      ],
      { validateOnly: true },
    );

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toMatch(
      /^https:\/\/googleads\.googleapis\.com\/v\d+\/customers\/1234567890\/campaigns:mutate$/,
    );
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer secret-token',
      'login-customer-id': '9876543210',
    });
    expect(
      Object.keys(init.headers).some((key) => /developer/i.test(key)),
    ).toBe(false);
    expect(JSON.parse(init.body)).toMatchObject({
      validateOnly: true,
      partialFailure: false,
    });
    expect(result.resourceNames).toEqual(['customers/1234567890/campaigns/1']);
  });

  it('refuses a resource outside the closed list before any request', async () => {
    const { client, fetchMock } = setup({ status: 200, body: {} });
    await expect(
      client.mutate(credential, 'customers' as never, [], {
        validateOnly: true,
      }),
    ).rejects.toBeInstanceOf(GoogleAdsMutationError);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('keeps only the error enum from a refusal, never the body', async () => {
    const { client } = setup({
      status: 400,
      body: {
        error: {
          message: 'Campaign "Cliente Fictício" budget too low',
          details: [
            {
              errors: [
                { errorCode: { campaignBudgetError: 'AMOUNT_TOO_SMALL' } },
              ],
            },
          ],
        },
      },
    });
    const error = await client
      .mutate(credential, 'campaignBudgets', [], { validateOnly: true })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(GoogleAdsMutationError);
    expect(error).toMatchObject({
      kind: 'permanent',
      code: 'google_ads_bad_request',
      reason: 'AMOUNT_TOO_SMALL',
    });
    expect(String((error as Error).message)).not.toContain('Fictício');
  });

  it('classifies a project that is not approved as auth', async () => {
    const { client } = setup({
      status: 403,
      body: {
        error: {
          details: [
            {
              errors: [
                { errorCode: { authorizationError: 'ACTION_NOT_PERMITTED' } },
              ],
            },
          ],
        },
      },
    });
    await expect(
      client.mutate(credential, 'campaigns', [], { validateOnly: false }),
    ).rejects.toMatchObject({
      kind: 'auth',
      code: 'google_ads_project_not_approved',
    });
  });

  it('reads with searchStream and flattens the batches', async () => {
    const { client, fetchMock } = setup({
      status: 200,
      body: [
        { results: [{ campaign: { id: '1' } }] },
        { results: [{ campaign: { id: '2' } }] },
      ],
    });
    const rows = await client.search(
      credential,
      'SELECT campaign.id FROM campaign',
    );
    expect(fetchMock.mock.calls[0][0]).toMatch(/googleAds:searchStream$/);
    expect(rows).toHaveLength(2);
  });
});
