/**
 * Google OAuth foundation for Lyra Social (G0.4.2).
 *
 * One authorization per (tenant, workspace, company context) carries every
 * Google product the context has connected. Scopes are requested per product
 * and accumulated through incremental authorization, so connecting GA4 never
 * asks for Ads or Business Profile.
 */
export const GOOGLE_PRODUCTS = ['ga4', 'ads', 'business_profile'] as const;
export type GoogleProduct = (typeof GOOGLE_PRODUCTS)[number];

export const GOOGLE_IDENTITY_SCOPE = 'openid';

/** Exactly one scope per product; nothing beyond what each phase justifies. */
export const GOOGLE_PRODUCT_SCOPES: Record<GoogleProduct, string> = {
  ga4: 'https://www.googleapis.com/auth/analytics.readonly',
  ads: 'https://www.googleapis.com/auth/adwords',
  business_profile: 'https://www.googleapis.com/auth/business.manage',
};

export function isGoogleProduct(value: unknown): value is GoogleProduct {
  return (
    typeof value === 'string' &&
    (GOOGLE_PRODUCTS as readonly string[]).includes(value)
  );
}

/** Scopes requested for one product: identity + that product only. */
export function scopesForProduct(product: GoogleProduct): string[] {
  return [GOOGLE_IDENTITY_SCOPE, GOOGLE_PRODUCT_SCOPES[product]];
}

export const GOOGLE_OAUTH_SESSION_TTL_MS = 15 * 60 * 1000;
/** A token this close to expiry is refreshed before use. */
export const GOOGLE_ACCESS_TOKEN_SKEW_MS = 60 * 1000;

export const SOCIAL_GOOGLE_CLIENT_ID_ENV = 'SOCIAL_GOOGLE_CLIENT_ID';
export const SOCIAL_GOOGLE_CLIENT_SECRET_ENV = 'SOCIAL_GOOGLE_CLIENT_SECRET';
export const SOCIAL_GOOGLE_CALLBACK_URL_ENV =
  'SOCIAL_GOOGLE_OAUTH_CALLBACK_URL';

/**
 * Server-side Google Ads settings (read at call time, never persisted).
 * There is no developer token: it was sunset on 2026-09-09 and must not be sent.
 */
export const GOOGLE_ADS_API_VERSION_ENV = 'GOOGLE_ADS_API_VERSION';
export const GOOGLE_ADS_DEFAULT_API_VERSION = 'v25';
/** Optional manager (MCC) customer id used to enumerate child accounts. */
export const SOCIAL_GOOGLE_ADS_LOGIN_CUSTOMER_ID_ENV =
  'SOCIAL_GOOGLE_ADS_LOGIN_CUSTOMER_ID';

/** D-G3: GA4 properties selectable per context. */
export const GOOGLE_GA4_MAX_PROPERTIES = 5;

export const GOOGLE_AUTHORIZATION_ENDPOINT =
  'https://accounts.google.com/o/oauth2/v2/auth';
export const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
export const GOOGLE_REVOKE_ENDPOINT = 'https://oauth2.googleapis.com/revoke';
export const GOOGLE_ISSUERS = [
  'https://accounts.google.com',
  'accounts.google.com',
];

/** Path under the Social frontend where the browser lands after callback. */
export const SOCIAL_GOOGLE_CHANNEL_PATH = '/social/channels/google';

export type GoogleAuthorizationStatus =
  | 'connected'
  | 'reauth_required'
  | 'revoked';

export type GoogleProductLinkStatus = 'connected' | 'disconnected';

export type GoogleOAuthSessionStatus =
  | 'pending'
  | 'awaiting_confirmation'
  | 'consumed'
  | 'failed';

/**
 * How long a caller waits for the per-authorization row lock. A refresh holds
 * it across one Google call (10 s timeout), so a waiter gets a little more than
 * that and then fails fast instead of queueing indefinitely on a pool slot.
 */
export const GOOGLE_LOCK_TIMEOUT_MS = 15_000;
