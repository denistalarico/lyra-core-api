import { BadRequestException } from '@nestjs/common';
import { createHash } from 'crypto';

/**
 * Facebook Login for Business primitives shared by every Meta consumer in
 * this API — Social Ads and Inbox's messaging channels alike.
 *
 * Extracted from `social-integrations/oauth/meta-ads-oauth.support.ts`
 * (Task F1) once organic Social became a third consumer of code that was
 * already byte-for-byte duplicated between Social Ads and Inbox. Nothing
 * here knows about ads, messaging, or organic publishing — only the Facebook
 * Login for Business handshake itself.
 *
 * Inbox's `facebook-login-oauth.support.ts` still keeps its own copy for
 * now: repointing three live, production Meta channels (Instagram,
 * Messenger, WhatsApp) at this module is a separate, separately-tested step,
 * not part of this extraction.
 */

export const MAX_OAUTH_STATE_LENGTH = 512;

export type FacebookLoginConfig = {
  appId: string;
  configId: string;
  authorizationEndpoint: string;
};

export function hashOAuthState(state: string) {
  return createHash('sha256').update(state).digest('hex');
}

export function isAcceptableOAuthState(
  state: string | undefined,
): state is string {
  return Boolean(state) && (state as string).length <= MAX_OAUTH_STATE_LENGTH;
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
