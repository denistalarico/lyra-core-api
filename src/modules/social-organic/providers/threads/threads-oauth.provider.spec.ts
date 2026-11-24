import { createHmac } from 'crypto';
import { SocialOrganicOAuthRefreshError } from '../../connections/social-organic-oauth.provider';
import { ThreadsApiError, type ThreadsApiClient } from './threads-api.client';
import { readThreadsSignedRequest } from './threads-deauthorization.service';
import { ThreadsOAuthProvider, threadsRenewAt } from './threads-oauth.provider';

const DAY_MS = 24 * 60 * 60_000;
const app = { appId: 'th-app', secret: 'th-secret' };

function build(overrides: Record<string, jest.Mock> = {}) {
  const api = {
    exchangeCode: jest
      .fn()
      .mockResolvedValue({ accessToken: 'short', expiresIn: null }),
    exchangeLongLived: jest
      .fn()
      .mockResolvedValue({ accessToken: 'long', expiresIn: 60 * 86_400 }),
    refresh: jest
      .fn()
      .mockResolvedValue({ accessToken: 'renewed', expiresIn: 60 * 86_400 }),
    profile: jest.fn().mockResolvedValue({
      id: '1789',
      username: 'lyra',
      name: 'Lyra Suite',
      profilePictureUrl: 'https://cdn.example/p.jpg',
    }),
    ...overrides,
  };
  return {
    api,
    provider: new ThreadsOAuthProvider(api as unknown as ThreadsApiClient),
  };
}

describe('ThreadsOAuthProvider', () => {
  it('builds the threads.com authorization URL with the three scopes', () => {
    const { provider } = build();
    const url = provider.buildAuthorizationUrl({
      loginConfig: app,
      callbackUrl: new URL(
        'https://api.lyrasuite.com/api/social/organic/oauth/threads/callback',
      ),
      state: 'st-1',
    });
    expect(url.origin + url.pathname).toBe(
      'https://threads.com/oauth/authorize',
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      client_id: 'th-app',
      redirect_uri:
        'https://api.lyrasuite.com/api/social/organic/oauth/threads/callback',
      scope: 'threads_basic,threads_content_publish,threads_manage_insights',
      response_type: 'code',
      state: 'st-1',
    });
  });

  it('exchanges for a long-lived token stored as its own refresh credential', async () => {
    const { provider, api } = build();
    const grant = await provider.exchangeCode({
      loginConfig: app,
      callbackUrl: new URL('https://api.example/cb'),
      code: 'c1',
    });
    expect(api.exchangeCode).toHaveBeenCalledWith({
      app,
      code: 'c1',
      redirectUri: 'https://api.example/cb',
    });
    expect(grant.accessToken).toBe('long');
    expect(grant.refreshToken).toBe('long');
    const renewIn = grant.tokenExpiresAt!.getTime() - Date.now();
    expect(renewIn).toBeGreaterThan(52 * DAY_MS);
    expect(renewIn).toBeLessThan(54 * DAY_MS);
  });

  it('keeps the short-lived token for one hour when the exchange fails', async () => {
    const { provider } = build({
      exchangeLongLived: jest.fn().mockRejectedValue(new Error('boom')),
    });
    const grant = await provider.exchangeCode({
      loginConfig: app,
      callbackUrl: new URL('https://api.example/cb'),
      code: 'c1',
    });
    expect(grant).toMatchObject({ accessToken: 'short', refreshToken: null });
  });

  it('discovers the authorizing profile as the single asset', async () => {
    const { provider } = build();
    await expect(
      provider.discoverAssets({ accessToken: 'long' }),
    ).resolves.toEqual([
      expect.objectContaining({
        externalAssetId: '1789',
        assetType: 'threads_account',
        displayName: 'Lyra Suite',
        username: 'lyra',
        avatarUrl: 'https://cdn.example/p.jpg',
      }),
    ]);
  });

  it('refreshes; a 190 is permanent, anything else transient', async () => {
    const { provider } = build();
    await expect(
      provider.refreshAccessToken({ refreshToken: 'long' }),
    ).resolves.toMatchObject({
      accessToken: 'renewed',
      refreshToken: 'renewed',
    });

    const lost = build({
      refresh: jest.fn().mockRejectedValue(new ThreadsApiError(400, 190)),
    });
    await expect(
      lost.provider.refreshAccessToken({ refreshToken: 'long' }),
    ).rejects.toEqual(new SocialOrganicOAuthRefreshError('permanent'));

    const flaky = build({
      refresh: jest.fn().mockRejectedValue(new ThreadsApiError(0, null)),
    });
    await expect(
      flaky.provider.refreshAccessToken({ refreshToken: 'long' }),
    ).rejects.toEqual(new SocialOrganicOAuthRefreshError('transient'));
  });
});

describe('threadsRenewAt', () => {
  const now = Date.UTC(2026, 10, 23);
  it('renews seven days before a 60-day expiry', () => {
    expect(threadsRenewAt(60 * 86_400, now)!.getTime()).toBe(now + 53 * DAY_MS);
  });
  it('never asks for a refresh before the token is 25 h old', () => {
    expect(threadsRenewAt(3 * 86_400, now)!.getTime()).toBe(
      now + 25 * 60 * 60_000,
    );
  });
  it('is null without an expiry', () => {
    expect(threadsRenewAt(null, now)).toBeNull();
  });
});

describe('readThreadsSignedRequest', () => {
  const sign = (data: unknown, secret = 'th-secret') => {
    const payload = Buffer.from(JSON.stringify(data)).toString('base64url');
    const signature = createHmac('sha256', secret)
      .update(payload)
      .digest('base64url');
    return `${signature}.${payload}`;
  };

  it('returns the user id of a valid signed request', () => {
    expect(
      readThreadsSignedRequest(
        sign({ algorithm: 'HMAC-SHA256', user_id: '1789', issued_at: 1 }),
        'th-secret',
      ),
    ).toBe('1789');
  });

  it('refuses a wrong signature, a malformed value or another algorithm', () => {
    const data = { algorithm: 'HMAC-SHA256', user_id: '1789' };
    expect(() =>
      readThreadsSignedRequest(sign(data, 'other'), 'th-secret'),
    ).toThrow('threads_signed_request_invalid');
    expect(() => readThreadsSignedRequest('abc', 'th-secret')).toThrow();
    expect(() => readThreadsSignedRequest(undefined, 'th-secret')).toThrow();
    expect(() =>
      readThreadsSignedRequest(
        sign({ algorithm: 'MD5', user_id: '1789' }),
        'th-secret',
      ),
    ).toThrow();
  });
});
