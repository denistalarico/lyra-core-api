import {
  buildContractRenewal,
  contractMoneyUnits,
  formatContractMoney,
} from './contract-renewal';
import { ContractRecord } from './entities';
const parent = Object.assign(new ContractRecord(), {
  validFrom: '2026-01-01',
  validUntil: '2026-12-31',
  metadata: {
    clientContract: {
      mode: 'manual',
      attachedPdf: { documentId: 'old' },
      manual: { monthlyValue: '1000.00' },
    },
  },
  variablesData: {
    contract: {
      monthlyValue: '1000',
      startDate: '2026-01-01',
      endDate: '2026-12-31',
    },
  },
});
it.each([
  ['123.005', '123.01'],
  ['123.0049', '123.00'],
  ['R$ 1.234,56', '1234.56'],
  ['0', '0.00'],
])('rounds %s half-up as %s', (input, expected) =>
  expect(formatContractMoney(contractMoneyUnits(input))).toBe(expected),
);
it('percent rounds directly to cents, avoiding double rounding', () => {
  const record = Object.assign(new ContractRecord(), parent, {
    metadata: { clientContract: { manual: { monthlyValue: '0.049' } } },
  });
  const result = buildContractRenewal(
    record,
    { periodMode: 'same', valueMode: 'percent', adjustmentPercent: 10.2 },
    '2026-10-11',
  );
  // 0.049 * 1.102 = 0.053998 -> 0.05
  expect(result.newMonthlyValue).toBe('0.05');
  const edge = Object.assign(new ContractRecord(), parent, {
    metadata: { clientContract: { manual: { monthlyValue: '0.0099' } } },
  });
  expect(
    buildContractRenewal(
      edge,
      { periodMode: 'same', valueMode: 'percent', adjustmentPercent: -49.5 },
      '2026-10-11',
    ).newMonthlyValue,
  ).toBe('0.00');
});
it('updates flat and nested variables; does not carry signed attachment', () => {
  const result = buildContractRenewal(
    parent,
    { periodMode: 'same', valueMode: 'custom', monthlyValue: '1200' },
    '2026-10-11',
  );
  expect(result).toMatchObject({
    validFrom: '2027-01-01',
    validUntil: '2027-12-31',
    newMonthlyValue: '1200.00',
    variablesData: {
      contract: {
        monthlyValue: '1200.00',
        startDate: '2027-01-01',
        endDate: '2027-12-31',
      },
    },
  });
  expect(result.clientContract).not.toHaveProperty('attachedPdf');
});
it.each([
  { periodMode: 'custom', valueMode: 'keep' },
  {
    periodMode: 'custom',
    valueMode: 'keep',
    validFrom: '2027-12-31',
    validUntil: '2027-01-01',
  },
  { periodMode: 'same', valueMode: 'percent' },
  { periodMode: 'same', valueMode: 'custom' },
] as const)('rejects incomplete renewal input', (dto) =>
  expect(() => buildContractRenewal(parent, dto, '2026-10-11')).toThrow(),
);
