import {
  monthlyOccurrenceOnOrAfter,
  recurrenceNotBefore,
  recurrenceDay,
  recurrenceDocumentMetadata,
  recurrenceLineMetadata,
  recurrenceMonth,
  nextMonthlyOccurrence,
  validateRecurrenceDays,
} from './finance-recurrence.rules';
import { contractToday } from '../../contracts/contract-term';

describe('Finance recurrence calendar and metadata', () => {
  it('keeps day 31 across February and restores it in March', () => {
    expect(nextMonthlyOccurrence('2026-01-31', 31)).toBe('2026-02-28');
    expect(nextMonthlyOccurrence('2026-02-28', 31)).toBe('2026-03-31');
    expect(recurrenceDay('2028-02-01', 31)).toBe('2028-02-29');
  });
  it('separates competence from payment month across the year boundary', () => {
    expect(recurrenceMonth('2027-01-15', -1)).toBe('2026-12');
    expect(recurrenceMonth('2027-01-15')).toBe('2027-01');
  });
  it('moves a filled line competence to the generated occurrence', () => {
    expect(
      recurrenceLineMetadata({ competence: '2026-08', notes: 'x' }, '2026-10'),
    ).toEqual({ competence: '2026-10', notes: 'x' });
    expect(recurrenceLineMetadata({ notes: 'x' }, '2026-10')).toEqual({
      notes: 'x',
    });
    expect(recurrenceLineMetadata(null, '2026-10')).toEqual({});
  });
  it('uses the Sao Paulo business day before midnight UTC', () => {
    expect(contractToday(new Date('2026-10-15T01:00:00Z'))).toBe('2026-10-14');
  });
  it('preserves accounting dimensions without copying payment/public/audit state', () => {
    expect(
      recurrenceDocumentMetadata({
        accountId: 'account',
        expenseAccountId: 'expense',
        costCenterId: 'cost',
        internalName: 'Aluguel',
        publicToken: 'secret',
        events: [1],
        scheduledPaymentId: 'payment',
        recurrenceOccurrenceKey: 'old',
      }),
    ).toEqual({
      accountId: 'account',
      expenseAccountId: 'expense',
      costCenterId: 'cost',
      internalName: 'Aluguel',
    });
  });
  it.each([0, 32, 1.5, '15', null])(
    'rejects invalid schedule day %s',
    (value) => {
      expect(() => validateRecurrenceDays(value, 15)).toThrow();
    },
  );
});

describe('Finance recurrence registration boundaries', () => {
  it.each([
    ['2026-04-10', 10, '2026-10-15', '2026-11-10'],
    ['2026-04-20', 20, '2026-10-15', '2026-10-20'],
    ['2026-04-15', 15, '2026-10-15', '2026-10-15'],
    ['2026-03-31', 31, '2026-02-15', '2026-03-31'],
    ['2026-01-31', 31, '2026-02-15', '2026-02-28'],
    ['2026-01-31', 31, '2028-02-15', '2028-02-29'],
  ] as const)(
    'bounds %s to its first eligible scheduled date',
    (candidate, day, floor, expected) => {
      expect(monthlyOccurrenceOnOrAfter(candidate, day, floor)).toBe(expected);
    },
  );
  it('uses the Sao Paulo registration date and never lowers it through metadata', () => {
    const registered = new Date('2026-10-15T01:00:00Z');
    expect(
      recurrenceNotBefore(registered, { generationNotBefore: '2026-03-01' }),
    ).toBe('2026-10-14');
    expect(
      recurrenceNotBefore(registered, { generationNotBefore: '2026-11-01' }),
    ).toBe('2026-11-01');
  });
});
