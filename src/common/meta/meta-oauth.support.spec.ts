import { BadRequestException } from '@nestjs/common';
import {
  buildFacebookLoginAuthorizationUrl,
  hashOAuthState,
  isAcceptableOAuthState,
  MAX_OAUTH_STATE_LENGTH,
  parseHttpUrl,
  requireConfiguredUrl,
} from './meta-oauth.support';

describe('hashOAuthState', () => {
  it('returns a deterministic sha256 hex digest', () => {
    const first = hashOAuthState('some-state');
    const second = hashOAuthState('some-state');

    expect(first).toBe(second);
    expect(first).toMatch(/^[0-9a-f]{64}$/);
  });

  it('produces different digests for different input', () => {
    expect(hashOAuthState('a')).not.toBe(hashOAuthState('b'));
  });
});

describe('isAcceptableOAuthState', () => {
  it('rejects undefined', () => {
    expect(isAcceptableOAuthState(undefined)).toBe(false);
  });

  it('rejects the empty string', () => {
    expect(isAcceptableOAuthState('')).toBe(false);
  });

  it('accepts a state at the length boundary', () => {
    expect(isAcceptableOAuthState('a'.repeat(MAX_OAUTH_STATE_LENGTH))).toBe(
      true,
    );
  });

  it('rejects a state past the length boundary', () => {
    expect(isAcceptableOAuthState('a'.repeat(MAX_OAUTH_STATE_LENGTH + 1))).toBe(
      false,
    );
  });
});

describe('parseHttpUrl', () => {
  it('parses a valid https URL', () => {
    const url = parseHttpUrl('https://example.com/callback', 'Label');
    expect(url.toString()).toBe('https://example.com/callback');
  });

  it('parses a valid http URL', () => {
    const url = parseHttpUrl('http://example.com/callback', 'Label');
    expect(url.protocol).toBe('http:');
  });

  it('throws BadRequestException for a malformed URL', () => {
    expect(() => parseHttpUrl('not-a-url', 'Label')).toThrow(
      BadRequestException,
    );
  });

  it('throws BadRequestException for a non-http(s) scheme', () => {
    expect(() => parseHttpUrl('ftp://example.com', 'Label')).toThrow(
      BadRequestException,
    );
  });
});

describe('requireConfiguredUrl', () => {
  const ENV_NAME = 'META_OAUTH_SUPPORT_SPEC_URL';

  afterEach(() => {
    delete process.env[ENV_NAME];
  });

  it('throws BadRequestException when the env var is unset', () => {
    expect(() => requireConfiguredUrl(ENV_NAME)).toThrow(BadRequestException);
  });

  it('throws BadRequestException when the env var is empty', () => {
    process.env[ENV_NAME] = '';
    expect(() => requireConfiguredUrl(ENV_NAME)).toThrow(BadRequestException);
  });

  it('parses a configured value into a URL', () => {
    process.env[ENV_NAME] = 'https://example.com/callback';
    const url = requireConfiguredUrl(ENV_NAME);
    expect(url.toString()).toBe('https://example.com/callback');
  });
});

describe('buildFacebookLoginAuthorizationUrl', () => {
  it('builds an authorization URL with every required query param', () => {
    const url = buildFacebookLoginAuthorizationUrl({
      loginConfig: {
        appId: 'app-123',
        configId: 'config-456',
        authorizationEndpoint: 'https://www.facebook.com/v20.0/dialog/oauth',
      },
      callbackUrl: new URL('https://example.com/callback'),
      state: 'raw-state-value',
    });

    expect(url.origin + url.pathname).toBe(
      'https://www.facebook.com/v20.0/dialog/oauth',
    );
    expect(url.searchParams.get('client_id')).toBe('app-123');
    expect(url.searchParams.get('redirect_uri')).toBe(
      'https://example.com/callback',
    );
    expect(url.searchParams.get('response_type')).toBe('code');
    expect(url.searchParams.get('override_default_response_type')).toBe('true');
    expect(url.searchParams.get('config_id')).toBe('config-456');
    expect(url.searchParams.get('state')).toBe('raw-state-value');
  });
});
