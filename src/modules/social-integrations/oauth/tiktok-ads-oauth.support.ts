import { BadRequestException } from '@nestjs/common';
import { requireConfiguredUrl } from '../../../common/meta/meta-oauth.support';

export {
  hashOAuthState,
  isAcceptableOAuthState,
} from '../../../common/meta/meta-oauth.support';

export const SOCIAL_TIKTOK_BUSINESS_APP_ID_ENV =
  'SOCIAL_TIKTOK_BUSINESS_APP_ID';
export const SOCIAL_TIKTOK_BUSINESS_APP_SECRET_ENV =
  'SOCIAL_TIKTOK_BUSINESS_APP_SECRET';
/**
 * Used verbatim as `redirect_uri`: the TikTok portal registered it with a
 * trailing slash (U2), and the authorization only works if both match exactly.
 */
export const SOCIAL_TIKTOK_ADS_CALLBACK_URL_ENV =
  'SOCIAL_TIKTOK_ADS_OAUTH_CALLBACK_URL';

/**
 * Advertiser authorization page of TikTok API for Business. The scopes are the
 * ones granted to the app in the portal (Ad Account Management read + Reporting);
 * the URL carries none.
 * https://github.com/tiktok/tiktok-business-api-sdk (Authentication API)
 */
export const TIKTOK_AUTHORIZATION_URL =
  'https://business-api.tiktok.com/portal/auth';
export const TIKTOK_API_BASE_URL =
  'https://business-api.tiktok.com/open_api/v1.3';

export type TikTokAdsCallbackInput = {
  authCode?: string;
  state?: string;
  error?: string;
};

export type TikTokAdsAppConfig = { appId: string; secret: string };

/** App credentials of "Lyra Social"; never logged or returned. */
export function readTikTokAdsAppConfig(): TikTokAdsAppConfig {
  const appId = process.env[SOCIAL_TIKTOK_BUSINESS_APP_ID_ENV]?.trim();
  const secret = process.env[SOCIAL_TIKTOK_BUSINESS_APP_SECRET_ENV]?.trim();

  if (!appId || !secret) {
    throw new BadRequestException('TikTok Ads is not configured.');
  }

  return { appId, secret };
}

/** The configured callback, kept exactly as written (trailing slash included). */
export function requireTikTokAdsCallbackUrl(): string {
  // Validated as an http(s) URL, but returned as the raw string: `URL`
  // serialization is stable for this shape, yet the contract is "verbatim".
  requireConfiguredUrl(SOCIAL_TIKTOK_ADS_CALLBACK_URL_ENV);

  return (process.env[SOCIAL_TIKTOK_ADS_CALLBACK_URL_ENV] ?? '').trim();
}

export function buildTikTokAuthorizationUrl(input: {
  appId: string;
  callbackUrl: string;
  state: string;
}): URL {
  const url = new URL(TIKTOK_AUTHORIZATION_URL);
  url.searchParams.set('app_id', input.appId);
  url.searchParams.set('state', input.state);
  url.searchParams.set('redirect_uri', input.callbackUrl);

  return url;
}
