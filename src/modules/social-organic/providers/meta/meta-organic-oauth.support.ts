import { BadRequestException } from '@nestjs/common';
import {
  buildFacebookLoginAuthorizationUrl,
  parseHttpUrl,
  requireConfiguredUrl,
  type FacebookLoginConfig,
} from '../../../../common/meta/meta-oauth.support';

export const SOCIAL_META_APP_ID_ENV = 'SOCIAL_META_APP_ID';
export const SOCIAL_META_APP_SECRET_ENV = 'SOCIAL_META_APP_SECRET';
export const SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID_ENV =
  'SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID';
export const SOCIAL_META_ORGANIC_CALLBACK_URL_ENV =
  'SOCIAL_META_ORGANIC_OAUTH_CALLBACK_URL';
export const SOCIAL_META_INSTAGRAM_APP_ID_ENV =
  'SOCIAL_META_ORGANIC_INSTAGRAM_APP_ID';
export const SOCIAL_META_INSTAGRAM_APP_SECRET_ENV =
  'SOCIAL_META_ORGANIC_INSTAGRAM_APP_SECRET';
export const SOCIAL_META_INSTAGRAM_CALLBACK_URL_ENV =
  'SOCIAL_META_ORGANIC_INSTAGRAM_OAUTH_CALLBACK_URL';

/**
 * One protocol version across the Meta clients, configured once at process
 * boot. Sharing this value does not share app identity, credentials, OAuth
 * configuration, callbacks or storage between Messaging, Ads and Organic.
 *
 * The fallback is deliberately a concrete version: an unversioned/"latest"
 * endpoint can change its response contract without a deploy. A malformed
 * configured value fails boot instead of silently producing unversioned URLs.
 */
export const META_ORGANIC_GRAPH_API_VERSION = readMetaGraphApiVersion();
export const META_ORGANIC_GRAPH_ORIGIN = 'https://graph.facebook.com';
export const META_ORGANIC_AUTHORIZATION_ORIGIN = 'https://www.facebook.com';
export const META_INSTAGRAM_GRAPH_ORIGIN = 'https://graph.instagram.com';
export const META_INSTAGRAM_AUTHORIZATION_ORIGIN = 'https://www.instagram.com';
export const META_INSTAGRAM_TOKEN_ORIGIN = 'https://api.instagram.com';

function readMetaGraphApiVersion(): string {
  const value = process.env.META_GRAPH_API_VERSION?.trim() || 'v26.0';
  if (!/^v\d+\.\d+$/.test(value)) {
    throw new Error('META_GRAPH_API_VERSION must be a pinned version.');
  }
  return value;
}

/**
 * This persisted provider key identifies the Facebook Login Organic surface.
 * Direct Instagram Login has its own key so a channel never silently changes
 * its authorization origin or token semantics.
 */
export const META_ORGANIC_PROVIDER = 'meta';
export const META_INSTAGRAM_PROVIDER = 'instagram';

/**
 * `MA1` requested discovery scopes and `MA1.1` added the two v1 publishing
 * scopes. Organic Analytics prerequisite `A1.1` adds exactly the two read
 * scopes needed by the forthcoming ingest: `read_insights` and
 * `instagram_manage_insights`. Moderation, comments, Ads, Messaging and admin
 * scopes remain deliberately excluded (`meta-organic.boundary.spec.ts` and
 * `meta-organic-oauth.provider.spec.ts` assert a closed list against this
 * exact array). Facebook Login for Business applies these permissions
 * through `config_id`, not a `scope` URL parameter — this array is the
 * expected/persisted grant contract, read by `provider.configuration.scopes`
 * and stamped onto every `exchangeCode()` result, not something serialized
 * into `buildMetaOrganicAuthorizationUrl`'s query string.
 *
 * A token persisted before this change does NOT acquire the analytics scopes
 * automatically. It must be re-authorized through the existing `config_id`
 * flow before A2 may use it.
 */
export const SOCIAL_META_ORGANIC_SCOPES = [
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'pages_manage_posts',
  'instagram_content_publish',
  'read_insights',
  'instagram_manage_insights',
] as const;

