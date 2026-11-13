import 'reflect-metadata';
import {
  GoogleOAuthClient,
  GoogleOAuthError,
  pkceChallenge,
  requireGoogleOAuthConfig,
  sha256Hex,
  validateIdToken,
} from './google-oauth.client';
import {
  GOOGLE_PRODUCT_SCOPES,
  scopesForProduct,
} from './google-oauth.constants';
import { SocialGoogleController } from './social-google.controller';
import {
  PERMISSION_KEY_METADATA,
  PRODUCT_ENTITLEMENT_METADATA,
} from '../permissions/decorators/permissions.decorators';

const ENV = {
  SOCIAL_GOOGLE_CLIENT_ID: 'client-id.apps.googleusercontent.com',
  SOCIAL_GOOGLE_CLIENT_SECRET: 'super-secret-value',
  SOCIAL_GOOGLE_OAUTH_CALLBACK_URL:
    'https://api.example.com/api/social/integrations/google/callback',
};

function jwt(claims: Record<string, unknown>) {
  const enc = (value: unknown) =>
    Buffer.from(JSON.stringify(value)).toString('base64url');
  return `${enc({ alg: 'RS256' })}.${enc(claims)}.sig`;
}

const NONCE = 'nonce-value';
const goodClaims = () => ({
  iss: 'https://accounts.google.com',
  aud: ENV.SOCIAL_GOOGLE_CLIENT_ID,
  exp: Math.floor(Date.now() / 1000) + 600,
  sub: '1234567890',
  nonce: NONCE,
});
const expected = {
  clientId: ENV.SOCIAL_GOOGLE_CLIENT_ID,
  nonceHash: sha256Hex(NONCE),
};

describe('Google OAuth scopes', () => {
  it('requests only openid + the single product scope', () => {
    expect(scopesForProduct('ga4')).toEqual([
      'openid',
      'https://www.googleapis.com/auth/analytics.readonly',
    ]);
    expect(scopesForProduct('ads')).toEqual([
      'openid',
      'https://www.googleapis.com/auth/adwords',
    ]);
    expect(scopesForProduct('business_profile')).toEqual([
      'openid',
      'https://www.googleapis.com/auth/business.manage',
    ]);
    expect(Object.keys(GOOGLE_PRODUCT_SCOPES)).toHaveLength(3);
  });
});

describe('requireGoogleOAuthConfig', () => {
  it('accepts a complete https configuration', () => {
    expect(requireGoogleOAuthConfig(ENV).clientId).toBe(
      ENV.SOCIAL_GOOGLE_CLIENT_ID,
    );
  });

  it.each([
    ['missing secret', { ...ENV, SOCIAL_GOOGLE_CLIENT_SECRET: '' }],
    [
      'http callback',
      { ...ENV, SOCIAL_GOOGLE_OAUTH_CALLBACK_URL: 'http://api.example.com/cb' },
    ],
    [
      'callback with query',
      { ...ENV, SOCIAL_GOOGLE_OAUTH_CALLBACK_URL: 'https://a.example/cb?x=1' },
    ],
    ['invalid url', { ...ENV, SOCIAL_GOOGLE_OAUTH_CALLBACK_URL: 'nope' }],
  ])('rejects %s', (_label, env) => {
    expect(() => requireGoogleOAuthConfig(env)).toThrow(GoogleOAuthError);
  });
});

describe('validateIdToken', () => {
  it('returns the subject of a valid token', () => {
    expect(validateIdToken(jwt(goodClaims()), expected)).toEqual({
      sub: '1234567890',
    });
  });

  it.each([
    ['wrong audience', { aud: 'other-client' }],
    ['wrong issuer', { iss: 'https://evil.example' }],
    ['expired', { exp: Math.floor(Date.now() / 1000) - 5 }],
    ['wrong nonce', { nonce: 'replayed' }],
    ['missing nonce', { nonce: undefined }],
    ['missing sub', { sub: undefined }],
  ])('rejects %s', (_label, override) => {
    expect(() =>
      validateIdToken(jwt({ ...goodClaims(), ...override }), expected),
    ).toThrow(GoogleOAuthError);
  });

  it('rejects absent and malformed tokens', () => {
    expect(() => validateIdToken(null, expected)).toThrow(GoogleOAuthError);
    expect(() => validateIdToken('a.b', expected)).toThrow(GoogleOAuthError);
    expect(() => validateIdToken('a.!!!.c', expected)).toThrow(
      GoogleOAuthError,
    );
  });
});

