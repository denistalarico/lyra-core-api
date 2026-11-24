import { BadRequestException } from '@nestjs/common';
import { requireConfiguredUrl } from '../../../../common/meta/meta-oauth.support';
import { SOCIAL_THREADS_SCOPES } from './threads-capabilities';

/** The Threads use case generates its own app ID/secret (≠ SOCIAL_META_APP_ID). */
export const SOCIAL_THREADS_APP_ID_ENV = 'SOCIAL_THREADS_APP_ID';
export const SOCIAL_THREADS_APP_SECRET_ENV = 'SOCIAL_THREADS_APP_SECRET';
/** `https://api.lyrasuite.com/api/social/organic/oauth/threads/callback`. */
export const SOCIAL_THREADS_CALLBACK_URL_ENV =
  'SOCIAL_THREADS_OAUTH_CALLBACK_URL';

export const THREADS_AUTHORIZATION_ENDPOINT =
  'https://threads.com/oauth/authorize';

export type ThreadsAppConfig = { appId: string; secret: string };

function configured(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new BadRequestException(`${name} is not configured.`);
  return value;
}

export function requireThreadsAppConfig(): ThreadsAppConfig {
  return {
    appId: configured(SOCIAL_THREADS_APP_ID_ENV),
    secret: configured(SOCIAL_THREADS_APP_SECRET_ENV),
  };
}

export function requireThreadsCallbackUrl(): URL {
  return requireConfiguredUrl(SOCIAL_THREADS_CALLBACK_URL_ENV);
}

/** DOCUMENTED: `client_id`, `redirect_uri`, comma-separated `scope`, `state`. */
export function buildThreadsAuthorizationUrl(input: {
  app: ThreadsAppConfig;
  callbackUrl: URL;
  state: string;
}): URL {
  const url = new URL(THREADS_AUTHORIZATION_ENDPOINT);
  url.searchParams.set('client_id', input.app.appId);
  url.searchParams.set('redirect_uri', input.callbackUrl.toString());
  url.searchParams.set('scope', SOCIAL_THREADS_SCOPES.join(','));
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('state', input.state);
  return url;
}
