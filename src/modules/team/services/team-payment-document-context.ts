import { TeamConfigOption } from '../entities';
import {
  calculateAttendanceAggregates,
  calculateSimplePaymentTotals,
  type AttendanceAggregates,
  type AttendanceRecordInput,
  type PaymentLineItem,
} from './team-payment-document-calculation';

export type TeamPaymentDocumentRenderContext = {
  agency: {
    legalName: string;
    publicName: string;
    taxId: string;
    address: string;
    email: string;
    phone: string;
    country: string;
    signerName: string;
    signerRole: string;
  };
  member: {
    displayName: string;
    legalName: string;
    document: string;
    role: string;
    department: string;
    workerType: string;
  };
  contract: {
    number: string;
    paymentTerms: string;
  };
  period: {
    label: string;
    startDate: string;
    endDate: string;
    paymentDate: string;
  };
  payment: {
    currency: string;
    baseAmount: number;
    grossAmount: number;
    netAmount: number;
    totalBenefits: number;
    totalDeductions: number;
    paymentMethod: string;
    notes: string;
  };
  benefits: Array<{ name: string; amount: number }>;
  deductions: Array<{ name: string; amount: number }>;
  attendance: {
    records: AttendanceRecordInput[];
    aggregates: AttendanceAggregates;
  };
  signature: {
    memberName: string;
    memberRole: string;
    agencySignerName: string;
    agencySignerRole: string;
    city: string;
    date: string;
  };
  document: {
    number: string;
    type: string;
    name: string;
    generatedAt: string;
    locale: string;
    pageSize: 'A4' | 'LETTER';
  };
};

const MOCK_ATTENDANCE_RECORDS: AttendanceRecordInput[] = [
  { date: '2026-06-01', checkIn: '09:00', checkOut: '18:00', breakMinutes: 60, totalHours: 8, status: 'present' },
  { date: '2026-06-02', checkIn: '09:05', checkOut: '18:10', breakMinutes: 60, totalHours: 8.08, status: 'late' },
  { date: '2026-06-03', checkIn: '09:00', checkOut: '19:00', breakMinutes: 60, totalHours: 9, status: 'present' },
  { date: '2026-06-04', checkIn: null, checkOut: null, breakMinutes: 0, totalHours: 0, status: 'absence', note: 'Atestado médico' },
  { date: '2026-06-05', checkIn: '09:00', checkOut: '18:00', breakMinutes: 60, totalHours: 8, status: 'present' },
];

/**
 * Contexto de exemplo (não conectado a dados reais de membro/pagamento/presença
 * ainda). Estrutura já é a que /team/members/[id] e /team/payments vão alimentar
 * de verdade numa próxima etapa — só os valores são mockados por ora.
 */
export function buildMockPaymentDocumentContext(
  option: TeamConfigOption,
): TeamPaymentDocumentRenderContext {
  const metadata = (option.metadata ?? {}) as Record<string, unknown>;
  const countryScope = String(metadata.countryScope ?? 'GLOBAL');
  const currency = countryScope === 'US' ? 'USD' : 'BRL';
  const baseAmount = countryScope === 'US' ? 4500 : 5000;

  const benefitsInput: PaymentLineItem[] = [
    { name: countryScope === 'US' ? 'Remote work allowance' : 'Vale alimentação', amount: countryScope === 'US' ? 150 : 600 },
    { name: countryScope === 'US' ? 'Equipment allowance' : 'Auxílio home office', amount: 200 },
  ];
  const deductionsInput: PaymentLineItem[] = [
    { name: countryScope === 'US' ? 'Federal tax withholding' : 'INSS', percentage: 9 },
    { name: countryScope === 'US' ? 'Social Security' : 'Vale transporte (coparticipação)', percentage: 6 },
  ];

  const totals = calculateSimplePaymentTotals({
    baseAmount,
    benefits: benefitsInput,
    deductions: deductionsInput,
    reimbursements: [],
    bonuses: [],
  });

  return {
    agency: {
      legalName: 'Sua Agência LTDA',
      publicName: 'Sua Agência',
      taxId: countryScope === 'US' ? '00-0000000' : '00.000.000/0001-00',
      address: 'Av. Exemplo, 123 — São Paulo/SP',
      email: 'financeiro@suaagencia.com',
      phone: '(11) 0000-0000',
      country: countryScope,
      signerName: 'Responsável Financeiro',
      signerRole: 'Diretor(a) Financeiro(a)',
    },
    member: {
      displayName: 'Colaborador Exemplo',
      legalName: 'Colaborador Exemplo da Silva',
      document: countryScope === 'US' ? '000-00-0000' : '000.000.000-00',
      role: 'Analista',
      department: 'Operações',
      workerType: 'employee_full_time',
    },
    contract: {
      number: 'DOC-001/2026',
      paymentTerms: 'Mensal, até o 5º dia útil',
    },
    period: {
      label: 'Junho/2026',
      startDate: '01/06/2026',
      endDate: '30/06/2026',
      paymentDate: '05/07/2026',
    },
    payment: {
      currency,
      baseAmount,
      grossAmount: totals.grossAmount,
      netAmount: totals.netAmount,
      totalBenefits: totals.totalBenefits,
      totalDeductions: totals.totalDeductions,
      paymentMethod: 'Transferência bancária',
      notes: 'Modelo configurável. Não substitui cálculo fiscal/trabalhista oficial.',
    },
    benefits: benefitsInput.map((item) => ({
      name: item.name,
      amount: typeof item.amount === 'number' ? item.amount : (baseAmount * (item.percentage ?? 0)) / 100,
    })),
    deductions: deductionsInput.map((item) => ({
      name: item.name,
      amount: typeof item.amount === 'number' ? item.amount : (baseAmount * (item.percentage ?? 0)) / 100,
    })),
    attendance: {
      records: MOCK_ATTENDANCE_RECORDS,
      aggregates: calculateAttendanceAggregates(MOCK_ATTENDANCE_RECORDS),
    },
    signature: {
      memberName: 'Colaborador Exemplo',
      memberRole: 'Analista',
      agencySignerName: 'Responsável Financeiro',
      agencySignerRole: 'Diretor(a) Financeiro(a)',
      city: 'São Paulo/SP',
      date: '18/06/2026',
    },
    document: {
      number: `DOC-${option.id ? option.id.slice(0, 8) : '00000000'}`,
      type: String(metadata.documentType ?? 'custom'),
      name: option.name,
      generatedAt: new Date().toISOString(),
      locale: countryScope === 'US' ? 'en-US' : 'pt-BR',
      pageSize: (metadata.defaultPageSize as 'A4' | 'LETTER') ?? (countryScope === 'US' ? 'LETTER' : 'A4'),
    },
  };
}

