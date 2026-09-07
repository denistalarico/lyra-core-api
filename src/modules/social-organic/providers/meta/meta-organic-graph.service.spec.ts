/* eslint-disable @typescript-eslint/require-await -- fetch doubles intentionally return resolved async values. */
import { BadRequestException } from '@nestjs/common';
import { MetaOrganicGraphError } from './meta-organic-graph.error';
import { MetaOrganicGraphService } from './meta-organic-graph.service';

function response(
  body: unknown,
  options: { ok?: boolean; status?: number } = {},
): Response {
  return {
    ok: options.ok ?? true,
    status: options.status ?? (options.ok === false ? 400 : 200),
    json: async () => body,
  } as Response;
}

describe('MetaOrganicGraphService', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let service: MetaOrganicGraphService;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      SOCIAL_META_APP_ID: 'social-app',
      SOCIAL_META_APP_SECRET: 'social-secret',
      SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID: '1072508992158703',
      META_APP_ID: 'messaging-app',
      META_APP_SECRET: 'messaging-secret',
      META_GRAPH_API_VERSION: 'latest',
    };
    service = new MetaOrganicGraphService();
  });

  afterEach(() => {
    global.fetch = originalFetch;
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('uses the Organic config and a pinned Graph version', () => {
    expect(service.getLoginConfig()).toEqual({
      appId: 'social-app',
      configId: '1072508992158703',
      authorizationEndpoint: 'https://www.facebook.com/v24.0/dialog/oauth',
    });
  });

  it('uses only the old Social names as a temporary fallback', () => {
    delete process.env.SOCIAL_META_APP_ID;
    delete process.env.SOCIAL_META_APP_SECRET;
    process.env.SOCIAL_META_ADS_APP_ID = 'legacy-social-app';
    process.env.SOCIAL_META_ADS_APP_SECRET = 'legacy-social-secret';

    expect(service.getLoginConfig().appId).toBe('legacy-social-app');
  });

  it('never falls back to the Messaging app identity', () => {
    delete process.env.SOCIAL_META_APP_ID;
    delete process.env.SOCIAL_META_APP_SECRET;
    delete process.env.SOCIAL_META_ADS_APP_ID;
    delete process.env.SOCIAL_META_ADS_APP_SECRET;

    expect(() => service.getLoginConfig()).toThrow(BadRequestException);
  });

  it('requires the Organic config id', () => {
    delete process.env.SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID;
    expect(() => service.getLoginConfig()).toThrow(
      'SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID is not configured.',
    );
  });

  it('normalizes the code exchange without leaking credentials', async () => {
    const requested: URL[] = [];
    global.fetch = jest.fn(async (url: URL) => {
      requested.push(url);
      return response({ access_token: 'user-token', expires_in: 3600 });
    }) as never;

    await expect(
      service.exchangeOAuthCode({
        code: 'authorization-code',
        redirectUri:
          'https://api.lyrasuite.com/api/social/organic/oauth/meta/callback',
      }),
    ).resolves.toEqual({ accessToken: 'user-token', expiresIn: 3600 });

    expect(requested[0].pathname).toBe('/v24.0/oauth/access_token');
    expect(requested[0].searchParams.get('client_id')).toBe('social-app');
    expect(requested[0].toString()).not.toContain('messaging-secret');
  });

  it('normalizes provider failures to a fixed safe code', async () => {
    global.fetch = jest.fn(async () =>
      response(
        {
          error: {
            code: 100,
            message:
              'bad code authorization-code and secret social-secret token user-token',
          },
        },
        { ok: false, status: 400 },
      ),
    ) as never;

    const error = (await service
      .exchangeOAuthCode({
        code: 'authorization-code',
        redirectUri: 'https://a.test/cb',
      })
      .catch((value: MetaOrganicGraphError) => value)) as MetaOrganicGraphError;

    expect(error.code).toBe('meta_request_rejected');
    expect(JSON.stringify(error)).not.toContain('authorization-code');
    expect(JSON.stringify(error)).not.toContain('social-secret');
    expect(JSON.stringify(error)).not.toContain('user-token');
  });

  it('lists Pages with credentials in an Authorization header', async () => {
    const calls: Array<{ url: URL; init: RequestInit }> = [];
    global.fetch = jest.fn(async (url: URL, init: RequestInit) => {
      calls.push({ url, init });
      return response({
        data: [
          {
            id: 'page-1',
            name: 'Page One',
            access_token: 'page-token',
            tasks: ['CREATE_CONTENT'],
            picture: { data: { url: 'https://cdn.test/page.jpg' } },
          },
        ],
      });
    }) as never;

    await expect(service.listFacebookPages('user-token')).resolves.toEqual([
      {
        pageId: 'page-1',
        pageName: 'Page One',
        pageAccessToken: 'page-token',
        tasks: ['CREATE_CONTENT'],
        avatarUrl: 'https://cdn.test/page.jpg',
      },
    ]);
    expect(calls[0].url.searchParams.has('access_token')).toBe(false);
    expect(calls[0].init.headers).toEqual({
      Authorization: 'Bearer user-token',
    });
  });

  it('rebuilds pagination from a cursor and removes duplicate Pages', async () => {
    const requested: URL[] = [];
    const page = {
      id: 'page-1',
      name: 'Page One',
      access_token: 'page-token',
      tasks: ['MANAGE'],
    };
    const fetchMock = jest.fn((url: URL) => {
      requested.push(url);
      return Promise.resolve(
        requested.length === 1
          ? response({
              data: [page],
              paging: {
                next: 'https://graph.facebook.com/v25.0/me/accounts?after=cursor-2&access_token=wrong',
              },
            })
          : response({ data: [page] }),
      );
    });
    global.fetch = fetchMock as never;

    await expect(
      service.listFacebookPages('right-token'),
    ).resolves.toHaveLength(1);
    const secondUrl = requested[1];
    expect(secondUrl.pathname).toBe('/v24.0/me/accounts');
    expect(secondUrl.searchParams.get('after')).toBe('cursor-2');
    expect(secondUrl.searchParams.has('access_token')).toBe(false);
  });

  it('resolves a linked Instagram Professional account', async () => {
    global.fetch = jest.fn(async () =>
      response({
        instagram_business_account: {
          id: 'ig-1',
          name: 'Studio',
          username: 'studio',
          profile_picture_url: 'https://cdn.test/ig.jpg',
        },
      }),
    ) as never;

    await expect(
      service.getFacebookPageInstagramAccount({
        pageId: 'page-1',
        pageAccessToken: 'page-token',
      }),
    ).resolves.toEqual({
      accountId: 'ig-1',
      name: 'Studio',
      username: 'studio',
      avatarUrl: 'https://cdn.test/ig.jpg',
    });
  });

  it('returns null when a Page has no linked Instagram account', async () => {
    global.fetch = jest.fn(async () => response({})) as never;
    await expect(
      service.getFacebookPageInstagramAccount({
        pageId: 'page-1',
        pageAccessToken: 'page-token',
      }),
    ).resolves.toBeNull();
  });

  it('rejects malformed provider responses', async () => {
    global.fetch = jest.fn(async () => response({ data: [{}] })) as never;
    await expect(service.listFacebookPages('token')).rejects.toMatchObject({
      code: 'meta_invalid_response',
    });
  });

  it.each([
    [190, 400, 'credential_invalid', 'meta_credential_invalid'],
    [200, 400, 'permission_denied', 'meta_permission_denied'],
    [4, 400, 'rate_limited', 'meta_rate_limited'],
    [null, 503, 'transient', 'meta_service_unavailable'],
  ])(
    'classifies provider failure code=%s status=%s',
    async (providerCode, status, kind, code) => {
      global.fetch = jest.fn(async () =>
        response(
          { error: providerCode === null ? {} : { code: providerCode } },
          { ok: false, status },
        ),
      ) as never;

      await expect(service.listFacebookPages('token')).rejects.toMatchObject({
        kind,
        code,
      });
    },
  );

  it.each([
    ['Error', 'meta_network_error'],
    ['AbortError', 'meta_request_timeout'],
    ['TimeoutError', 'meta_request_timeout'],
  ])('normalizes %s transport failures', async (name, code) => {
    global.fetch = jest.fn(async () => {
      const error = new Error(
        'https://graph.facebook.com/?access_token=user-token',
      );
      error.name = name;
      throw error;
    }) as never;

    await expect(service.listFacebookPages('user-token')).rejects.toMatchObject(
      {
        code,
        message: code,
      },
    );
  });
});