describe('GoogleOAuthClient', () => {
  const original = { ...process.env };
  const client = new GoogleOAuthClient();

  beforeEach(() => Object.assign(process.env, ENV));
  afterEach(() => {
    process.env = { ...original };
    jest.restoreAllMocks();
  });

  it('builds a PKCE/S256, state-bound, product-scoped authorization URL', () => {
    const url = new URL(
      client.buildAuthorizationUrl({
        scopes: scopesForProduct('ga4'),
        state: 'st',
        nonce: 'no',
        codeChallenge: pkceChallenge('verifier'),
      }),
    );
    const p = url.searchParams;
    expect(url.origin + url.pathname).toBe(
      'https://accounts.google.com/o/oauth2/v2/auth',
    );
    expect(p.get('redirect_uri')).toBe(ENV.SOCIAL_GOOGLE_OAUTH_CALLBACK_URL);
    expect(p.get('code_challenge_method')).toBe('S256');
    expect(p.get('code_challenge')).toBe(pkceChallenge('verifier'));
    expect(p.get('scope')).toBe(
      'openid https://www.googleapis.com/auth/analytics.readonly',
    );
    expect(p.get('access_type')).toBe('offline');
    expect(p.get('include_granted_scopes')).toBe('true');
    expect(url.toString()).not.toContain(ENV.SOCIAL_GOOGLE_CLIENT_SECRET);
  });

  function mockFetch(status: number, body: unknown) {
    return jest.spyOn(global, 'fetch').mockResolvedValue({
      ok: status >= 200 && status < 300,
      status,
      json: () => Promise.resolve(body),
    } as Response);
  }

  it('parses granted scopes and an absent refresh token on refresh', async () => {
    mockFetch(200, {
      access_token: 'at',
      expires_in: 3599,
      scope: 'openid https://www.googleapis.com/auth/adwords',
    });
    const tokens = await client.refresh('rt');
    expect(tokens.refreshToken).toBeNull();
    expect(tokens.scopes).toEqual([
      'openid',
      'https://www.googleapis.com/auth/adwords',
    ]);
  });

  it('maps invalid_grant without leaking the provider description', async () => {
    mockFetch(400, {
      error: 'invalid_grant',
      error_description: 'Token has been expired or revoked: rt-secret',
    });
    const error = await client.refresh('rt-secret').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(GoogleOAuthError);
    expect((error as GoogleOAuthError).code).toBe('invalid_grant');
    expect(JSON.stringify(error)).not.toContain('rt-secret');
    expect((error as Error).message).not.toContain('rt-secret');
  });

  it('maps other failures and network errors to safe codes', async () => {
    mockFetch(500, { error: 'backend_error' });
    await expect(client.refresh('rt')).rejects.toMatchObject({
      code: 'refresh_failed',
    });
    jest.spyOn(global, 'fetch').mockRejectedValue(new Error('boom'));
    await expect(
      client.exchangeCode({ code: 'c', codeVerifier: 'v' }),
    ).rejects.toMatchObject({ code: 'network_error' });
  });

  it('sends the verifier and fixed redirect URI on code exchange', async () => {
    const spy = mockFetch(200, { access_token: 'at', id_token: 'x' });
    await client.exchangeCode({ code: 'abc', codeVerifier: 'ver' });
    const body = new URLSearchParams(
      (spy.mock.calls[0][1] as RequestInit).body as string,
    );
    expect(body.get('code_verifier')).toBe('ver');
    expect(body.get('redirect_uri')).toBe(ENV.SOCIAL_GOOGLE_OAUTH_CALLBACK_URL);
    expect(body.get('grant_type')).toBe('authorization_code');
  });
});

describe('SocialGoogleController permissions', () => {
  const proto = SocialGoogleController.prototype as unknown as Record<
    string,
    (...args: never[]) => unknown
  >;

  it.each(['status', 'connect', 'confirm', 'disconnectProduct', 'revoke'])(
    '%s requires JWT, Social entitlement and the integrations permission',
    (method) => {
      const guards = Reflect.getMetadata('__guards__', proto[method]) as
        | Array<{ name: string }>
        | undefined;
      expect(guards?.map((g) => g.name)).toEqual([
        'JwtAuthGuard',
        'PermissionsGuard',
      ]);
      expect(Reflect.getMetadata(PERMISSION_KEY_METADATA, proto[method])).toBe(
        'social.settings.integrations.manage.admin',
      );
      expect(
        Reflect.getMetadata(PRODUCT_ENTITLEMENT_METADATA, proto[method]),
      ).toBe('social');
    },
  );

  it('keeps only the callback public', () => {
    expect(Reflect.getMetadata('__guards__', proto.callback)).toBeUndefined();
  });
});
