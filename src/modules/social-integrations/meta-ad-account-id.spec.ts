import {
  CANONICAL_AD_ACCOUNT_ID_PATTERN,
  isSameAdAccountId,
  normalizeAdAccountId,
} from './meta-ad-account-id';

describe('normalizeAdAccountId', () => {
  it('accepts both spellings Meta uses for the same account', () => {
    expect(normalizeAdAccountId('act_415877197389621')).toBe(
      'act_415877197389621',
    );
    expect(normalizeAdAccountId('415877197389621')).toBe('act_415877197389621');
  });

  it('trims the surrounding whitespace an .env value tends to carry', () => {
    expect(normalizeAdAccountId('  act_123  ')).toBe('act_123');
    expect(normalizeAdAccountId('\n123\n')).toBe('act_123');
  });

  it('rejects anything that is not an ad account id', () => {
    for (const value of [
      '',
      '   ',
      'act_',
      'act_abc',
      'act_12a',
      'act_123;drop',
      'act_123 456',
      'me',
      'act_123/insights',
      null,
      undefined,
      42,
      { externalAccountId: 'act_123' },
    ]) {
      expect(normalizeAdAccountId(value)).toBeNull();
    }
  });

  it('does not let a doubled or recased prefix normalize into a handle', () => {
    // The guardrail compares normalized ids, so anything that normalizes must
    // be an id somebody could actually have configured.
    expect(normalizeAdAccountId('act_act_415877197389621')).toBeNull();
    expect(normalizeAdAccountId('ACT_415877197389621')).toBeNull();
    expect(normalizeAdAccountId('Act_415877197389621')).toBeNull();
  });

  it('never emits anything outside the canonical shape', () => {
    for (const value of ['act_1', '1', ' act_99 ', '0'.repeat(32)]) {
      const normalized = normalizeAdAccountId(value);

      expect(normalized).not.toBeNull();
      expect(normalized).toMatch(CANONICAL_AD_ACCOUNT_ID_PATTERN);
    }
  });
});

describe('isSameAdAccountId', () => {
  it('sees through the two spellings', () => {
    expect(isSameAdAccountId('act_415877197389621', '415877197389621')).toBe(
      true,
    );
    expect(isSameAdAccountId(' 415877197389621 ', 'act_415877197389621')).toBe(
      true,
    );
  });

  it('keeps different accounts different', () => {
    expect(isSameAdAccountId('act_111', 'act_222')).toBe(false);
    // Digits are compared as text: zero-padding is a different account, not a
    // numerically equal one.
    expect(isSameAdAccountId('act_0111', 'act_111')).toBe(false);
  });

  it('refuses to call two unparseable values equal', () => {
    // Two nulls comparing equal would be a gate that opens on garbage.
    expect(isSameAdAccountId('nonsense', 'nonsense')).toBe(false);
    expect(isSameAdAccountId(null, null)).toBe(false);
    expect(isSameAdAccountId(undefined, undefined)).toBe(false);
    expect(isSameAdAccountId('', '')).toBe(false);
  });
});
