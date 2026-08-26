import {
  formatScaledAmount,
  parseAmountText,
  parseCountText,
  parseScaledAmount,
} from './metric-number';

describe('parseAmountText', () => {
  it('keeps a money value exact, at the column scale', () => {
    expect(parseAmountText('13.42')).toBe('13.420000');
    expect(parseAmountText('0')).toBe('0.000000');
    expect(parseAmountText('140.54')).toBe('140.540000');
  });

  it('keeps an amount no double could represent exactly', () => {
    // 0.1 + 0.2 in binary floating point is 0.30000000000000004. Summed over a
    // quarter of daily spend, that drift lands in an invoice.
    const total =
      parseScaledAmount('0.1')! +
      parseScaledAmount('0.2')! +
      parseScaledAmount('0.3')!;

    expect(formatScaledAmount(total)).toBe('0.600000');
  });

  it('rounds beyond six places the way the column would', () => {
    expect(parseAmountText('1.0000005')).toBe('1.000001');
    expect(parseAmountText('1.0000004')).toBe('1.000000');
  });

  it('refuses a negative amount instead of storing one', () => {
    // The table's CHECK rejects it too. A negative here is a parsing failure
    // upstream, not a fact.
    expect(parseAmountText('-1')).toBeNull();
    expect(parseAmountText('-0.01')).toBeNull();
  });

  it('refuses text that is not a number', () => {
    expect(parseAmountText('13,42')).toBeNull();
    expect(parseAmountText('1e3')).toBeNull();
    expect(parseAmountText('NaN')).toBeNull();
    expect(parseAmountText('')).toBeNull();
    expect(parseAmountText(null)).toBeNull();
    expect(parseAmountText({})).toBeNull();
  });

  it('refuses an amount beyond what numeric(18,6) holds', () => {
    expect(parseAmountText('1000000000000')).toBeNull();
    expect(parseAmountText('999999999999.999999')).toBe('999999999999.999999');
  });
});

describe('parseCountText', () => {
  it('reads a count as a whole number string', () => {
    expect(parseCountText('5351')).toBe('5351');
    expect(parseCountText(0)).toBe('0');
  });

  it('keeps a count above the float-safe range exactly', () => {
    // 2^53 + 1: a number that JS cannot represent, and a bigint column can.
    expect(parseCountText('9007199254740993')).toBe('9007199254740993');
  });

  it('refuses a fractional count', () => {
    // Fractional means the wrong field is being read: attribution-split values
    // belong to the numeric columns, not to impressions.
    expect(parseCountText('1.5')).toBeNull();
  });

  it('refuses a negative count and anything unreadable', () => {
    expect(parseCountText('-1')).toBeNull();
    expect(parseCountText('many')).toBeNull();
    expect(parseCountText(undefined)).toBeNull();
  });

  it('refuses a count past the bigint ceiling', () => {
    expect(parseCountText('9223372036854775807')).toBe('9223372036854775807');
    expect(parseCountText('9223372036854775808')).toBeNull();
  });
});
