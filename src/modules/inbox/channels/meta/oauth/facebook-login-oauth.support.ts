import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Facebook Login for Business primitives shared by every Meta channel that
 * authorizes through the same Meta App (Instagram via Facebook, Messenger).
 * Only provider-generic behavior lives here; asset selection and channel
 * persistence stay channel-specific.
 */

export const FACEBOOK_LOGIN_SESSION_TTL_MS = 15 * 60 * 1000;
export const FACEBOOK_LOGIN_OAUTH_STARTED_STAGE = 'oauth_started';
export const FACEBOOK_LOGIN_ASSET_SELECTION_STAGE = 'asset_selection';
export const FACEBOOK_LOGIN_CALLBACK_URL_ENV =
  'META_FACEBOOK_OAUTH_CALLBACK_URL';
export const FACEBOOK_LOGIN_MAX_STATE_LENGTH = 512;

export type FacebookLoginConfig = {
  appId: string;
  configId: string;
  authorizationEndpoint: string;
};

export type FacebookLoginCallbackInput = {
  code?: string;
  state?: string;
  error?: string;
  errorReason?: string;
  errorDescription?: string;
};

export function hashFacebookOAuthState(state: string) {
  return createHash('sha256').update(state).digest('hex');
}

export function isAcceptableFacebookOAuthState(
  state: string | undefined,
): state is string {
  return (
    Boolean(state) &&
    (state as string).length <= FACEBOOK_LOGIN_MAX_STATE_LENGTH
  );
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

export function requireFacebookLoginCallbackUrl() {
  return requireConfiguredUrl(FACEBOOK_LOGIN_CALLBACK_URL_ENV);
}

export function requireLeadFlowFrontendUrl() {
  const value =
    process.env.LEADFLOW_FRONTEND_URL ?? process.env.APP_FRONTEND_URL;
  if (!value) {
    throw new BadRequestException('LeadFlow frontend URL is not configured.');
  }

  return parseHttpUrl(value, 'LeadFlow frontend URL');
}

export function buildFacebookLoginAuthorizationUrl(input: {
  loginConfig: FacebookLoginConfig;
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
