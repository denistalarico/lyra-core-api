/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Jest records fetch mock calls as dynamic tuples in this focused HTTP contract test. */
import { BadRequestException, Logger } from '@nestjs/common';
import {
  INSTAGRAM_LOGIN_WEBHOOK_FIELDS,
  MetaGraphService,
} from './meta-graph.service';

describe('MetaGraphService Instagram Login', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let service: MetaGraphService;
  let fetchMock: jest.Mock;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      META_INSTAGRAM_APP_ID: 'instagram-app-id',
      META_INSTAGRAM_APP_SECRET: 'instagram-app-secret',
      META_GRAPH_API_VERSION: 'v26.0',
    };
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    service = new MetaGraphService();
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('exchanges the authorization code using the official Instagram endpoint', async () => {
    fetchMock.mockResolvedValue(
      response({
        data: [
          {
            access_token: 'short-lived-secret',
            user_id: 123,
            permissions:
              'instagram_business_basic,instagram_business_manage_messages',
          },
        ],
      }),
    );

    const result = await service.exchangeInstagramCode({
      code: 'authorization-code',
      redirectUri: 'https://api.example.com/api/inbox/callback',
    });

    expect(result).toEqual({
      accessToken: 'short-lived-secret',
      userId: '123',
      permissions: [
        'instagram_business_basic',
        'instagram_business_manage_messages',
      ],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://api.instagram.com/oauth/access_token',
      expect.objectContaining({ method: 'POST' }),
    );
    const body = fetchMock.mock.calls[0][1].body as FormData;
    expect(Object.fromEntries(body.entries())).toEqual({
      client_id: 'instagram-app-id',
      client_secret: 'instagram-app-secret',
      grant_type: 'authorization_code',
      redirect_uri: 'https://api.example.com/api/inbox/callback',
      code: 'authorization-code',
    });
  });

  it('exchanges the short-lived token for a long-lived token', async () => {
    fetchMock.mockResolvedValue(
      response({
        access_token: 'long-lived-secret',
        token_type: 'bearer',
        expires_in: 5_183_944,
      }),
    );

    await expect(
      service.exchangeInstagramLongLivedToken('short-lived-secret'),
    ).resolves.toEqual({
      accessToken: 'long-lived-secret',
      tokenType: 'bearer',
      expiresIn: 5_183_944,
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.instagram.com/access_token',
    );
    expect(url.searchParams.get('grant_type')).toBe('ig_exchange_token');
    expect(url.searchParams.get('client_secret')).toBe('instagram-app-secret');
    expect(url.searchParams.get('access_token')).toBe('short-lived-secret');
  });

  it('loads the professional account identity from graph.instagram.com', async () => {
    fetchMock.mockResolvedValue(
      response({
        data: [
          {
            id: '27561859610089550',
            user_id: '17841400000000000',
            username: 'talaricolabs',
          },
        ],
      }),
    );

    await expect(
      service.getInstagramAuthorizedAccount('long-lived-secret'),
    ).resolves.toEqual({
      accountId: '17841400000000000',
      scopedId: '27561859610089550',
      username: 'talaricolabs',
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.instagram.com/v26.0/me',
    );
    expect(url.searchParams.get('fields')).toBe('id,user_id,username');
  });

  it('loads a messaging participant profile without exposing the token in the URL', async () => {
    fetchMock.mockResolvedValue(
      response({
        id: 'ig-user-1',
        name: 'Maria Silva',
        username: 'maria.silva',
        profile_pic: 'https://cdn.example.com/avatar.jpg',
      }),
    );

    await expect(
      service.getInstagramUserProfile({
        scopedUserId: 'ig-user-1',
        accessToken: 'long-lived-secret',
      }),
    ).resolves.toEqual({
      id: 'ig-user-1',
      name: 'Maria Silva',
      username: 'maria.silva',
      profilePictureUrl: 'https://cdn.example.com/avatar.jpg',
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.instagram.com/v26.0/ig-user-1',
    );
    expect(url.searchParams.get('fields')).toBe('id,name,username,profile_pic');
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'GET',
      headers: { Authorization: 'Bearer long-lived-secret' },
    });
  });

  it('subscribes the Instagram account to only the requested webhook fields', async () => {
    fetchMock.mockResolvedValue(response({ success: true }));

    await expect(
      service.subscribeInstagramAccountToWebhooks({
        igUserId: '17841400000000000',
        accessToken: 'long-lived-secret',
        subscribedFields: INSTAGRAM_LOGIN_WEBHOOK_FIELDS,
      }),
    ).resolves.toEqual({ success: true });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.instagram.com/v26.0/17841400000000000/subscribed_apps',
    );
    expect(url.searchParams.get('subscribed_fields')).toBe(
      'messages,messaging_postbacks,message_reactions,messaging_seen',
    );
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'POST',
      headers: { Authorization: 'Bearer long-lived-secret' },
    });
  });

  it('sanitizes Instagram webhook subscription provider errors', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          error: {
            message: 'Rejected long-lived-secret',
            fbtrace_id: 'private-trace',
          },
        },
        false,
      ),
    );

    const error = await service
      .subscribeInstagramAccountToWebhooks({
        igUserId: '17841400000000000',
        accessToken: 'long-lived-secret',
        subscribedFields: ['messages', 'messaging_postbacks'],
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as Error).message)).toBe(
      'Instagram webhook subscription failed.',
    );
    expect(JSON.stringify(error)).not.toContain('long-lived-secret');
    expect(JSON.stringify(error)).not.toContain('private-trace');
  });

  it('returns a typed and sanitized Instagram webhook subscription summary', async () => {
    fetchMock.mockResolvedValue(
      response({
        data: [
          {
            id: 'private-app-id',
            subscribed_fields: ['messages', 'messaging_postbacks', 'messages'],
          },
        ],
      }),
    );

    const result = await service.getInstagramAccountWebhookSubscriptions({
      igUserId: '17841400000000000',
      accessToken: 'long-lived-secret',
    });

    expect(result).toEqual({
      appSubscribed: true,
      subscribedFields: ['messages', 'messaging_postbacks'],
    });
    expect(JSON.stringify(result)).not.toContain('private-app-id');
    expect(JSON.stringify(result)).not.toContain('long-lived-secret');
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.instagram.com/v26.0/17841400000000000/subscribed_apps',
    );
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'GET',
      headers: { Authorization: 'Bearer long-lived-secret' },
    });
  });

  it('sanitizes external token exchange errors', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          error: {
            message: 'Rejected secret short-lived-secret',
            fbtrace_id: 'private-trace',
          },
        },
        false,
      ),
    );

    const promise = service.exchangeInstagramCode({
      code: 'authorization-code',
      redirectUri: 'https://api.example.com/api/inbox/callback',
    });

    await expect(promise).rejects.toBeInstanceOf(BadRequestException);
    await expect(promise).rejects.not.toThrow('short-lived-secret');
    await expect(promise).rejects.not.toThrow('private-trace');
  });
});