/**
 * Mapa plano (dot-key -> texto) do mesmo contexto, usado para interpolar
 * `{{token}}` em modelos `custom_html` (que passam por `ContractsService.previewTemplate`,
 * onde cada valor é tratado como texto simples e escapado em HTML).
 */
export function buildFlatSampleTokenMap(option: TeamConfigOption): Record<string, string> {
  const ctx = buildMockPaymentDocumentContext(option);
  const money = (value: number) =>
    new Intl.NumberFormat(ctx.document.locale, { style: 'currency', currency: ctx.payment.currency }).format(value);
  const list = (items: Array<{ name: string; amount: number }>) =>
    items.map((item) => `${item.name}: ${money(item.amount)}`).join('; ');

  return {
    'agency.legalName': ctx.agency.legalName,
    'agency.publicName': ctx.agency.publicName,
    'agency.taxId': ctx.agency.taxId,
    'agency.address': ctx.agency.address,
    'agency.email': ctx.agency.email,
    'agency.phone': ctx.agency.phone,
    'agency.country': ctx.agency.country,
    'agency.signerName': ctx.agency.signerName,
    'member.id': 'member-exemplo',
    'member.displayName': ctx.member.displayName,
    'member.legalName': ctx.member.legalName,
    'member.document': ctx.member.document,
    'member.role': ctx.member.role,
    'member.department': ctx.member.department,
    'member.workerType': ctx.member.workerType,
    'member.name': ctx.member.displayName,
    'contract.number': ctx.contract.number,
    'contract.paymentTerms': ctx.contract.paymentTerms,
    'period.label': ctx.period.label,
    'period.startDate': ctx.period.startDate,
    'period.endDate': ctx.period.endDate,
    'period.paymentDate': ctx.period.paymentDate,
    'payment.competence': `${ctx.period.startDate} a ${ctx.period.endDate}`,
    'payment.currency': ctx.payment.currency,
    'payment.baseAmount': money(ctx.payment.baseAmount),
    'payment.grossAmount': money(ctx.payment.grossAmount),
    'payment.netAmount': money(ctx.payment.netAmount),
    'payment.totalBenefits': money(ctx.payment.totalBenefits),
    'payment.totalDeductions': money(ctx.payment.totalDeductions),
    'payment.paymentMethod': ctx.payment.paymentMethod,
    'payment.notes': ctx.payment.notes,
    'benefits.count': String(ctx.benefits.length),
    'benefits.totalAmount': money(ctx.payment.totalBenefits),
    'benefits.summary': list(ctx.benefits),
    'benefits.table': list(ctx.benefits),
    'deductions.count': String(ctx.deductions.length),
    'deductions.totalAmount': money(ctx.payment.totalDeductions),
    'deductions.summary': list(ctx.deductions),
    'deductions.table': list(ctx.deductions),
    'attendance.totalWorkedHours': String(ctx.attendance.aggregates.totalWorkedHours),
    'attendance.expectedHours': String(ctx.attendance.aggregates.expectedHours),
    'attendance.overtimeHours': String(ctx.attendance.aggregates.overtimeHours),
    'attendance.missingHours': String(ctx.attendance.aggregates.missingHours),
    'attendance.balanceHours': String(ctx.attendance.aggregates.balanceHours),
    'attendance.daysWorked': String(ctx.attendance.aggregates.daysWorked),
    'attendance.absences': String(ctx.attendance.aggregates.absences),
    'attendance.lateEntries': String(ctx.attendance.aggregates.lateEntries),
    'signature.memberName': ctx.signature.memberName,
    'signature.memberRole': ctx.signature.memberRole,
    'signature.agencySignerName': ctx.signature.agencySignerName,
    'signature.agencySignerRole': ctx.signature.agencySignerRole,
    'signature.city': ctx.signature.city,
    'signature.date': ctx.signature.date,
    'document.number': ctx.document.number,
    'document.type': ctx.document.type,
    'document.name': ctx.document.name,
    'document.locale': ctx.document.locale,
    'company.name': ctx.agency.publicName,
  };
}
