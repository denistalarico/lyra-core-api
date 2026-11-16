import { BadRequestException } from '@nestjs/common';
import { requireConfiguredUrl } from '../../../../common/meta/meta-oauth.support';
import { SOCIAL_TIKTOK_ORGANIC_SCOPES } from './tiktok-capabilities';

export const SOCIAL_TIKTOK_CLIENT_KEY_ENV = 'SOCIAL_TIKTOK_CLIENT_KEY';
export const SOCIAL_TIKTOK_CLIENT_SECRET_ENV = 'SOCIAL_TIKTOK_CLIENT_SECRET';
export const SOCIAL_TIKTOK_ORGANIC_CALLBACK_URL_ENV =
  'SOCIAL_TIKTOK_ORGANIC_OAUTH_CALLBACK_URL';

export const TIKTOK_AUTHORIZATION_URL =
  'https://www.tiktok.com/v2/auth/authorize/';

export type TiktokLoginConfig = { clientKey: string; clientSecret: string };

function configured(name: string): string {
  const value = process.env[name]?.trim();
  // Empty means "not enabled yet", never a silent fallback to another app.
  if (!value) throw new BadRequestException(`${name} is not configured.`);
  return value;
}

export function requireTiktokLoginConfig(): TiktokLoginConfig {
  return {
    clientKey: configured(SOCIAL_TIKTOK_CLIENT_KEY_ENV),
    clientSecret: configured(SOCIAL_TIKTOK_CLIENT_SECRET_ENV),
  };
}

export function requireTiktokOrganicCallbackUrl(): URL {
  return requireConfiguredUrl(SOCIAL_TIKTOK_ORGANIC_CALLBACK_URL_ENV);
}

/** DOCUMENTED 2026-11-16: login-kit-web (`scope` is comma-separated). */
export function buildTiktokAuthorizationUrl(input: {
  loginConfig: TiktokLoginConfig;
  callbackUrl: URL;
  state: string;
}): URL {
  const url = new URL(TIKTOK_AUTHORIZATION_URL);
  url.searchParams.set('client_key', input.loginConfig.clientKey);
  url.searchParams.set('scope', SOCIAL_TIKTOK_ORGANIC_SCOPES.join(','));
  url.searchParams.set('redirect_uri', input.callbackUrl.toString());
  url.searchParams.set('state', input.state);
  url.searchParams.set('response_type', 'code');
  return url;
}
