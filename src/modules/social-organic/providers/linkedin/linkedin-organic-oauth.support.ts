import { BadRequestException } from '@nestjs/common';
import { requireConfiguredUrl } from '../../../../common/meta/meta-oauth.support';
import { LINKEDIN_AUTHORIZATION_URL } from '../../../social-integrations/oauth/linkedin-ads-oauth.support';
import { SOCIAL_LINKEDIN_ORGANIC_SCOPES } from './linkedin-capabilities';

export {
  LINKEDIN_TOKEN_URL,
  readLinkedInApiVersion,
} from '../../../social-integrations/oauth/linkedin-ads-oauth.support';

export const SOCIAL_LINKEDIN_CLIENT_ID_ENV = 'SOCIAL_LINKEDIN_CLIENT_ID';
export const SOCIAL_LINKEDIN_CLIENT_SECRET_ENV =
  'SOCIAL_LINKEDIN_CLIENT_SECRET';
export const SOCIAL_LINKEDIN_ORGANIC_CALLBACK_URL_ENV =
  'SOCIAL_LINKEDIN_ORGANIC_OAUTH_CALLBACK_URL';
/** §12.4: `development` (default) keeps the 500 calls/day budget on. */
export const SOCIAL_LINKEDIN_CMA_TIER_ENV = 'SOCIAL_LINKEDIN_CMA_TIER';

/** Client credentials of the "Lyra Social Pages" app; never the Ads app. */
export type LinkedInOrganicLoginConfig = {
  clientId: string;
  clientSecret: string;
};

function configured(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new BadRequestException(`${name} is not configured.`);
  return value;
}

export function requireLinkedInOrganicLoginConfig(): LinkedInOrganicLoginConfig {
  return {
    clientId: configured(SOCIAL_LINKEDIN_CLIENT_ID_ENV),
    clientSecret: configured(SOCIAL_LINKEDIN_CLIENT_SECRET_ENV),
  };
}

export function requireLinkedInOrganicCallbackUrl(): URL {
  return requireConfiguredUrl(SOCIAL_LINKEDIN_ORGANIC_CALLBACK_URL_ENV);
}

/** Anything but an explicit `standard` keeps the Development budget. */
export function linkedInCmaBudgetEnabled(): boolean {
  return (
    (process.env[SOCIAL_LINKEDIN_CMA_TIER_ENV]?.trim().toLowerCase() ||
      'development') !== 'standard'
  );
}

/** https://learn.microsoft.com/en-us/linkedin/shared/authentication/authorization-code-flow */
export function buildLinkedInOrganicAuthorizationUrl(input: {
  loginConfig: LinkedInOrganicLoginConfig;
  callbackUrl: URL;
  state: string;
}): URL {
  const url = new URL(LINKEDIN_AUTHORIZATION_URL);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('client_id', input.loginConfig.clientId);
  url.searchParams.set('redirect_uri', input.callbackUrl.toString());
  url.searchParams.set('state', input.state);
  url.searchParams.set('scope', SOCIAL_LINKEDIN_ORGANIC_SCOPES.join(' '));
  return url;
}
