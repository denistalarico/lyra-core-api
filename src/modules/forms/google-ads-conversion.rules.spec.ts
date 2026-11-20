import {
  type ConversionOpportunity,
  MAX_UPLOAD_ATTEMPTS,
  conversionActionIdOf,
  conversionMoment,
  conversionValueFor,
  customerIdOf,
  earnedConversions,
  nextAttemptAt,
  transactionIdFor,
} from './google-ads-conversion.rules';

const base: ConversionOpportunity = {
  crm: 'agency_sales',
  id: '00000000-0000-4000-8000-0000000000aa',
  status: 'open',
  pipelineId: 'p1',
  reachedQualified: false,
  wonAt: null,
  valueAmount: 2500,
  currency: 'brl',
};

describe('GA-CONV rules (D-G6 revised)', () => {
  it('earns nothing before a qualified stage', () => {
    expect(earnedConversions(base)).toEqual([]);
  });

  it('earns qualified once the deal reached a qualified stage', () => {
    expect(earnedConversions({ ...base, reachedQualified: true })).toEqual([
      'qualified',
    ]);
  });

  it('keeps qualified when the deal was lost after the stage', () => {
    expect(
      earnedConversions({ ...base, status: 'lost', reachedQualified: true }),
    ).toEqual(['qualified']);
  });

  it('earns qualified and won when won, even if it skipped the stage', () => {
    expect(earnedConversions({ ...base, status: 'won' })).toEqual([
      'qualified',
      'won',
    ]);
  });

  it('earns nothing when lost without ever being qualified', () => {
    expect(earnedConversions({ ...base, status: 'lost' })).toEqual([]);
  });

  it('builds the transaction id Google deduplicates on', () => {
    expect(transactionIdFor(base.id, 'won')).toBe(`${base.id}:won`);
  });

  it('sends the value only with won and only when allowed', () => {
    expect(conversionValueFor('qualified', base, true)).toEqual({
      value: null,
      currency: null,
    });
    expect(conversionValueFor('won', base, false)).toEqual({
      value: null,
      currency: null,
    });
    expect(conversionValueFor('won', base, true)).toEqual({
      value: 2500,
      currency: 'BRL',
    });
    expect(
      conversionValueFor('won', { ...base, valueAmount: 0 }, true).value,
    ).toBeNull();
  });

  it('dates won at the close and never before the click or in the future', () => {
    const click = new Date('2026-11-01T10:00:00Z');
    const now = new Date('2026-11-20T10:00:00Z');
    const wonAt = new Date('2026-11-10T10:00:00Z');
    expect(conversionMoment('won', { ...base, wonAt }, click, now)).toEqual(
      wonAt,
    );
    expect(
      conversionMoment('qualified', { ...base, wonAt }, click, now),
    ).toEqual(now);
    expect(
      conversionMoment(
        'won',
        { ...base, wonAt: new Date('2026-10-01T00:00:00Z') },
        click,
        now,
      ),
    ).toEqual(now);
    expect(
      conversionMoment(
        'won',
        { ...base, wonAt: new Date('2026-12-01T00:00:00Z') },
        click,
        now,
      ),
    ).toEqual(now);
  });

  it('retries 5 times with growing delays, then gives up', () => {
    const now = new Date('2026-11-20T10:00:00Z');
    const delays = [1, 2, 3, 4, 5].map(
      (attempt) => nextAttemptAt(attempt, now)!.getTime() - now.getTime(),
    );
    expect(delays).toEqual([...delays].sort((a, b) => a - b));
    expect(nextAttemptAt(MAX_UPLOAD_ATTEMPTS, now)).toBeNull();
    expect(MAX_UPLOAD_ATTEMPTS).toBe(6);
  });

  it('parses action and customer resource names', () => {
    expect(conversionActionIdOf('customers/123/conversionActions/456')).toBe(
      '456',
    );
    expect(conversionActionIdOf('conversionActions/456')).toBeNull();
    expect(customerIdOf('customers/987')).toBe('987');
    expect(customerIdOf(42)).toBeNull();
  });
});
