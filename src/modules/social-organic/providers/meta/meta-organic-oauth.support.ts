import { BadRequestException } from '@nestjs/common';
import {
  buildFacebookLoginAuthorizationUrl,
  parseHttpUrl,
  requireConfiguredUrl,
  type FacebookLoginConfig,
} from '../../../../common/meta/meta-oauth.support';

export const SOCIAL_META_APP_ID_ENV = 'SOCIAL_META_APP_ID';
export const SOCIAL_META_APP_SECRET_ENV = 'SOCIAL_META_APP_SECRET';
export const SOCIAL_META_LEGACY_ADS_APP_ID_ENV = 'SOCIAL_META_ADS_APP_ID';
export const SOCIAL_META_LEGACY_ADS_APP_SECRET_ENV =
  'SOCIAL_META_ADS_APP_SECRET';
export const SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID_ENV =
  'SOCIAL_META_ORGANIC_LOGIN_CONFIG_ID';
export const SOCIAL_META_ORGANIC_CALLBACK_URL_ENV =
  'SOCIAL_META_ORGANIC_OAUTH_CALLBACK_URL';

/**
 * Explicitly pinned for the Organic client. It must not inherit the Messaging
 * app's META_GRAPH_API_VERSION or accept an unversioned/"latest" endpoint.
 */
export const META_ORGANIC_GRAPH_API_VERSION = 'v24.0';
export const META_ORGANIC_GRAPH_ORIGIN = 'https://graph.facebook.com';
export const META_ORGANIC_AUTHORIZATION_ORIGIN = 'https://www.facebook.com';

/**
 * This persisted provider key identifies the Facebook Login Organic surface.
 * A future direct Instagram Login hook must use a distinct persisted provider
 * key, or introduce a first-class schema discriminator before implementation;
 * it must not hide the login origin in metadata.
 */
export const META_ORGANIC_PROVIDER = 'meta';

/**
 * `MA1` requested only discovery scopes. `MA1.1` adds the two v1 publishing
 * scopes already configured on the App/Login Config externally
 * (`EXT-META-1`) — `pages_manage_posts` and `instagram_content_publish` —
 * so the persisted grant actually covers what `MA3`'s adapters will need to
 * call. Moderation/comments/insights/ads/messaging scopes are deliberately
 * NOT requested here; they belong to later, separately-scoped capability
 * work, never added "just in case" (`meta-organic.boundary.spec.ts` and
 * `meta-organic-oauth.provider.spec.ts` assert a closed list against this
 * exact array). Facebook Login for Business applies these permissions
 * through `config_id`, not a `scope` URL parameter — this array is the
 * expected/persisted grant contract, read by `provider.configuration.scopes`
 * and stamped onto every `exchangeCode()` result, not something serialized
 * into `buildMetaOrganicAuthorizationUrl`'s query string.
 *
 * A token persisted before this change carries only the four discovery
 * scopes and does NOT include the two publishing scopes below — it must be
 * re-authorized (a fresh OAuth round-trip) before any `MA3` publish call,
 * or Meta will reject the call for a missing permission. Nothing here
 * upgrades an already-persisted connection automatically.
 */
export const SOCIAL_META_ORGANIC_SCOPES = [
  'business_management',
  'pages_show_list',
  'pages_read_engagement',
  'instagram_basic',
  'pages_manage_posts',
  'instagram_content_publish',
] as const;

export type MetaOrganicLoginConfig = FacebookLoginConfig;

function configuredValue(name: string): string | null {
  return process.env[name]?.trim() || null;
}

/**
 * The Social app identity is shared by Ads and Organic. The legacy Ads-named
 * values remain a one-release fallback, but Messaging META_APP_* values are
 * deliberately never considered.
 */
export function requireSocialMetaAppId(): string {
  const value =
    configuredValue(SOCIAL_META_APP_ID_ENV) ||
    configuredValue(SOCIAL_META_LEGACY_ADS_APP_ID_ENV);

  if (!value) {
    throw new BadRequestException(
      `${SOCIAL_META_APP_ID_ENV} is not configured.`,
    );
  }

  return value;
}

export function requireSocialMetaAppSecret(): string {
  const value =
    configuredValue(SOCIAL_META_APP_SECRET_ENV) ||
    configuredValue(SOCIAL_META_LEGACY_ADS_APP_SECRET_ENV);

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
