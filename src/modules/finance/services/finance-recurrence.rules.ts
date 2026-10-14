import { BadRequestException } from '@nestjs/common';

export type CompetenceMode = 'current' | 'previous';

export function recurrenceMonth(date: string, offset = 0): string {
  const value = new Date(`${date.slice(0, 7)}-01T12:00:00Z`);
  value.setUTCMonth(value.getUTCMonth() + offset);
  return value.toISOString().slice(0, 7);
}

export function recurrenceDay(date: string, day: number): string {
  const month = date.slice(0, 7);
  const last = new Date(`${month}-01T12:00:00Z`);
  last.setUTCMonth(last.getUTCMonth() + 1, 0);
  return `${month}-${String(Math.min(day, last.getUTCDate())).padStart(2, '0')}`;
}

export function nextMonthlyOccurrence(date: string, day: number): string {
  return recurrenceDay(`${recurrenceMonth(date, 1)}-01`, day);
}

/** Only reusable dimensions; lifecycle/payment/audit metadata never repeats. */
export function recurrenceDocumentMetadata(
  metadata: Record<string, unknown> = {},
) {
  const keys = [
    'internalName',
    'journalId',
    'documentType',
    'accountId',
    'expenseAccountId',
    'revenueAccountId',
    'payableAccountId',
    'receivableAccountId',
    'categoryId',
    'costCenterId',
    'clientId',
    'projectId',
    'contactId',
    'paymentMethod',
    'bankAccountId',
  ];
  return Object.fromEntries(
    keys
      .filter((key) => metadata[key] !== undefined)
      .map((key) => [key, metadata[key]]),
  );
}

export function validateRecurrenceDays(
  generationDay: unknown,
  dueDay: unknown,
) {
  for (const value of [generationDay, dueDay]) {
    if (!Number.isInteger(value) || Number(value) < 1 || Number(value) > 31) {
      throw new BadRequestException(
        'Dias de emissão e vencimento devem estar entre 1 e 31.',
      );
    }
  }
}

export function recurrenceText(value: unknown, fallback = ''): string {
  return typeof value === 'string' || typeof value === 'number'
    ? String(value)
    : fallback;
}
