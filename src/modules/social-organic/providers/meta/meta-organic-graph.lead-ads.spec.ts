import { MetaOrganicGraphService } from './meta-organic-graph.service';

function response(body: unknown, status = 200): Response {
  return {
    ok: status < 400,
    status,
    json: async () => body,
  } as Response;
}

const calls = (fetchMock: jest.Mock) =>
  fetchMock.mock.calls as Array<[URL, RequestInit]>;

describe('MetaOrganicGraphService — Lead Ads (ML1)', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let service: MetaOrganicGraphService;

  beforeEach(() => {
    process.env = { ...originalEnv, SOCIAL_META_APP_ID: 'social-app' };
    service = new MetaOrganicGraphService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    process.env = originalEnv;
  });

  it("reads one lead with D-L7's fields and the Page token as a bearer", async () => {
    const fetchMock = jest.fn(async () => response({ id: '9001' }));
    global.fetch = fetchMock as typeof fetch;

    await service.getLead({ leadId: '9001', accessToken: 'test-page-token' });

    const [url, init] = calls(fetchMock)[0];
    expect([
      url.pathname.endsWith('/9001'),
      url.searchParams.get('fields'),
      (init.headers as Record<string, string>).Authorization,
    ]).toEqual([
      true,
      'id,created_time,field_data,ad_id,adset_id,campaign_id,form_id,platform,is_organic',
      'Bearer test-page-token',
    ]);
  });

  it('never puts the token in the URL', async () => {
    const fetchMock = jest.fn(async () => response({ id: '9001' }));
    global.fetch = fetchMock as typeof fetch;

    await service.getLead({ leadId: '9001', accessToken: 'test-page-token' });

    expect(String(calls(fetchMock)[0][0])).not.toContain('test-page-token');
  });

  it('reports truncated when the form has more lead pages than allowed', async () => {
    const fetchMock = jest.fn(async (url: URL) =>
      response({
        data: [{ id: `lead-${url.searchParams.get('after') ?? '0'}` }],
        paging: {
          next: `https://graph.facebook.com${url.pathname}?after=c${Math.random()}`,
        },
      }),
    );
    global.fetch = fetchMock as unknown as typeof fetch;

    const result = await service.listFormLeads({
      formId: '55',
      accessToken: 'test-page-token',
      maxPages: 2,
    });

    expect([result.leads.length, result.truncated]).toEqual([2, true]);
  });

  it("reads only this app's subscribed fields on the Page", async () => {
    global.fetch = jest.fn(async () =>
      response({
        data: [
          { id: 'other-app', subscribed_fields: ['messages'] },
          { id: 'social-app', subscribed_fields: ['feed'] },
        ],
      }),
    ) as typeof fetch;

    await expect(
      service.getPageSubscribedFields({
        pageId: '777',
        accessToken: 'test-page-token',
      }),
    ).resolves.toEqual(['feed']);
  });

  it('posts subscribed_fields as a form body', async () => {
    const fetchMock = jest.fn(async () => response({ success: true }));
    global.fetch = fetchMock as typeof fetch;

    await service.subscribePageFields({
      pageId: '777',
      accessToken: 'test-page-token',
      fields: ['feed', 'leadgen'],
    });

    const [url, init] = calls(fetchMock)[0];
    expect([
      url.pathname.endsWith('/777/subscribed_apps'),
      init.method,
      String(init.body),
    ]).toEqual([true, 'POST', 'subscribed_fields=feed%2Cleadgen']);
  });

  it('maps a permission refusal to a fixed code', async () => {
    global.fetch = jest.fn(async () =>
      response({ error: { code: 200, message: 'texto da Meta' } }, 403),
    ) as typeof fetch;

    await expect(
      service.getLead({ leadId: '9001', accessToken: 'test-page-token' }),
    ).rejects.toMatchObject({
      kind: 'permission_denied',
      code: 'meta_permission_denied',
    });
  });
});
