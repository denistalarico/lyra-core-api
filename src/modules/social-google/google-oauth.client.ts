import { Injectable } from '@nestjs/common';
import { createHash, randomBytes } from 'crypto';
import {
  GOOGLE_AUTHORIZATION_ENDPOINT,
  GOOGLE_ISSUERS,
  GOOGLE_REVOKE_ENDPOINT,
  GOOGLE_TOKEN_ENDPOINT,
  SOCIAL_GOOGLE_CALLBACK_URL_ENV,
  SOCIAL_GOOGLE_CLIENT_ID_ENV,
  SOCIAL_GOOGLE_CLIENT_SECRET_ENV,
} from './google-oauth.constants';

const REQUEST_TIMEOUT_MS = 10_000;

/**
 * Failure talking to Google. `code` is the only thing safe to log or persist:
 * provider response bodies can echo tokens and are never attached.
 */
export class GoogleOAuthError extends Error {
  constructor(
    public readonly code:
      | 'not_configured'
      | 'invalid_grant'
      | 'token_exchange_failed'
      | 'refresh_failed'
      | 'invalid_id_token'
      | 'network_error',
  ) {
    super(code);
    this.name = 'GoogleOAuthError';
  }
}

export type GoogleTokenSet = {
  accessToken: string;
  refreshToken: string | null;
  expiresInSeconds: number | null;
  scopes: string[];
  idToken: string | null;
};

export type GoogleIdentity = { sub: string };

export type GoogleOAuthConfig = {
  clientId: string;
  clientSecret: string;
  callbackUrl: string;
};

export function sha256Hex(value: string) {
  return createHash('sha256').update(value).digest('hex');
}

export function generateOpaque(bytes = 32) {
  return randomBytes(bytes).toString('base64url');
}

/** RFC 7636 S256 challenge for a verifier. */
export function pkceChallenge(verifier: string) {
  return createHash('sha256').update(verifier).digest('base64url');
}

/**
 * Reads the platform's env-backed configuration. The redirect URI must be an
 * absolute https URL (http only for localhost) and is the single fixed value
 * used for both the authorization request and the code exchange.
 */
export function requireGoogleOAuthConfig(
  env: NodeJS.ProcessEnv = process.env,
): GoogleOAuthConfig {
  const clientId = env[SOCIAL_GOOGLE_CLIENT_ID_ENV]?.trim();
  const clientSecret = env[SOCIAL_GOOGLE_CLIENT_SECRET_ENV]?.trim();
  const callbackUrl = env[SOCIAL_GOOGLE_CALLBACK_URL_ENV]?.trim();

  if (!clientId || !clientSecret || !callbackUrl) {
    throw new GoogleOAuthError('not_configured');
  }

  let parsed: URL;
  try {
    parsed = new URL(callbackUrl);
  } catch {
    throw new GoogleOAuthError('not_configured');
  }
  const local = ['localhost', '127.0.0.1'].includes(parsed.hostname);
  if (parsed.protocol !== 'https:' && !(local && parsed.protocol === 'http:')) {
    throw new GoogleOAuthError('not_configured');
  }
  if (parsed.search || parsed.hash) {
    throw new GoogleOAuthError('not_configured');
  }

  return { clientId, clientSecret, callbackUrl: parsed.toString() };
}

/** Decodes a JWT payload without trusting it; callers validate the claims. */
function decodeJwtPayload(token: string): Record<string, unknown> {
  const parts = token.split('.');
  if (parts.length !== 3) throw new GoogleOAuthError('invalid_id_token');
  try {
    const parsed: unknown = JSON.parse(
      Buffer.from(parts[1], 'base64url').toString('utf8'),
    );
    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('payload');
    }
    return parsed as Record<string, unknown>;
  } catch {
    throw new GoogleOAuthError('invalid_id_token');
  }
}

/**
 * Validates the OIDC id_token received directly from Google's token endpoint
 * over TLS (OIDC Core §3.1.3.7 allows skipping signature verification in that
 * case) and returns the subject. Checks issuer, audience, expiry and nonce.
 */
