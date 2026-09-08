import { normalizeIanaTimeZone } from './social-organic-asset-timezone';

describe('normalizeIanaTimeZone', () => {
  it('accepts and canonicalizes an IANA timezone', () => {
    expect(normalizeIanaTimeZone(' America/Sao_Paulo ')).toBe(
      'America/Sao_Paulo',
    );
  });

  it.each(['', '-03:00', '+00:00', 'Etc/GMT+3', 'not/a-zone'])(
    'refuses a non-canonical or invalid timezone: %s',
    (value) => {
      expect(() => normalizeIanaTimeZone(value)).toThrow(
        'invalid_asset_timezone',
      );
    },
  );

  it('does not invent a timezone when the provider has none', () => {
    expect(normalizeIanaTimeZone(null)).toBeNull();
    expect(normalizeIanaTimeZone(undefined)).toBeNull();
  });
});