describe('MetaGraphService Facebook assets', () => {
  const originalEnv = process.env;
  const originalFetch = global.fetch;
  let service: MetaGraphService;
  let fetchMock: jest.Mock;
  let loggerErrorSpy: jest.SpyInstance;

  beforeEach(() => {
    process.env = {
      ...originalEnv,
      META_APP_ID: 'meta-app-id',
      META_APP_SECRET: 'meta-app-secret',
      META_FACEBOOK_LOGIN_CONFIG_ID: 'business-config-id',
      META_GRAPH_API_VERSION: 'v26.0',
    };
    fetchMock = jest.fn();
    global.fetch = fetchMock as typeof fetch;
    loggerErrorSpy = jest
      .spyOn(Logger.prototype, 'error')
      .mockImplementation(() => undefined);
    service = new MetaGraphService();
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  afterAll(() => {
    process.env = originalEnv;
    global.fetch = originalFetch;
  });

  it('exposes the Facebook Login for Business public configuration only', () => {
    expect(service.getFacebookLoginConfig()).toEqual({
      appId: 'meta-app-id',
      configId: 'business-config-id',
      authorizationEndpoint: 'https://www.facebook.com/v26.0/dialog/oauth',
    });
    expect(JSON.stringify(service.getFacebookLoginConfig())).not.toContain(
      'meta-app-secret',
    );
  });

  it('requires an explicit Facebook Login for Business configuration ID', () => {
    delete process.env.META_FACEBOOK_LOGIN_CONFIG_ID;

    expect(() => service.getFacebookLoginConfig()).toThrow(
      'Facebook Login for Business configuration ID is not configured.',
    );
  });

  it('exchanges a Facebook authorization code using the documented GET contract', async () => {
    fetchMock.mockResolvedValue(
      response({
        access_token: 'user-secret-token',
        token_type: 'bearer',
        expires_in: 3_600,
      }),
    );

    await expect(
      service.exchangeFacebookOAuthCode({
        code: 'authorization-code',
        redirectUri: 'https://api.example.com/facebook/callback',
      }),
    ).resolves.toEqual({
      accessToken: 'user-secret-token',
      tokenType: 'bearer',
      expiresIn: 3_600,
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/oauth/access_token',
    );
    expect(url.searchParams.get('client_id')).toBe('meta-app-id');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://api.example.com/facebook/callback',
    );
    expect(url.searchParams.get('client_secret')).toBe('meta-app-secret');
    expect(url.searchParams.get('code')).toBe('authorization-code');
    expect(url.searchParams.has('grant_type')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toEqual({ method: 'GET' });
  });

  it('sanitizes Facebook token exchange failures', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          error: {
            message: 'Rejected authorization-code with meta-app-secret',
            fbtrace_id: 'private-trace',
          },
        },
        false,
      ),
    );

    const error = await service
      .exchangeFacebookOAuthCode({
        code: 'authorization-code',
        redirectUri: 'https://api.example.com/facebook/callback',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as Error).message)).toBe(
      'Facebook OAuth token exchange failed.',
    );
    expect(JSON.stringify(error)).not.toContain('authorization-code');
    expect(JSON.stringify(error)).not.toContain('meta-app-secret');
    expect(JSON.stringify(error)).not.toContain('private-trace');
  });

  it('lists a Facebook Page with its Page Access Token', async () => {
    fetchMock.mockResolvedValue(
      response({
        data: [
          {
            id: 'page-1',
            name: 'Page One',
            access_token: 'page-secret-1',
          },
        ],
      }),
    );

    await expect(service.listFacebookPages('user-secret')).resolves.toEqual([
      {
        pageId: 'page-1',
        pageName: 'Page One',
        pageAccessToken: 'page-secret-1',
      },
    ]);

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/me/accounts',
    );
    expect(url.searchParams.get('fields')).toBe('id,name,access_token');
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'GET',
      headers: { Authorization: 'Bearer user-secret' },
    });
  });

  it('loads all Facebook Pages across pagination without copying tokens from next URLs', async () => {
    fetchMock
      .mockResolvedValueOnce(
        response({
          data: [
            {
              id: 'page-1',
              name: 'Page One',
              access_token: 'page-secret-1',
            },
          ],
          paging: {
            next: 'https://graph.facebook.com/v26.0/123456/accounts?after=cursor-2&access_token=provider-echoed-secret',
          },
        }),
      )
      .mockResolvedValueOnce(
        response({
          data: [
            {
              id: 'page-2',
              name: 'Page Two',
              access_token: 'page-secret-2',
            },
          ],
        }),
      );

    await expect(
      service.listFacebookPages('user-secret'),
    ).resolves.toHaveLength(2);

    const secondUrl = new URL(String(fetchMock.mock.calls[1][0]));
    expect(secondUrl.searchParams.get('after')).toBe('cursor-2');
    expect(secondUrl.searchParams.has('access_token')).toBe(false);
    expect(String(fetchMock.mock.calls[1][1].headers.Authorization)).toBe(
      'Bearer user-secret',
    );
  });

  it('identifies the Instagram professional account linked to a Page', async () => {
    fetchMock.mockResolvedValue(
      response({
        instagram_business_account: {
          id: 'instagram-1',
          username: 'page.one',
        },
      }),
    );

    await expect(
      service.getFacebookPageInstagramAccount({
        pageId: 'page-1',
        pageAccessToken: 'page-secret-1',
      }),
    ).resolves.toEqual({
      accountId: 'instagram-1',
      username: 'page.one',
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/page-1',
    );
    expect(url.searchParams.get('fields')).toBe(
      'instagram_business_account{id,username}',
    );
    expect(url.searchParams.has('access_token')).toBe(false);
  });

  it.each([{}, { instagram_business_account: null }])(
    'does not invent an Instagram account when none is linked',
    async (body) => {
      fetchMock.mockResolvedValue(response(body));

      await expect(
        service.getFacebookPageInstagramAccount({
          pageId: 'page-1',
          pageAccessToken: 'page-secret-1',
        }),
      ).resolves.toBeNull();
    },
  );

  it('subscribes the selected Facebook Page to Instagram messaging webhooks', async () => {
    fetchMock.mockResolvedValue(response({ success: true }));

    await expect(
      service.subscribeFacebookPageToInstagramWebhooks({
        pageId: 'page-1',
        pageAccessToken: 'page-secret-1',
      }),
    ).resolves.toEqual({ success: true });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/page-1/subscribed_apps',
    );
    expect(url.searchParams.get('subscribed_fields')).toBe(
      'messages,messaging_postbacks,message_reactions',
    );
    expect(url.searchParams.get('subscribed_fields')).not.toContain(
      'messaging_seen',
    );
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'POST',
      headers: { Authorization: 'Bearer page-secret-1' },
    });
    expect(loggerErrorSpy).not.toHaveBeenCalled();
  });

  it('returns sanitized Facebook Page webhook subscriptions', async () => {
    fetchMock.mockResolvedValue(
      response({
        data: [
          {
            id: 'private-app-id',
            subscribed_fields: ['messages', 'messaging_postbacks', 'messages'],
          },
        ],
      }),
    );

    await expect(
      service.getFacebookPageWebhookSubscriptions({
        pageId: 'page-1',
        pageAccessToken: 'page-secret-1',
      }),
    ).resolves.toEqual({
      appSubscribed: true,
      subscribedFields: ['messages', 'messaging_postbacks'],
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/page-1/subscribed_apps',
    );
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'GET',
      headers: { Authorization: 'Bearer page-secret-1' },
    });
  });

  it('loads an Instagram messaging profile through Facebook Graph with a Page token', async () => {
    fetchMock.mockResolvedValue(
      response({
        id: 'ig-scoped-user',
        name: 'Maria Silva',
        username: 'maria.silva',
        profile_pic: 'https://cdn.example.com/avatar.jpg',
      }),
    );

    await expect(
      service.getFacebookInstagramUserProfile({
        scopedUserId: 'ig-scoped-user',
        pageAccessToken: 'page-secret-1',
      }),
    ).resolves.toEqual({
      id: 'ig-scoped-user',
      name: 'Maria Silva',
      username: 'maria.silva',
      profilePictureUrl: 'https://cdn.example.com/avatar.jpg',
    });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.facebook.com/v26.0/ig-scoped-user',
    );
    expect(url.searchParams.get('fields')).toBe('id,name,username,profile_pic');
    expect(url.searchParams.has('access_token')).toBe(false);
    expect(fetchMock.mock.calls[0][1]).toEqual({
      method: 'GET',
      headers: { Authorization: 'Bearer page-secret-1' },
    });
  });

  it('sanitizes Facebook Page subscription failures', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          error: {
            message:
              'Permission denied. Authorization: Bearer page-secret-1; app_secret=instagram-app-secret; client_secret=meta-app-secret; oauth_code=private-oauth-code; credentialsEncrypted=private-encrypted-credentials; https://graph.facebook.com/page-1/subscribed_apps?access_token=user-secret',
            type: 'OAuthException',
            code: 100,
            error_subcode: 33,
            fbtrace_id: 'private-trace',
          },
        },
        false,
      ),
    );

    const error = await service
      .subscribeFacebookPageToInstagramWebhooks({
        pageId: 'page-1',
        pageAccessToken: 'page-secret-1',
      })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect((error as Error).message).toBe(
      'Facebook Page webhook subscription failed.',
    );
    expect(JSON.stringify(error)).not.toContain('page-secret-1');
    expect(JSON.stringify(error)).not.toContain('private-trace');

    expect(loggerErrorSpy).toHaveBeenCalledWith(
      'Meta webhook subscription failed',
      {
        operation: 'subscribeFacebookPageToInstagramWebhooks',
        status: 400,
        type: 'OAuthException',
        code: 100,
        subcode: 33,
        message:
          'Permission denied. [REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED] [REDACTED_URL]',
      },
    );

    const serializedLog = JSON.stringify(loggerErrorSpy.mock.calls);
    expect(serializedLog).not.toContain('page-secret-1');
    expect(serializedLog).not.toContain('user-secret');
    expect(serializedLog).not.toContain('Authorization');
    expect(serializedLog).not.toContain('instagram-app-secret');
    expect(serializedLog).not.toContain('meta-app-secret');
    expect(serializedLog).not.toContain('private-oauth-code');
    expect(serializedLog).not.toContain('private-encrypted-credentials');
    expect(serializedLog).not.toContain('private-trace');
  });

  it('rejects malformed Facebook Page responses', async () => {
    fetchMock.mockResolvedValue(
      response({ data: [{ id: 'page-1', name: 'Page One' }] }),
    );

    await expect(service.listFacebookPages('user-secret')).rejects.toThrow(
      'Facebook Pages lookup returned an invalid response.',
    );
  });

  it('sanitizes Meta Graph API failures and does not expose tokens', async () => {
    fetchMock.mockResolvedValue(
      response(
        {
          error: {
            message: 'Rejected user-secret and page-secret-1',
            fbtrace_id: 'private-trace',
          },
        },
        false,
      ),
    );

    const error = await service
      .listFacebookPages('user-secret')
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(BadRequestException);
    expect(String((error as Error).message)).toBe(
      'Facebook Pages lookup failed.',
    );
    expect(JSON.stringify(error)).not.toContain('user-secret');
    expect(JSON.stringify(error)).not.toContain('page-secret-1');
    expect(JSON.stringify(error)).not.toContain('private-trace');
  });

  it('rejects arbitrary pagination URLs without fetching them', async () => {
    fetchMock.mockResolvedValue(
      response({
        data: [],
        paging: {
          next: 'https://attacker.example/collect?after=cursor-2',
        },
      }),
    );

    await expect(service.listFacebookPages('user-secret')).rejects.toThrow(
      'Facebook Pages pagination returned an invalid response.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('stops repeated pagination cursors instead of looping', async () => {
    fetchMock.mockResolvedValue(
      response({
        data: [],
        paging: {
          next: 'https://graph.facebook.com/v26.0/me/accounts?after=repeated-cursor',
        },
      }),
    );

    await expect(service.listFacebookPages('user-secret')).rejects.toThrow(
      'Facebook Pages pagination returned an invalid response.',
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}
