import { fromScaled, sumByCurrency, toScaled } from './ai-cost-money';

describe('CS6-B exact AI cost money', () => {
  it('sums per currency without a float and never across currencies', () => {
    expect(
      sumByCurrency([
        { currency: 'USD', amount: '0.100000' },
        { currency: 'USD', amount: '0.200000' },
        { currency: 'BRL', amount: '1.5' },
        { currency: null, amount: null },
        { currency: 'USD', amount: '0.000001' },
      ]),
    ).toEqual([
      { currency: 'BRL', amount: '1.500000' },
      { currency: 'USD', amount: '0.300001' },
    ]);
    expect(sumByCurrency([])).toEqual([]);
  });

  it('round-trips decimals at 6 places and refuses garbage', () => {
    expect(fromScaled(toScaled('0.690012'))).toBe('0.690012');
    expect(fromScaled(toScaled('12'))).toBe('12.000000');
    expect(() => toScaled('-1')).toThrow('invalid decimal');
    expect(() => toScaled('1e3')).toThrow('invalid decimal');
  });
});
