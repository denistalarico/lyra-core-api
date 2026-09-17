import { BadRequestException } from '@nestjs/common';
import {
  buildFacebookLoginAuthorizationUrl,
  FacebookLoginConfig,
  hashOAuthState,
  isAcceptableOAuthState,
  MAX_OAUTH_STATE_LENGTH,
  parseHttpUrl,
  requireConfiguredUrl,
} from '../../../common/meta/meta-oauth.support';

/**
 * Facebook Login for Business primitives used by the Social Ads connection.
 *
 * ── EXTRACTION DONE (Task F1) ─────────────────────────────────────────────
 * `hashOAuthState`, `isAcceptableOAuthState`, `parseHttpUrl`,
 * `requireConfiguredUrl` and `buildFacebookLoginAuthorizationUrl` were
 * byte-for-byte equivalent to their counterparts in
 * `modules/inbox/channels/meta/oauth/facebook-login-oauth.support.ts`, and
 * organic Social (planned) became the third consumer the original comment
 * named as the extraction trigger. They now live in
 * `common/meta/meta-oauth.support.ts`, re-exported here so every existing
 * import path in this module keeps working unchanged.
 *
 * Inbox's copy in `facebook-login-oauth.support.ts` was deliberately left in
 * place: repointing three live, production Meta channels (Instagram,
 * Messenger, WhatsApp) at the shared module is a separate, separately-tested
 * step, not part of this extraction.
 *
 * Ads-specific things — `SOCIAL_META_ADS_*` env names, the read-only ads
 * scopes, and the Ads callback/frontend URL helpers — stay local to this
 * file, since none of them are provider-generic.
 * ──────────────────────────────────────────────────────────────────────────
 */

export {
  buildFacebookLoginAuthorizationUrl,
  hashOAuthState,
  isAcceptableOAuthState,
  MAX_OAUTH_STATE_LENGTH,
  parseHttpUrl,
  requireConfiguredUrl,
};

export const SOCIAL_ADS_OAUTH_SESSION_TTL_MS = 15 * 60 * 1000;

export const SOCIAL_META_ADS_CALLBACK_URL_ENV =
  'SOCIAL_META_ADS_OAUTH_CALLBACK_URL';

export const SOCIAL_META_ADS_LOGIN_CONFIG_ID_ENV =
  'SOCIAL_META_ADS_LOGIN_CONFIG_ID';

/**
 * Lyra Social authorizes against its own Meta App, not the platform's
 * messaging app.
 *
 * The login configuration named by `SOCIAL_META_ADS_LOGIN_CONFIG_ID` lives
 * inside the Social app, and Meta resolves a `config_id` only against the
 * `client_id` that owns it. Sending the Inbox app id with a Social config id
 * is the mismatch that makes the authorization dialog refuse the request, so
 * these two are read from their own variables and never fall back to
 * `META_APP_ID` / `META_APP_SECRET`.
 */
export const SOCIAL_META_ADS_APP_ID_ENV = 'SOCIAL_META_ADS_APP_ID';

export const SOCIAL_META_ADS_APP_SECRET_ENV = 'SOCIAL_META_ADS_APP_SECRET';

/**
 * The governed Boost flow creates a fully paused Meta hierarchy only after
 * preflight and explicit human confirmation. It therefore needs
 * `ads_management` in addition to the read and Business Manager scopes.
 *
 * Facebook Login for Business resolves the effective grants from its Meta
 * Login configuration; this list records the expected grant on the local
 * connection and is refreshed on every reconnect.
 */
export const SOCIAL_META_ADS_SCOPES = [
  'ads_read',
  'ads_management',
  'business_management',
];

export type MetaAdsLoginConfig = FacebookLoginConfig;

export type MetaAdsCallbackInput = {
  code?: string;
  state?: string;
  error?: string;
  errorReason?: string;
  errorDescription?: string;
};

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}
