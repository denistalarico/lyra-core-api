import type { GoogleProduct } from '../../social-google/google-oauth.constants';

/**
 * D-I1: organic providers whose `google_oauth` connection takes its token from
 * the shared Google authorization, and the Google product that backs each.
 *
 * A provider missing from this map is refused
 * (`unsupported_authorization_method`).
 */
const ORGANIC_GOOGLE_PRODUCTS: Readonly<Record<string, GoogleProduct>> =
  Object.freeze({ youtube: 'youtube' });

export function googleProductForOrganicProvider(
  provider: string,
): GoogleProduct | null {
  return Object.prototype.hasOwnProperty.call(ORGANIC_GOOGLE_PRODUCTS, provider)
    ? ORGANIC_GOOGLE_PRODUCTS[provider]
    : null;
}
