/* eslint-disable @typescript-eslint/no-unsafe-member-access -- Jest records fetch mock calls as dynamic tuples in this focused HTTP contract test. */
import { BadRequestException } from '@nestjs/common';
import { MetaGraphService } from './meta-graph.service';

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

  it('subscribes the Instagram account to only the requested webhook fields', async () => {
    fetchMock.mockResolvedValue(response({ success: true }));

    await expect(
      service.subscribeInstagramAccountToWebhooks({
        igUserId: '17841400000000000',
        accessToken: 'long-lived-secret',
        subscribedFields: ['messages', 'messaging_postbacks'],
      }),
    ).resolves.toEqual({ success: true });

    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(`${url.origin}${url.pathname}`).toBe(
      'https://graph.instagram.com/v26.0/17841400000000000/subscribed_apps',
    );
    expect(url.searchParams.get('subscribed_fields')).toBe(
      'messages,messaging_postbacks',
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

function response(body: unknown, ok = true): Response {
  return {
    ok,
    status: ok ? 200 : 400,
    json: jest.fn().mockResolvedValue(body),
  } as unknown as Response;
}