export type MetaOrganicLoginConfig = FacebookLoginConfig;

function configuredValue(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/**
 * Organic must never fall back to Ads credentials. A Login for Business
 * `config_id` belongs to the exact Meta app that starts the flow, so using an
 * Ads app id here can make the user see the Ads login configuration instead.
 */
export function requireSocialMetaAppId(): string {
  const value = configuredValue(SOCIAL_META_APP_ID_ENV);

  if (!value) {
    throw new BadRequestException(
      `${SOCIAL_META_APP_ID_ENV} is not configured.`,
    );
  }

  return value;
}

export function requireSocialMetaAppSecret(): string {
  const value = configuredValue(SOCIAL_META_APP_SECRET_ENV);

  if (!value) {
    throw new BadRequestException(
      `${SOCIAL_META_APP_SECRET_ENV} is not configured.`,
    );
  }

  return value;
}

export function requireSocialMetaOrganicLoginConfigId(): string {
  const value = configuredValue(SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID_ENV);

  if (!value) {
    throw new BadRequestException(
      `${SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID_ENV} is not configured.`,
    );
  }

  return value;
}

export function requireSocialMetaOrganicCallbackUrl(): URL {
  return requireConfiguredUrl(SOCIAL_META_ORGANIC_CALLBACK_URL_ENV);
}

/**
 * Instagram Login can use a dedicated Instagram app identity. When the
 * configured Meta app exposes both login products, the explicitly Organic
 * app identity is a safe fallback; Ads credentials are never considered.
 */
export function requireSocialMetaInstagramAppId(): string {
  return (
    configuredValue(SOCIAL_META_INSTAGRAM_APP_ID_ENV) ??
    requireSocialMetaAppId()
  );
}

export function requireSocialMetaInstagramAppSecret(): string {
  return (
    configuredValue(SOCIAL_META_INSTAGRAM_APP_SECRET_ENV) ??
    requireSocialMetaAppSecret()
  );
}

/**
 * One callback is valid for both login products when it is registered in
 * both products. The callback resolves the provider from the single-use
 * state, never from a URL chosen by the browser.
 */
export function requireSocialMetaInstagramCallbackUrl(): URL {
  const configured = configuredValue(SOCIAL_META_INSTAGRAM_CALLBACK_URL_ENV);
  return configured
    ? parseHttpUrl(configured, SOCIAL_META_INSTAGRAM_CALLBACK_URL_ENV)
    : requireSocialMetaOrganicCallbackUrl();
}

export function requireSocialOrganicFrontendUrl(): URL {
  const value =
    configuredValue('SOCIAL_FRONTEND_URL') ||
    configuredValue('APP_FRONTEND_URL');

  if (!value) {
    throw new BadRequestException('Social frontend URL is not configured.');
  }

  return parseHttpUrl(value, 'Social frontend URL');
}

export function buildSocialOrganicFrontendRedirectUrl(): URL {
  return new URL('/social/settings', requireSocialOrganicFrontendUrl());
}

export function buildMetaOrganicAuthorizationUrl(input: {
  loginConfig: MetaOrganicLoginConfig;
  callbackUrl: URL;
  state: string;
}): URL {
  return buildFacebookLoginAuthorizationUrl(input);
}

export type MetaInstagramLoginConfig = {
  appId: string;
  authorizationEndpoint: string;
};

export const SOCIAL_META_INSTAGRAM_SCOPES = [
  'instagram_business_basic',
  'instagram_business_content_publish',
  'instagram_business_manage_insights',
] as const;

export function buildMetaInstagramAuthorizationUrl(input: {
  loginConfig: MetaInstagramLoginConfig;
  callbackUrl: URL;
  state: string;
}): URL {
  const url = new URL(input.loginConfig.authorizationEndpoint);
  url.searchParams.set('client_id', input.loginConfig.appId);
  url.searchParams.set('redirect_uri', input.callbackUrl.toString());
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', SOCIAL_META_INSTAGRAM_SCOPES.join(','));
  url.searchParams.set('state', input.state);
  return url;
}
