/**
 * Normalizes a provider-supplied IANA timezone without ever inventing one.
 *
 * `Intl.DateTimeFormat` uses the runtime's IANA database and canonicalizes
 * aliases. Numeric offsets and `Etc/GMT±N` are refused: they are fixed-offset
 * representations and cannot safely bucket analytics across DST changes.
 */
export function normalizeIanaTimeZone(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'string') throw new Error('invalid_asset_timezone');

  const candidate = value.trim();
  if (!candidate || /^Etc\/GMT[+-]\d{1,2}$/i.test(candidate)) {
    throw new Error('invalid_asset_timezone');
  }

  try {
    return new Intl.DateTimeFormat('en-US', {
      timeZone: candidate,
    }).resolvedOptions().timeZone;
  } catch {
    throw new Error('invalid_asset_timezone');
  }
}