export function validateIdToken(
  idToken: string | null,
  expected: { clientId: string; nonceHash: string },
  now = Date.now(),
): GoogleIdentity {
  if (!idToken) throw new GoogleOAuthError('invalid_id_token');
  const claims = decodeJwtPayload(idToken);

  const aud = claims.aud;
  const audOk = Array.isArray(aud)
    ? aud.includes(expected.clientId)
    : aud === expected.clientId;
  if (
    typeof claims.iss !== 'string' ||
    !GOOGLE_ISSUERS.includes(claims.iss) ||
    !audOk ||
    typeof claims.exp !== 'number' ||
    claims.exp * 1000 <= now ||
    typeof claims.sub !== 'string' ||
    !claims.sub ||
    claims.sub.length > 255 ||
    typeof claims.nonce !== 'string' ||
    sha256Hex(claims.nonce) !== expected.nonceHash
  ) {
    throw new GoogleOAuthError('invalid_id_token');
  }

  return { sub: claims.sub };
}

/**
 * Thin transport to Google. Replaced by a fake in tests; nothing here touches
 * the database.
 */
@Injectable()
export class GoogleOAuthClient {
  getConfig(): GoogleOAuthConfig {
    return requireGoogleOAuthConfig();
  }

  buildAuthorizationUrl(input: {
    scopes: string[];
    state: string;
    codeChallenge: string;
    nonce: string;
  }): string {
    const config = this.getConfig();
    const url = new URL(GOOGLE_AUTHORIZATION_ENDPOINT);
    url.searchParams.set('client_id', config.clientId);
    url.searchParams.set('redirect_uri', config.callbackUrl);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('scope', input.scopes.join(' '));
    url.searchParams.set('state', input.state);
    url.searchParams.set('nonce', input.nonce);
    url.searchParams.set('code_challenge', input.codeChallenge);
    url.searchParams.set('code_challenge_method', 'S256');
    // Offline access + consent so Google issues a refresh token, and
    // incremental authorization so earlier products' grants are kept.
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('include_granted_scopes', 'true');
    return url.toString();
  }

  async exchangeCode(input: {
    code: string;
    codeVerifier: string;
  }): Promise<GoogleTokenSet> {
    const config = this.getConfig();
    const body = await this.postForm(
      GOOGLE_TOKEN_ENDPOINT,
      {
        grant_type: 'authorization_code',
        code: input.code,
        code_verifier: input.codeVerifier,
        redirect_uri: config.callbackUrl,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      },
      'token_exchange_failed',
    );
    return this.toTokenSet(body, 'token_exchange_failed');
  }

  async refresh(refreshToken: string): Promise<GoogleTokenSet> {
    const config = this.getConfig();
    const body = await this.postForm(
      GOOGLE_TOKEN_ENDPOINT,
      {
        grant_type: 'refresh_token',
        refresh_token: refreshToken,
        client_id: config.clientId,
        client_secret: config.clientSecret,
      },
      'refresh_failed',
    );
    return this.toTokenSet(body, 'refresh_failed');
  }

  /** Best effort: returns whether Google accepted the revocation. */
  async revoke(token: string): Promise<boolean> {
    try {
      await this.postForm(GOOGLE_REVOKE_ENDPOINT, { token }, 'refresh_failed');
      return true;
    } catch {
      return false;
    }
  }

  private toTokenSet(
    body: Record<string, unknown>,
    failure: 'token_exchange_failed' | 'refresh_failed',
  ): GoogleTokenSet {
    if (typeof body.access_token !== 'string' || !body.access_token) {
      throw new GoogleOAuthError(failure);
    }
    return {
      accessToken: body.access_token,
      refreshToken:
        typeof body.refresh_token === 'string' && body.refresh_token
          ? body.refresh_token
          : null,
      expiresInSeconds:
        typeof body.expires_in === 'number' && body.expires_in > 0
          ? body.expires_in
          : null,
      scopes:
        typeof body.scope === 'string'
          ? body.scope.split(/\s+/).filter(Boolean)
          : [],
      idToken: typeof body.id_token === 'string' ? body.id_token : null,
    };
  }

  private async postForm(
    url: string,
    form: Record<string, string>,
    failure: 'token_exchange_failed' | 'refresh_failed',
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(url, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams(form).toString(),
        signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
      });
    } catch {
      throw new GoogleOAuthError('network_error');
    }

    let json: unknown = null;
    try {
      json = await response.json();
    } catch {
      json = null;
    }
    const body =
      typeof json === 'object' && json !== null
        ? (json as Record<string, unknown>)
        : {};

    if (!response.ok) {
      // Only the machine code is kept; `error_description` can carry detail
      // we do not want in logs.
      if (body.error === 'invalid_grant') {
        throw new GoogleOAuthError('invalid_grant');
      }
      throw new GoogleOAuthError(failure);
    }
    return body;
  }
}
