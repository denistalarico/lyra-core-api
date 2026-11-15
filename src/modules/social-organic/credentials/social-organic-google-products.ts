import type { GoogleProduct } from '../../social-google/google-oauth.constants';

/**
 * D-I1: organic providers whose `google_oauth` connection takes its token from
 * the shared Google authorization, and the Google product that backs each.
 *
 * Empty on purpose in OR0: `youtube` is not a `GoogleProduct` yet. YT1-BE adds
 * `youtube` to `GOOGLE_PRODUCTS` and `youtube: 'youtube'` here. A provider
 * missing from this map is refused (`unsupported_authorization_method`).
 */
const ORGANIC_GOOGLE_PRODUCTS: Readonly<Record<string, GoogleProduct>> =
  Object.freeze({});

export function googleProductForOrganicProvider(
  provider: string,
): GoogleProduct | null {
  return Object.prototype.hasOwnProperty.call(ORGANIC_GOOGLE_PRODUCTS, provider)
    ? ORGANIC_GOOGLE_PRODUCTS[provider]
    : null;
}
