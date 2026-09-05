import {
  DEFAULT_MINOR_UNIT_EXPONENT,
  fromMinorUnits,
  minorUnitExponent,
  toMinorUnits,
} from './intelligence-minor-units';

/**
 * The conversion that keeps spend exact inside a `bigint` column.
 *
 * Every case here is one that a naive `Math.round(amount * 100)` gets wrong, or
 * one that proves it does not — because the whole reason this module exists is
 * that the naive version is right often enough to ship and wrong often enough
 * to matter.
 */
describe('minor units', () => {
  describe('exponents', () => {
    it('defaults to two decimal places', () => {
      expect(minorUnitExponent('BRL')).toBe(2);
      expect(minorUnitExponent('USD')).toBe(2);
      expect(DEFAULT_MINOR_UNIT_EXPONENT).toBe(2);
    });

    /**
     * The case a hardcoded `* 100` reports a hundredfold too high.
     *
     * ¥1000 is one thousand yen, not ten. An advertiser's Japanese spend
     * entering a benchmark inflated by 100× would look like an outlier and, at
     * p75, would look like a plausible high spender.
     */
    it('knows zero-decimal currencies', () => {
      expect(minorUnitExponent('JPY')).toBe(0);
      expect(minorUnitExponent('KRW')).toBe(0);
      expect(minorUnitExponent('CLP')).toBe(0);
    });

    it('knows three-decimal currencies', () => {
      expect(minorUnitExponent('KWD')).toBe(3);
      expect(minorUnitExponent('BHD')).toBe(3);
      expect(minorUnitExponent('TND')).toBe(3);
    });

    it('is case and whitespace insensitive', () => {
      expect(minorUnitExponent(' jpy ')).toBe(0);
    });

    /**
     * An unknown code gets the default rather than an exception.
     *
     * Deliberate: a currency Meta bills tomorrow must not take the contribution
     * path down. A failed contribution is a contributor silently missing from a
     * cohort, which changes a benchmark without changing anything visible.
     */
    it('falls back to the default for an unknown code', () => {
      expect(minorUnitExponent('ZZZ')).toBe(2);
    });
  });

  describe('toMinorUnits', () => {
    /**
     * The float trap, with the real production value.
     *
     * `6.64 * 100` is `663.9999999999999` in IEEE-754. This path never
     * multiplies, so the digits arrive intact.
     */
    it('converts the real observed spend exactly', () => {
      expect(toMinorUnits('6.64', 'BRL')).toBe(664n);
      expect(toMinorUnits('0.23', 'BRL')).toBe(23n);
      expect(toMinorUnits('12.22', 'BRL')).toBe(1222n);
    });

    it('pads a short or absent fraction', () => {
      expect(toMinorUnits('5', 'BRL')).toBe(500n);
      expect(toMinorUnits('5.1', 'BRL')).toBe(510n);
      expect(toMinorUnits('0', 'BRL')).toBe(0n);
    });

    it('applies the currency exponent, not a constant', () => {
      expect(toMinorUnits('1000', 'JPY')).toBe(1000n);
      expect(toMinorUnits('1.234', 'KWD')).toBe(1234n);
    });

    /**
     * Excess precision rounds half-up rather than truncating.
     *
     * Truncation biases every conversion toward zero. Across a thousand
     * contributions that is a systematic understatement, not noise — it does not
     * average out, and it would shift every percentile down.
     */
    it('rounds excess precision half-up', () => {
      expect(toMinorUnits('1.005', 'BRL')).toBe(101n);
      expect(toMinorUnits('1.004', 'BRL')).toBe(100n);
      expect(toMinorUnits('1.9999', 'BRL')).toBe(200n);
    });

    it('handles values beyond Number.MAX_SAFE_INTEGER', () => {
      expect(toMinorUnits('99999999999999999.99', 'BRL')).toBe(
        9999999999999999999n,
      );
    });

    it('accepts a number as well as a string', () => {
      expect(toMinorUnits(6.64, 'BRL')).toBe(664n);
    });

    it('refuses anything that is not a non-negative decimal', () => {
      expect(() => toMinorUnits('-1.00', 'BRL')).toThrow();
      expect(() => toMinorUnits('abc', 'BRL')).toThrow();
      expect(() => toMinorUnits('', 'BRL')).toThrow();
      expect(() => toMinorUnits(Number.NaN, 'BRL')).toThrow();
      expect(() => toMinorUnits(Number.POSITIVE_INFINITY, 'BRL')).toThrow();
    });
  });

  describe('round trip', () => {
    it.each([
      ['6.64', 'BRL'],
      ['0.01', 'USD'],
      ['1000', 'JPY'],
      ['1.234', 'KWD'],
      ['123456.78', 'EUR'],
    ])('restores %s %s', (amount, currency) => {
      const minor = toMinorUnits(amount, currency);
      const restored = fromMinorUnits(minor, currency);

      expect(Number(restored)).toBeCloseTo(Number(amount), 6);
    });

    it('returns a string, never a float', () => {
      expect(fromMinorUnits(664n, 'BRL')).toBe('6.64');
      expect(fromMinorUnits(1000n, 'JPY')).toBe('1000');
      expect(fromMinorUnits(1234n, 'KWD')).toBe('1.234');
    });
  });
});
