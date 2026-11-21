/**
 * Which data origins may feed collective processing: the consented statistical
 * contribution and the cross-company benchmark built from it.
 *
 * Data obtained through Google APIs (Google Ads, Google Analytics 4, the Data
 * Manager API, YouTube and Business Profile) is excluded, including aggregated,
 * pseudonymised or derived values. The Google API Services User Data Policy's
 * Limited Use rules apply to "data aggregated, anonymized, or derived" from the
 * scopes, and the YouTube API Services Developer Policies (III.E.2) forbid
 * combining API Data from different content owners. This is a conservative
 * decision for the OAuth review; operational analytics of a company's own
 * context is not affected.
 *
 * Fail closed: a source that declares no origin is not eligible, and a source
 * mixing an eligible origin with a Google one is not eligible as a whole.
 */
const GOOGLE_API_DATA_ORIGINS: ReadonlySet<string> = new Set([
  // Google OAuth product keys (social-google).
  'ga4',
  'ads',
  'youtube',
  'business_profile',
  // Provider keys of the paid, organic and conversion pipelines.
  'google_ads',
  'google_analytics',
  'google_data_manager',
  'google_business_profile',
]);

/** Any spelling that names Google or YouTube, so a new key cannot slip in. */
const GOOGLE_ORIGIN_PATTERN = /google|youtube|(^|[^a-z0-9])ga4([^a-z0-9]|$)/i;

export function isGoogleApiDataOrigin(origin: string): boolean {
  const key = origin.trim().toLowerCase();
  return GOOGLE_API_DATA_ORIGINS.has(key) || GOOGLE_ORIGIN_PATTERN.test(key);
}

export function isCollectiveContributionEligible(
  origins: readonly string[] | null | undefined,
): boolean {
  return (
    Array.isArray(origins) &&
    origins.length > 0 &&
    origins.every(
      (origin) =>
        typeof origin === 'string' &&
        origin.trim().length > 0 &&
        !isGoogleApiDataOrigin(origin),
    )
  );
}
