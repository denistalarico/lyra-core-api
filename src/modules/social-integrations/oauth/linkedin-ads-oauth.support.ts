import { BadRequestException } from '@nestjs/common';
import { requireConfiguredUrl } from '../../../common/meta/meta-oauth.support';

export {
  hashOAuthState,
  isAcceptableOAuthState,
} from '../../../common/meta/meta-oauth.support';

export const SOCIAL_LINKEDIN_ADS_CLIENT_ID_ENV =
  'SOCIAL_LINKEDIN_ADS_CLIENT_ID';
export const SOCIAL_LINKEDIN_ADS_CLIENT_SECRET_ENV =
  'SOCIAL_LINKEDIN_ADS_CLIENT_SECRET';
export const SOCIAL_LINKEDIN_ADS_CALLBACK_URL_ENV =
  'SOCIAL_LINKEDIN_ADS_OAUTH_CALLBACK_URL';
/** Read by every LinkedIn integration (`LinkedIn-Version: YYYYMM`). */
export const LINKEDIN_API_VERSION_ENV = 'LINKEDIN_API_VERSION';

/**
 * Read-only on purpose (D-I7): `r_ads` lists accounts/campaigns/creatives and
 * `r_ads_reporting` serves `adAnalytics`. `rw_ads` is never requested.
 * https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads/account-structure/create-and-manage-campaigns
 * https://learn.microsoft.com/en-us/linkedin/marketing/integrations/ads-reporting/ads-reporting
 */
export const SOCIAL_LINKEDIN_ADS_SCOPES = ['r_ads', 'r_ads_reporting'];

/** https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow */
export const LINKEDIN_AUTHORIZATION_URL =
  'https://www.linkedin.com/oauth/v2/authorization';
export const LINKEDIN_TOKEN_URL =
  'https://www.linkedin.com/oauth/v2/accessToken';

export type LinkedInAdsCallbackInput = {
  code?: string;
  state?: string;
  error?: string;
  errorDescription?: string;
};

export type LinkedInAdsAppConfig = {
  clientId: string;
  clientSecret: string;
};

/** Client credentials of the "Lyra Social Ads" app; never logged or returned. */
export function readLinkedInAdsAppConfig(): LinkedInAdsAppConfig {
  const clientId = process.env[SOCIAL_LINKEDIN_ADS_CLIENT_ID_ENV]?.trim();
  const clientSecret =
    process.env[SOCIAL_LINKEDIN_ADS_CLIENT_SECRET_ENV]?.trim();

  if (!clientId || !clientSecret) {
    throw new BadRequestException('LinkedIn Ads is not configured.');
  }

  return { clientId, clientSecret };
}

/** `YYYYMM`, from the environment: the version is never hard-coded. */
export function readLinkedInApiVersion(): string | null {
  const value = process.env[LINKEDIN_API_VERSION_ENV]?.trim();

  return value && /^\d{6}$/.test(value) ? value : null;
}

export function requireLinkedInAdsCallbackUrl(): URL {
  return requireConfiguredUrl(SOCIAL_LINKEDIN_ADS_CALLBACK_URL_ENV);
}

export function buildLinkedInAuthorizationUrl(input: {
  clientId: string;
  callbackUrl: URL;
  state: string;
}): URL {
  const url = new URL(LINKEDIN_AUTHORIZATION_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.clientId);
  url.searchParams.set('redirect_uri', input.callbackUrl.toString());
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', SOCIAL_LINKEDIN_ADS_SCOPES.join(' '));

  return url;
}
