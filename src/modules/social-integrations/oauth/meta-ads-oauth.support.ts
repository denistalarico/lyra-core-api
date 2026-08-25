import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Facebook Login for Business primitives used by the Social Ads connection.
 *
 * ── EXTRACTION CANDIDATE ──────────────────────────────────────────────────
 * `hashOAuthState`, `isAcceptableOAuthState`, `parseHttpUrl`,
 * `requireConfiguredUrl` and `buildFacebookLoginAuthorizationUrl` are
 * byte-for-byte equivalent to their counterparts in
 * `modules/inbox/channels/meta/oauth/facebook-login-oauth.support.ts`. They
 * are genuinely provider-generic: nothing in them knows about messaging or
 * about ads.
 *
 * They are duplicated here rather than imported because importing would make
 * Lyra Social depend on the Inbox module — the coupling this slice exists to
 * avoid. The right destination is a shared `common/meta/` module owned by
 * neither product, but moving them now means editing three live Meta channels
 * (Instagram, Messenger, WhatsApp) that are in production use, for a refactor
 * that buys nothing until a third consumer exists.
 *
 * Extract when: a third consumer appears, or one of these functions needs a
 * behavior change. Until then the duplication is ~40 lines of pure functions
 * with full test coverage on both sides.
 * ──────────────────────────────────────────────────────────────────────────
 */

export const SOCIAL_ADS_OAUTH_SESSION_TTL_MS = 15 * 60 * 1000;

export const SOCIAL_META_ADS_CALLBACK_URL_ENV =
  'SOCIAL_META_ADS_OAUTH_CALLBACK_URL';

export const SOCIAL_META_ADS_LOGIN_CONFIG_ID_ENV =
  'SOCIAL_META_ADS_LOGIN_CONFIG_ID';

export const MAX_OAUTH_STATE_LENGTH = 512;

/**
 * Read-only scopes. `ads_management` is deliberately absent: nothing in Lyra
 * Social writes to a campaign, and requesting write access "for later" would
 * hand the platform a capability no code path is governed to use
 * (campaigns-ads-blueprint.md §5).
 */
export const SOCIAL_META_ADS_SCOPES = ['ads_read', 'business_management'];

export type MetaAdsLoginConfig = {
  appId: string;
  configId: string;
  authorizationEndpoint: string;
};

export type MetaAdsCallbackInput = {
  code?: string;
  state?: string;
  error?: string;
  errorReason?: string;
  errorDescription?: string;
};

export function hashOAuthState(state: string) {
  return createHash('sha256').update(state).digest('hex');
}

export function isAcceptableOAuthState(
  state: string | undefined,
): state is string {
  return Boolean(state) && (state as string).length <= MAX_OAUTH_STATE_LENGTH;
}

export function parseHttpUrl(value: string, label: string) {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new BadRequestException(`${label} must be a valid URL.`);
  }

  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw new BadRequestException(`${label} must use HTTP or HTTPS.`);
  }

  return url;
}

export function requireConfiguredUrl(name: string) {
  const value = process.env[name];
  if (!value) {
    throw new BadRequestException(`${name} is not configured.`);
  }

  return parseHttpUrl(value, name);
}

/**
 * The Social Ads callback is its own whitelisted redirect URI, separate from
 * `META_FACEBOOK_OAUTH_CALLBACK_URL`. Sharing the Inbox callback would route
 * ads authorizations through the messaging channel router and make Social
 * depend on it.
 */
export function requireSocialMetaAdsCallbackUrl() {
  return requireConfiguredUrl(SOCIAL_META_ADS_CALLBACK_URL_ENV);
}

/**
 * Where the browser lands after the provider redirect. Falls back to the
 * platform frontend because Lyra Social is served by the same agency web app,
 * not by a product-specific host.
 */
export function requireSocialFrontendUrl() {
  // `||`, not `??`: an operator who copies `SOCIAL_FRONTEND_URL=` out of
  // .env.example leaves an empty string, and `??` would accept it as a
  // configured value — breaking the callback redirect instead of falling back.
  const value =
    process.env.SOCIAL_FRONTEND_URL?.trim() ||
    process.env.APP_FRONTEND_URL?.trim();

  if (!value) {
    throw new BadRequestException('Social frontend URL is not configured.');
  }

  return parseHttpUrl(value, 'Social frontend URL');
}

export function buildFacebookLoginAuthorizationUrl(input: {
  loginConfig: MetaAdsLoginConfig;
  callbackUrl: URL;
  state: string;
}) {
  const authorizationUrl = new URL(input.loginConfig.authorizationEndpoint);
  authorizationUrl.searchParams.set('client_id', input.loginConfig.appId);
  authorizationUrl.searchParams.set(
    'redirect_uri',
    input.callbackUrl.toString(),
  );
  authorizationUrl.searchParams.set('response_type', 'code');
  authorizationUrl.searchParams.set('override_default_response_type', 'true');
  authorizationUrl.searchParams.set('config_id', input.loginConfig.configId);
  authorizationUrl.searchParams.set('state', input.state);

  return authorizationUrl;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
