// Closed agency-level allowlist shared by defaults storage and Orion v2.
export type ContractDefaultDefinition = {
  key: string;
  type: 'text' | 'integer' | 'percent' | 'select' | 'preset';
  options?: readonly string[];
  max?: number;
};
export const CONTRACT_DEFAULTS_CATALOG: readonly ContractDefaultDefinition[] = [
  { key: 'contract.city', type: 'text' },
  {
    key: 'contract.jurisdiction',
    type: 'preset',
    options: ['agency_location', 'client_location', 'arbitration'],
  },
  { key: 'contract.termMonths', type: 'integer' },
  { key: 'contract.minimumTermMonths', type: 'integer' },
  { key: 'contract.noticeDays', type: 'integer' },
  {
    key: 'contract.autoRenewal',
    type: 'preset',
    options: ['none', 'same_period', 'monthly'],
  },
  {
    key: 'contract.adjustmentIndex',
    type: 'preset',
    options: ['ipca', 'igpm', 'cpi', 'fixed_percentage', 'none'],
  },
  { key: 'contract.adjustmentPercent', type: 'percent' },
  { key: 'contract.dueDay', type: 'integer', max: 31 },
  { key: 'contract.paymentTerms', type: 'text' },
  {
    key: 'contract.paymentMethod',
    type: 'select',
    options: ['bank_transfer', 'card', 'boleto', 'pix', 'ach', 'wire_transfer'],
  },
  {
    key: 'contract.billingFrequency',
    type: 'select',
    options: ['monthly', 'quarterly', 'semiannual', 'annual', 'one_time'],
  },
  {
    key: 'contract.billingDocument',
    type: 'select',
    options: ['invoice', 'nota_fiscal', 'receipt', 'boleto'],
  },
  { key: 'contract.lateFeePercent', type: 'percent' },
  { key: 'contract.monthlyInterestPercent', type: 'percent' },
  { key: 'contract.terminationFeePercent', type: 'percent' },
  { key: 'service.meetingCadence', type: 'text' },
  { key: 'service.approvalDeadlineDays', type: 'integer' },
  { key: 'service.revisionLimit', type: 'text' },
  { key: 'service.reportDeliveryDay', type: 'text' },
  { key: 'service.businessHours', type: 'text' },
  {
    key: 'service.advertisingBudgetResponsibility',
    type: 'preset',
    options: ['client_direct', 'agency_reimbursement', 'included'],
  },
  { key: 'service.additionalServicesPolicy', type: 'text' },
  { key: 'service.approvalPolicy', type: 'text' },
  { key: 'service.platformDependencyStatement', type: 'text' },
];
// Team uses its own variables and preset codes; never reuse client billing defaults.
export const TEAM_CONTRACT_DEFAULTS_CATALOG: readonly ContractDefaultDefinition[] =
  [
    { key: 'contract.city', type: 'text' },
    {
      key: 'contract.jurisdiction',
      type: 'preset',
      options: ['company_location', 'contractor_location', 'arbitration'],
    },
    { key: 'contract.termMonths', type: 'integer' },
    { key: 'contract.minimumTermMonths', type: 'integer' },
    { key: 'contract.noticeDays', type: 'integer' },
    {
      key: 'contract.autoRenewal',
      type: 'preset',
      options: ['none', 'same_period', 'monthly'],
    },
    { key: 'payment.dueDay', type: 'integer', max: 31 },
    { key: 'payment.reportDueDay', type: 'integer', max: 31 },
    { key: 'payment.billingDocument', type: 'text' },
    {
      key: 'payment.paymentTerms',
      type: 'preset',
      options: ['monthly_after_report', 'monthly_fixed', 'per_deliverable'],
    },
    {
      key: 'work.noTimeTracking',
      type: 'preset',
      options: ['no_time_tracking', 'timesheet_for_billing'],
    },
    { key: 'work.autonomyStatement', type: 'text' },
  ];
export function contractDefaultsCatalog(targetType: 'client' | 'team_member') {
  return targetType === 'team_member'
    ? TEAM_CONTRACT_DEFAULTS_CATALOG
    : CONTRACT_DEFAULTS_CATALOG;
}
export const CONTRACT_DEFAULT_KEYS = CONTRACT_DEFAULTS_CATALOG.map(
  (item) => item.key,
);
export const CONTRACT_DEFAULT_PRESET_KEYS = CONTRACT_DEFAULTS_CATALOG.filter(
  (item) => item.type === 'preset',
).map((item) => item.key);
export function normalizeExtractedContractDefault(
  definition: ContractDefaultDefinition,
  value: unknown,
): string | null {
  if (typeof value !== 'string' || !value.trim() || value.length > 2000)
    return null;
  if (definition.options)
    return definition.options.includes(value) ? value : null;
  if (
    definition.type === 'integer' &&
    (!/^\d{1,3}$/.test(value) ||
      (definition.max && (Number(value) < 1 || Number(value) > definition.max)))
  )
    return null;
  if (definition.type === 'percent' && !/^\d{1,3}([.,]\d{1,4})?$/.test(value))
    return null;
  return value;
}
