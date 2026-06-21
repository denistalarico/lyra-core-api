export type PaymentLineItem = {
  name: string;
  amount?: number | null;
  percentage?: number | null;
};

export type SimplePaymentCalculationInput = {
  baseAmount: number;
  benefits: PaymentLineItem[];
  deductions: PaymentLineItem[];
  reimbursements: PaymentLineItem[];
  bonuses: PaymentLineItem[];
};

export type SimplePaymentCalculationResult = {
  totalBenefits: number;
  totalDeductions: number;
  totalReimbursements: number;
  totalBonuses: number;
  grossAmount: number;
  netAmount: number;
};

function sumLineItems(items: PaymentLineItem[], percentageBase: number): number {
  return items.reduce((total, item) => {
    if (typeof item.amount === 'number') return total + item.amount;
    if (typeof item.percentage === 'number') return total + (percentageBase * item.percentage) / 100;
    return total;
  }, 0);
}

/**
 * Cálculo simples e configurável de bruto/líquido para documentos de pagamento.
 * Não substitui cálculo fiscal/trabalhista oficial (INSS/IRRF/Federal Tax etc.
 * entram como itens manuais/defaults configurados pelo usuário, nunca calculados aqui).
 * Percentuais de desconto incidem sobre `baseAmount` (regra simples e documentada,
 * evita depender do bruto já somado com benefícios).
 */
export function calculateSimplePaymentTotals(
  input: SimplePaymentCalculationInput,
): SimplePaymentCalculationResult {
  const { baseAmount, benefits, deductions, reimbursements, bonuses } = input;

  const totalBenefits = sumLineItems(benefits, baseAmount);
  const totalReimbursements = sumLineItems(reimbursements, baseAmount);
  const totalBonuses = sumLineItems(bonuses, baseAmount);
  const totalDeductions = sumLineItems(deductions, baseAmount);

  const grossAmount = baseAmount + totalBenefits + totalBonuses + totalReimbursements;
  const netAmount = grossAmount - totalDeductions;

  return { totalBenefits, totalDeductions, totalReimbursements, totalBonuses, grossAmount, netAmount };
}

export type AttendanceRecordInput = {
  date: string;
  checkIn?: string | null;
  checkOut?: string | null;
  breakMinutes?: number | null;
  totalHours?: number | null;
  status?: 'present' | 'late' | 'absence' | string;
  note?: string | null;
};

export type AttendanceAggregates = {
  totalWorkedHours: number;
  expectedHours: number;
  overtimeHours: number;
  missingHours: number;
  balanceHours: number;
  daysWorked: number;
  absences: number;
  lateEntries: number;
};

export function calculateAttendanceAggregates(
  records: AttendanceRecordInput[],
  expectedHoursPerDay = 8,
): AttendanceAggregates {
  const presentRecords = records.filter((record) => record.status !== 'absence');
  const totalWorkedHours = records.reduce((sum, record) => sum + (record.totalHours ?? 0), 0);
  const daysWorked = presentRecords.length;
  const expectedHours = daysWorked * expectedHoursPerDay;

  return {
    totalWorkedHours,
    expectedHours,
    overtimeHours: Math.max(0, totalWorkedHours - expectedHours),
    missingHours: Math.max(0, expectedHours - totalWorkedHours),
    balanceHours: totalWorkedHours - expectedHours,
    daysWorked,
    absences: records.filter((record) => record.status === 'absence').length,
    lateEntries: records.filter((record) => record.status === 'late').length,
  };
}
