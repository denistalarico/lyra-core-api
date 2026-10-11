import { HttpException } from '@nestjs/common';
import type { ContractRecord } from './entities';
import type { RenewContractDto } from './dto/renew-contract.dto';
import { contractObject, contractVariable } from './contract-term';
export function contractRuleError(code: string, status = 422): never {
  throw new HttpException({ code }, status);
}
export function addContractDays(date: string, days: number): string {
  return new Date(Date.parse(date) + days * 86400000)
    .toISOString()
    .slice(0, 10);
}
// Decimal integer arithmetic: half-up rounding, with no binary floating-point
// currency rounding. Accepts rendered pt-BR amounts inherited from old forms.
export function contractMoneyUnits(value: unknown): bigint {
  if (typeof value !== 'string' && typeof value !== 'number')
    return contractRuleError('contract_monthly_value_invalid');
  let text = String(value)
    .trim()
    .replace(/[^\d.,-]/g, '');
  if (text.includes(',')) text = text.replace(/\./g, '').replace(',', '.');
  if (!/^\d+(?:\.\d{1,4})?$/.test(text))
    return contractRuleError('contract_monthly_value_invalid');
  const [whole, fraction = ''] = text.split('.');
  return BigInt(whole) * 10000n + BigInt(fraction.padEnd(4, '0'));
}
export function formatContractMoney(units: bigint): string {
  const cents = (units + 50n) / 100n;
  return `${cents / 100n}.${String(cents % 100n).padStart(2, '0')}`;
}
export function buildContractRenewal(
  parent: ContractRecord,
  dto: RenewContractDto,
  today: string,
) {
  if (dto.periodMode === 'same' && (!parent.validFrom || !parent.validUntil))
    contractRuleError('contract_renewal_period_unknown');
  const validFrom =
    dto.validFrom ??
    (parent.validUntil ? addContractDays(parent.validUntil, 1) : null);
  const validUntil =
    dto.periodMode === 'custom'
      ? dto.validUntil
      : validFrom
        ? addContractDays(
            validFrom,
            Math.round(
              (Date.parse(parent.validUntil!) - Date.parse(parent.validFrom!)) /
                86400000,
            ),
          )
        : null;
  if (!validFrom || !validUntil || validUntil < validFrom)
    contractRuleError('contract_renewal_period_invalid');
  const client = contractObject(parent.metadata.clientContract),
    manual = contractObject(client.manual),
    effective = contractObject(parent.metadata.effectiveTerms);
  const previousMonthlyValue =
    effective.monthlyValue ??
    manual.monthlyValue ??
    contractVariable(parent.variablesData, 'contract.monthlyValue');
  const original =
    previousMonthlyValue === undefined ||
    previousMonthlyValue === null ||
    previousMonthlyValue === ''
      ? null
      : contractMoneyUnits(previousMonthlyValue);
  let units = original;
  if (dto.valueMode === 'custom') units = contractMoneyUnits(dto.monthlyValue);
  if (dto.valueMode === 'percent') {
    if (original === null || dto.adjustmentPercent === undefined)
      contractRuleError('contract_adjustment_percent_required');
    // The DTO constrains percent to four decimals. 1,000,000 = 100%.
    const factor = 1000000n + BigInt(Math.round(dto.adjustmentPercent * 10000));
    units = ((original * factor + 50000000n) / 100000000n) * 100n;
  }
  const newMonthlyValue = units === null ? null : formatContractMoney(units);
  const clientContract = { ...client };
  delete clientContract.attachedPdf;
  if (Object.keys(manual).length)
    clientContract.manual = {
      ...manual,
      ...(newMonthlyValue === null ? {} : { monthlyValue: newMonthlyValue }),
    };
  const variablesData: Record<string, unknown> = {
    ...parent.variablesData,
    'contract.startDate': validFrom,
    'contract.endDate': validUntil,
    'contract.signatureDate': today,
    ...(newMonthlyValue === null
      ? {}
      : { 'contract.monthlyValue': newMonthlyValue }),
  };
  // Remove nested stale aliases too: interpolator accepts flat and nested data.
  const nested = contractObject(variablesData.contract);
  if (Object.keys(nested).length)
    variablesData.contract = {
      ...nested,
      startDate: validFrom,
      endDate: validUntil,
      signatureDate: today,
      ...(newMonthlyValue === null ? {} : { monthlyValue: newMonthlyValue }),
    };
  return {
    validFrom,
    validUntil,
    previousMonthlyValue:
      original === null ? null : formatContractMoney(original),
    newMonthlyValue,
    variablesData,
    clientContract,
  };
}
