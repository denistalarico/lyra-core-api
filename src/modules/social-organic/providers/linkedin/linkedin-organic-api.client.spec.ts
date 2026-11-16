import { LinkedInCallBudget } from './linkedin-call-budget';
import {
  LinkedInOrganicApiClient,
  LinkedInOrganicApiError,
  linkedInFailure,
} from './linkedin-organic-api.client';
import { toLinkedInLittleText } from './linkedin-commentary';

const login = { clientId: 'cid', clientSecret: 'csec' };
const UPLOAD = 'https://www.linkedin.com/dms-uploads/x/uploadedVideo?sau=1';

function json(body: unknown, init: ResponseInit = {}) {
  return new Response(JSON.stringify(body), { status: 200, ...init });
}

describe('LinkedInOrganicApiClient', () => {
  const realFetch = global.fetch;
  const env = { ...process.env };
  beforeEach(() => {
    process.env.LINKEDIN_API_VERSION = '202610';
    delete process.env.SOCIAL_LINKEDIN_CMA_TIER;
  });
  afterEach(() => {
    global.fetch = realFetch;
    process.env = { ...env };
  });

  it('sends the versioned headers on every REST call', async () => {
    const fetchMock = jest
      .fn()
      .mockResolvedValue(json({ firstDegreeSize: 42 }));
    global.fetch = fetchMock as never;
    const client = new LinkedInOrganicApiClient(new LinkedInCallBudget());
    await expect(client.followerCount('tok', '123')).resolves.toBe(42);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      'https://api.linkedin.com/rest/networkSizes/urn%3Ali%3Aorganization%3A123?edgeType=COMPANY_FOLLOWED_BY_MEMBER',
    );
    expect(init.headers).toMatchObject({
      Authorization: 'Bearer tok',
      'Linkedin-Version': '202610',
      'X-Restli-Protocol-Version': '2.0.0',
    });
  });

  it('refuses gracefully once the Development budget is spent', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValue(json({ firstDegreeSize: 1 })) as never;
    const client = new LinkedInOrganicApiClient(new LinkedInCallBudget(1));
    await client.followerCount('t', '1');
    const error = await client.followerCount('t', '1').catch((e: unknown) => e);
    expect(error).toMatchObject({
      status: 429,
      code: 'daily_budget_exhausted',
    });
    expect(linkedInFailure(error).reason).toBe('rate_limited');
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('does not count calls on the standard tier', () => {
    process.env.SOCIAL_LINKEDIN_CMA_TIER = 'standard';
    const budget = new LinkedInCallBudget(1);
    expect([budget.tryConsume(), budget.tryConsume()]).toEqual([true, true]);
  });

  it('builds the daily statistics query in Rest.li 2.0 syntax', async () => {
    const fetchMock = jest.fn().mockResolvedValue(
      json({
        elements: [
          {
            timeRange: {
              start: Date.UTC(2026, 10, 1),
              end: Date.UTC(2026, 10, 2),
            },
            totalShareStatistics: {
              impressionCount: 10,
              uniqueImpressionsCounts: 7,
              likeCount: -1,
            },
          },
        ],
      }),
    );
    global.fetch = fetchMock as never;
    const rows = await new LinkedInOrganicApiClient(
      new LinkedInCallBudget(),
    ).dailyShareStatistics('t', '9', {
      fromDay: '2026-11-01',
      toDay: '2026-11-02',
    });
    expect(fetchMock.mock.calls[0][0]).toContain(
      `timeIntervals=(timeRange:(start:${Date.UTC(2026, 10, 1)},end:${Date.UTC(2026, 10, 3)}),timeGranularityType:DAY)`,
    );
    expect(rows).toEqual([
      {
        day: '2026-11-01',
        stats: expect.objectContaining({
          impressions: 10,
          uniqueImpressions: 7,
          likes: -1,
        }),
      },
    ]);
  });

  it('reads administered pages from both ACL field spellings', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      json({
        elements: [
          {
            organization: 'urn:li:organization:1',
            state: 'APPROVED',
            role: 'ADMINISTRATOR',
          },
          {
            organizationTarget: 'urn:li:organization:2',
            state: 'APPROVED',
            role: 'ADMINISTRATOR',
          },
          {
            organization: 'urn:li:organization:3',
            state: 'REQUESTED',
            role: 'ADMINISTRATOR',
          },
        ],
      }),
    ) as never;
    await expect(
      new LinkedInOrganicApiClient(
        new LinkedInCallBudget(),
      ).administeredOrganizationIds('t'),
    ).resolves.toEqual(['1', '2']);
  });

  it('takes the post URN from x-restli-id', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      new Response(null, {
        status: 201,
        headers: { 'x-restli-id': 'urn:li:share:77' },
      }),
    ) as never;
    await expect(
      new LinkedInOrganicApiClient(new LinkedInCallBudget()).createPost(
        't',
        {},
      ),
    ).resolves.toBe('urn:li:share:77');
  });

  it('uploads video parts in order without the OAuth token and returns ETags', async () => {
    const data = new Uint8Array(10).fill(1);
    const put = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { etag: 'e1' } }),
      )
      .mockResolvedValueOnce(
        new Response(null, { status: 200, headers: { etag: 'e2' } }),
      );
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        new Response(data, { headers: { 'content-length': '10' } }),
      )
      .mockImplementation(put) as never;
    const etags = await new LinkedInOrganicApiClient(
      new LinkedInCallBudget(),
    ).uploadVideoParts({
      sourceUrl: 'https://signed/x',
      totalBytes: 10,
      instructions: [
        { uploadUrl: UPLOAD, firstByte: 0, lastByte: 5 },
        { uploadUrl: UPLOAD, firstByte: 6, lastByte: 9 },
      ],
    });
    expect(etags).toEqual(['e1', 'e2']);
    expect(put.mock.calls[0][1].headers).toEqual({
      'Content-Type': 'application/octet-stream',
    });
    expect((put.mock.calls[1][1].body as Uint8Array).byteLength).toBe(4);
  });

  it('refuses an upload session off LinkedIn or with a gap', async () => {
    global.fetch = jest.fn().mockResolvedValue(
      json({
        value: {
          video: 'urn:li:video:v',
          uploadToken: '',
          uploadInstructions: [
            { uploadUrl: 'https://evil.example/x', firstByte: 0, lastByte: 9 },
          ],
        },
      }),
    ) as never;
    await expect(
      new LinkedInOrganicApiClient(
        new LinkedInCallBudget(),
      ).initializeVideoUpload('t', {
        ownerUrn: 'urn:li:organization:1',
        fileSizeBytes: 10,
      }),
    ).rejects.toMatchObject({ code: 'linkedin_upload_session_invalid' });
  });

  it('tells a revoked refresh token apart from a malformed request', async () => {
    global.fetch = jest
      .fn()
      .mockResolvedValueOnce(
        json(
          {
            error: 'invalid_request',
            error_description:
              'The provided authorization grant or refresh token is invalid, expired or revoked',
          },
          { status: 400 },
        ),
      )
      .mockResolvedValueOnce(
        json(
          {
            error: 'invalid_request',
            error_description: 'A required parameter "client_id" is missing',
          },
          { status: 400 },
        ),
      ) as never;
    const client = new LinkedInOrganicApiClient(new LinkedInCallBudget());
    await expect(
      client.refresh({ loginConfig: login, refreshToken: 'r' }),
    ).rejects.toMatchObject({
      code: 'grant_revoked',
    });
    await expect(
      client.refresh({ loginConfig: login, refreshToken: 'r' }),
    ).rejects.toMatchObject({
      code: 'invalid_request',
    });
  });

  it('maps errors into the failure vocabulary', () => {
    expect(linkedInFailure(new LinkedInOrganicApiError(401, null)).reason).toBe(
      'credential_expired',
    );
    expect(
      linkedInFailure(new LinkedInOrganicApiError(403, 'ACCESS_DENIED')).reason,
    ).toBe('permission_lost');
    expect(
      linkedInFailure(new LinkedInOrganicApiError(400, 'FIELD_LENGTH_TOO_LONG'))
        .reason,
    ).toBe('payload_invalid');
    expect(linkedInFailure(new LinkedInOrganicApiError(503, null)).reason).toBe(
      'provider_unavailable',
    );
  });
});

describe('toLinkedInLittleText', () => {
  it('escapes reserved characters but keeps hashtags', () => {
    expect(toLinkedInLittleText('Oi (a) @x * #lyra # fim_')).toBe(
      'Oi \\(a\\) \\@x \\* #lyra \\# fim\\_',
    );
  });
});
