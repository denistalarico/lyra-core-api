import { Ga4DataClient, Ga4DataError } from './ga4-data.client';

const request = {
  propertyId: '123456',
  startDate: '2026-11-10',
  endDate: '2026-11-12',
  dimensions: ['date'],
  metrics: ['sessions'],
};

function respond(status: number, body: unknown = {}) {
  return Promise.resolve({
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
  } as Response);
}

describe('Ga4DataClient', () => {
  const client = new Ga4DataClient();
  let fetchMock: jest.SpyInstance;

  beforeEach(() => {
    fetchMock = jest.spyOn(globalThis, 'fetch');
  });

  afterEach(() => {
    fetchMock.mockRestore();
  });

  const row = (date: string, sessions: string) => ({
    dimensionValues: [{ value: date }],
    metricValues: [{ value: sessions }],
  });

  it('parses rows into numbers', async () => {
    fetchMock.mockReturnValueOnce(
      respond(200, { rows: [row('20261110', '12')], rowCount: 1 }),
    );

    const result = await client.runReport('tok', request);

    expect(result.rows).toEqual([{ dimensions: ['20261110'], metrics: [12] }]);
  });

  it('counts one API call per page', async () => {
    fetchMock
      .mockReturnValueOnce(
        respond(200, { rows: [row('20261110', '1')], rowCount: 2 }),
      )
      .mockReturnValueOnce(
        respond(200, { rows: [row('20261111', '2')], rowCount: 2 }),
      );

    const result = await client.runReport('tok', request);

    expect(result.apiCalls).toBe(2);
  });

  it('flags a report whose long tail Google folded away', async () => {
    fetchMock.mockReturnValueOnce(
      respond(200, {
        rows: [row('20261110', '1')],
        rowCount: 1,
        metadata: { dataLossFromOtherRow: true },
      }),
    );

    expect((await client.runReport('tok', request)).truncated).toBe(true);
  });

  it('sends the bearer token and no developer credential', async () => {
    fetchMock.mockReturnValueOnce(respond(200, { rows: [], rowCount: 0 }));

    await client.runReport('tok-abc', request);

    const headers = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(Object.keys(headers).map((key) => key.toLowerCase())).not.toContain(
      'developer-token',
    );
  });

  it('uses the bearer token for authorization', async () => {
    fetchMock.mockReturnValueOnce(respond(200, { rows: [], rowCount: 0 }));

    await client.runReport('tok-abc', request);

    const headers = (fetchMock.mock.calls[0][1] as RequestInit)
      .headers as Record<string, string>;
    expect(headers.Authorization).toBe('Bearer tok-abc');
  });

  it.each([
    [401, 'reauth_required'],
    [403, 'permission_denied'],
    [429, 'rate_limited'],
    [503, 'transient'],
    [400, 'bad_request'],
  ])('maps HTTP %i to %s', async (status, code) => {
    fetchMock.mockReturnValueOnce(
      respond(status, { error: { message: 'secret-body' } }),
    );

    await expect(client.runReport('tok', request)).rejects.toMatchObject({
      code,
    });
  });

  it('never puts the provider body in the error message', async () => {
    fetchMock.mockReturnValueOnce(
      respond(403, { error: { message: 'properties/999' } }),
    );

    await expect(client.runReport('tok', request)).rejects.toThrow(
      /^permission_denied$/,
    );
  });

  it('turns a network failure into a transient error', async () => {
    fetchMock.mockReturnValueOnce(Promise.reject(new Error('socket hang up')));

    await expect(client.runReport('tok', request)).rejects.toBeInstanceOf(
      Ga4DataError,
    );
  });

  it('rejects a row whose width does not match the request', async () => {
    fetchMock.mockReturnValueOnce(
      respond(200, {
        rows: [{ dimensionValues: [], metricValues: [{ value: '1' }] }],
        rowCount: 1,
      }),
    );

    await expect(client.runReport('tok', request)).rejects.toMatchObject({
      code: 'invalid_response',
    });
  });
});
