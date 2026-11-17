import { BadRequestException } from '@nestjs/common';
import { requireConfiguredUrl } from '../../../../common/meta/meta-oauth.support';

/** Same app as TikTok Ads (API for Business): one App ID/secret for both. */
export const SOCIAL_TIKTOK_BUSINESS_APP_ID_ENV =
  'SOCIAL_TIKTOK_BUSINESS_APP_ID';
export const SOCIAL_TIKTOK_BUSINESS_APP_SECRET_ENV =
  'SOCIAL_TIKTOK_BUSINESS_APP_SECRET';
/**
 * "TikTok account holder authorization URL", copied from My Apps → App Detail
 * → Basic Information. TikTok generates it (client key, scopes, redirect);
 * Lyra only appends `state`.
 */
export const SOCIAL_TIKTOK_ACCOUNT_AUTHORIZATION_URL_ENV =
  'SOCIAL_TIKTOK_ACCOUNT_AUTHORIZATION_URL';
/** The active "TikTok account holder redirect URL". It must end with `/`. */
export const SOCIAL_TIKTOK_ACCOUNT_CALLBACK_URL_ENV =
  'SOCIAL_TIKTOK_ACCOUNT_OAUTH_CALLBACK_URL';

export type TiktokBusinessAppConfig = { appId: string; secret: string };

function configured(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new BadRequestException(`${name} is not configured.`);
  return value;
}

export function requireTiktokBusinessAppConfig(): TiktokBusinessAppConfig {
  return {
    appId: configured(SOCIAL_TIKTOK_BUSINESS_APP_ID_ENV),
    secret: configured(SOCIAL_TIKTOK_BUSINESS_APP_SECRET_ENV),
  };
}

export function requireTiktokAccountCallbackUrl(): URL {
  const url = requireConfiguredUrl(SOCIAL_TIKTOK_ACCOUNT_CALLBACK_URL_ENV);
  // DOCUMENTED: absolute https URL ending with `/`, no query or fragment.
  if (url.protocol !== 'https:' || !url.pathname.endsWith('/') || url.search) {
    throw new BadRequestException(
      `${SOCIAL_TIKTOK_ACCOUNT_CALLBACK_URL_ENV} must be an https URL ending with "/".`,
    );
  }
  return url;
}

/** The portal URL plus Lyra's single-use `state` (CSRF), echoed on redirect. */
export function buildTiktokAccountAuthorizationUrl(state: string): URL {
  const url = requireConfiguredUrl(SOCIAL_TIKTOK_ACCOUNT_AUTHORIZATION_URL_ENV);
  if (url.protocol !== 'https:' || !/(^|\.)tiktok\.com$/.test(url.hostname)) {
    throw new BadRequestException(
      `${SOCIAL_TIKTOK_ACCOUNT_AUTHORIZATION_URL_ENV} must be the tiktok.com authorization URL.`,
    );
  }
  url.searchParams.set('state', state);
  return url;
}
