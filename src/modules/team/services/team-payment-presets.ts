type PaymentTemplatePreset = {
  name: string;
  description: string;
  color: string;
  metadata: Record<string, unknown>;
};

const COLOR_BY_SCOPE: Record<string, string> = {
  BR: '#16A34A',
  US: '#2563EB',
  LATAM: '#EA580C',
  GLOBAL: '#7C3AED',
  CUSTOM: '#64748B',
};

const ALL_RELATIONSHIP_TYPES = [
  'employee_full_time',
  'employee_part_time',
  'contractor',
  'freelancer',
  'mei_contractor',
  'vendor',
  'intern',
  'partner',
  'external_collaborator',
];

function sampleDocumentBody(title: string) {
  return `
    <article>
      <h1>${title}</h1>
      <p><strong>Colaborador:</strong> {{member.name}}</p>
      <p><strong>Competência:</strong> {{payment.competence}}</p>
      <p><strong>Empresa:</strong> {{company.name}}</p>
      <p><strong>Valor líquido:</strong> {{payment.netAmount}}</p>
    </article>
  `.trim();
}

/**
 * Flags dos modelos protegidos: body
 * bloqueado e renderizado por um builder dedicado em DocumentPdfRendererService,
 * não pelo bodyHtml salvo. Os demais presets de documento continuam editáveis.
 */
function protectedDocumentMetadata(
  templateRenderer: 'attendance_report' | 'payslip' | 'payment_statement' | 'benefit_acknowledgment',
  countryScope: string,
  systemKey: string,
) {
  return {
    systemKey,
    isSystemTemplate: true,
    lockedBody: true,
    templateRenderer,
    signatureRequired: true,
    signatureBlocks: ['member', 'agency'],
    supportedPageSizes: templateRenderer === 'payslip' ? ['A4', 'LETTER'] : ['A4'],
    defaultPageSize: countryScope === 'US' ? 'LETTER' : 'A4',
  };
}

export const TEAM_PAYMENT_BENEFIT_PRESETS: PaymentTemplatePreset[] = [
  {
    name: 'Vale transporte',
    description: 'Auxílio de deslocamento para colaboradores no Brasil.',
    color: COLOR_BY_SCOPE.BR,
    metadata: {
      countryScope: 'BR',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time', 'intern'],
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'BRL',
      taxable: false,
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Vale alimentação',
    description: 'Benefício recorrente de alimentação no Brasil.',
    color: COLOR_BY_SCOPE.BR,
    metadata: {
      countryScope: 'BR',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time', 'intern'],
      calculationType: 'fixed_amount',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'BRL',
      taxable: false,
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Auxílio home office',
    description: 'Ajuda de custo para estrutura de trabalho remoto.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: [
        'contractor',
        'freelancer',
        'mei_contractor',
        'external_collaborator',
        'employee_full_time',
      ],
      calculationType: 'fixed_amount',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'BRL',
      taxable: true,
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Bônus por produtividade',
    description: 'Bônus variável condicionado a metas de produtividade.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: [
        'contractor',
        'freelancer',
        'mei_contractor',
        'employee_full_time',
        'employee_part_time',
      ],
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'BRL',
      taxable: true,
      recurring: false,
      requiresApproval: true,
    },
  },
  {
    name: 'Reembolso',
    description: 'Reembolso de despesas comprovadas.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      calculationType: 'reimbursement',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'BRL',
      taxable: false,
      recurring: false,
      requiresApproval: true,
    },
  },
  {
    name: 'Health insurance allowance',
    description: 'Ajuda de custo de plano de saúde para colaboradores nos EUA.',
    color: COLOR_BY_SCOPE.US,
    metadata: {
      countryScope: 'US',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time'],
      calculationType: 'fixed_amount',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'USD',
      taxable: false,
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Remote work allowance',
    description: 'Ajuda de custo para trabalho remoto.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: [
        'contractor',
        'freelancer',
        'external_collaborator',
        'employee_full_time',
      ],
      calculationType: 'fixed_amount',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'USD',
      taxable: true,
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Equipment allowance',
    description: 'Reembolso ou ajuda de custo para equipamentos de trabalho.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ['contractor', 'freelancer', 'external_collaborator'],
      calculationType: 'reimbursement',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'USD',
      taxable: false,
      recurring: false,
      requiresApproval: true,
    },
  },
  {
    name: 'Productivity bonus',
    description: 'Bônus variável condicionado a metas de produtividade.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: [
        'contractor',
        'freelancer',
        'mei_contractor',
        'employee_full_time',
      ],
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'USD',
      taxable: true,
      recurring: false,
      requiresApproval: true,
    },
  },
];

export const TEAM_PAYMENT_DISCOUNT_PRESETS: PaymentTemplatePreset[] = [
  {
    name: 'INSS',
    description:
      'Modelo informativo/configurável. O Lyra não substitui cálculo fiscal/trabalhista oficial nesta fase.',
    color: COLOR_BY_SCOPE.BR,
    metadata: {
      countryScope: 'BR',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time', 'intern'],
      deductionType: 'statutory',
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'BRL',
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'IRRF',
    description:
      'Modelo informativo/configurável. O Lyra não substitui cálculo fiscal/trabalhista oficial nesta fase.',
    color: COLOR_BY_SCOPE.BR,
    metadata: {
      countryScope: 'BR',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time'],
      deductionType: 'statutory',
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'BRL',
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Vale transporte',
    description: 'Coparticipação do colaborador no vale transporte.',
    color: COLOR_BY_SCOPE.BR,
    metadata: {
      countryScope: 'BR',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time'],
      deductionType: 'benefit_copay',
      calculationType: 'percentage',
      defaultAmount: null,
      defaultPercentage: 6,
      currency: 'BRL',
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Adiantamento',
    description: 'Adiantamento salarial ou de pagamento a ser descontado depois.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      deductionType: 'advance',
      calculationType: 'fixed_amount',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'BRL',
      recurring: false,
      requiresApproval: true,
    },
  },
  {
    name: 'Dano ou quebra de equipamento',
    description: 'Desconto referente a dano ou perda de equipamento da empresa.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      deductionType: 'equipment_damage',
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'BRL',
      recurring: false,
      requiresApproval: true,
    },
  },
  {
    name: 'Federal tax withholding',
    description:
      'Modelo informativo/configurável. O Lyra não substitui cálculo fiscal/trabalhista oficial nesta fase.',
    color: COLOR_BY_SCOPE.US,
    metadata: {
      countryScope: 'US',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time'],
      deductionType: 'statutory',
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'USD',
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'State tax withholding',
    description:
      'Modelo informativo/configurável. O Lyra não substitui cálculo fiscal/trabalhista oficial nesta fase.',
    color: COLOR_BY_SCOPE.US,
    metadata: {
      countryScope: 'US',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time'],
      deductionType: 'statutory',
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'USD',
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Social Security',
    description:
      'Modelo informativo/configurável. O Lyra não substitui cálculo fiscal/trabalhista oficial nesta fase.',
    color: COLOR_BY_SCOPE.US,
    metadata: {
      countryScope: 'US',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time'],
      deductionType: 'statutory',
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'USD',
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Medicare',
    description:
      'Modelo informativo/configurável. O Lyra não substitui cálculo fiscal/trabalhista oficial nesta fase.',
    color: COLOR_BY_SCOPE.US,
    metadata: {
      countryScope: 'US',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time'],
      deductionType: 'statutory',
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'USD',
      recurring: true,
      requiresApproval: false,
    },
  },
  {
    name: 'Equipment damage',
    description: 'Desconto referente a dano ou perda de equipamento da empresa.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      deductionType: 'equipment_damage',
      calculationType: 'manual',
      defaultAmount: null,
      defaultPercentage: null,
      currency: 'USD',
      recurring: false,
      requiresApproval: true,
    },
  },
];

export const TEAM_PAYMENT_DOCUMENT_PRESETS: PaymentTemplatePreset[] = [
  {
    name: 'Holerite',
    description: 'Demonstrativo individual de pagamento mensal.',
    color: COLOR_BY_SCOPE.BR,
    metadata: {
      documentType: 'payslip',
      countryScope: 'BR',
      applicableRelationshipTypes: ['employee_full_time', 'employee_part_time'],
      bodyHtml: sampleDocumentBody('Holerite'),
      supportsPdf: true,
      supportsPrint: true,
      ...protectedDocumentMetadata('payslip', 'BR', 'system:payslip'),
    },
  },
  {
    name: 'Demonstrativo de pagamento',
    description: 'Demonstrativo geral de pagamento da competência.',
    color: COLOR_BY_SCOPE.BR,
    metadata: {
      documentType: 'payment_statement',
      countryScope: 'BR',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      bodyHtml: sampleDocumentBody('Demonstrativo de pagamento'),
      supportsPdf: true,
      supportsPrint: true,
      ...protectedDocumentMetadata('payment_statement', 'BR', 'system:payment_statement'),
    },
  },
  {
    name: 'Recibo de pagamento autônomo',
    description: 'Recibo para prestadores autônomos/MEI.',
    color: COLOR_BY_SCOPE.BR,
    metadata: {
      documentType: 'contractor_receipt',
      countryScope: 'BR',
      applicableRelationshipTypes: ['contractor', 'freelancer', 'mei_contractor'],
      bodyHtml: sampleDocumentBody('Recibo de pagamento autônomo'),
      supportsPdf: true,
      supportsPrint: true,
    },
  },
  {
    name: 'Declaração de recebimento de benefícios',
    description: 'Declaração de recebimento de benefícios do período.',
    color: COLOR_BY_SCOPE.BR,
    metadata: {
      documentType: 'benefit_acknowledgment',
      countryScope: 'BR',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      bodyHtml: sampleDocumentBody('Declaração de recebimento de benefícios'),
      supportsPdf: true,
      supportsPrint: true,
      ...protectedDocumentMetadata(
        'benefit_acknowledgment',
        'BR',
        'system:benefit_acknowledgment',
      ),
    },
  },
  {
    name: 'Payment statement',
    description: 'General payment statement for the competence period.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      documentType: 'payment_statement',
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      bodyHtml: sampleDocumentBody('Payment statement'),
      supportsPdf: true,
      supportsPrint: true,
      ...protectedDocumentMetadata('payment_statement', 'GLOBAL', 'system:global:payment_statement'),
    },
  },
  {
    name: 'Contractor payment receipt',
    description: 'Payment receipt for contractors, freelancers and vendors.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      documentType: 'contractor_receipt',
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ['contractor', 'freelancer', 'mei_contractor', 'vendor'],
      bodyHtml: sampleDocumentBody('Contractor payment receipt'),
      supportsPdf: true,
      supportsPrint: true,
    },
  },
  {
    name: 'Benefit acknowledgment',
    description: 'Acknowledgment of benefits received in the period.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      documentType: 'benefit_acknowledgment',
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      bodyHtml: sampleDocumentBody('Benefit acknowledgment'),
      supportsPdf: true,
      supportsPrint: true,
    },
  },
  {
    name: 'Reimbursement statement',
    description: 'Statement of reimbursed expenses.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      documentType: 'reimbursement_statement',
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      bodyHtml: sampleDocumentBody('Reimbursement statement'),
      supportsPdf: true,
      supportsPrint: true,
    },
  },
  {
    name: 'Attendance report',
    description: 'Attendance/presence report for the period.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      documentType: 'attendance_report',
      countryScope: 'GLOBAL',
      applicableRelationshipTypes: ALL_RELATIONSHIP_TYPES,
      bodyHtml: sampleDocumentBody('Attendance report'),
      supportsPdf: true,
      supportsPrint: true,
      ...protectedDocumentMetadata('attendance_report', 'GLOBAL', 'system:global:attendance_report'),
    },
  },
];

export const TEAM_PAYMENT_FINANCE_PRESETS: PaymentTemplatePreset[] = [
  {
    name: 'Pagamento mensal de membro',
    description: 'Mapeamento padrão para folha de pagamento de funcionários.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      appliesTo: 'salary',
      relationshipTypes: ['employee_full_time', 'employee_part_time', 'intern'],
      defaultFinanceAccountId: null,
      defaultJournalId: null,
      defaultCategoryId: null,
      defaultCostCenterId: null,
      defaultBankAccountId: null,
      createPayable: true,
      createExpense: true,
      requireApprovalBeforeFinance: true,
    },
  },
  {
    name: 'Pagamento de contractor/freelancer/MEI',
    description: 'Mapeamento padrão para pagamentos a prestadores e fornecedores.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      appliesTo: 'contractor_payment',
      relationshipTypes: ['mei_contractor', 'contractor', 'freelancer', 'vendor', 'external_collaborator'],
      defaultFinanceAccountId: null,
      defaultJournalId: null,
      defaultCategoryId: null,
      defaultCostCenterId: null,
      defaultBankAccountId: null,
      createPayable: true,
      createExpense: true,
      requireApprovalBeforeFinance: true,
    },
  },
  {
    name: 'Benefícios',
    description: 'Mapeamento padrão para lançamentos de benefícios.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      appliesTo: 'benefit',
      relationshipTypes: [],
      defaultFinanceAccountId: null,
      defaultJournalId: null,
      defaultCategoryId: null,
      defaultCostCenterId: null,
      defaultBankAccountId: null,
      createPayable: true,
      createExpense: true,
      requireApprovalBeforeFinance: false,
    },
  },
  {
    name: 'Reembolso',
    description: 'Mapeamento padrão para lançamentos de reembolso.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      appliesTo: 'reimbursement',
      relationshipTypes: [],
      defaultFinanceAccountId: null,
      defaultJournalId: null,
      defaultCategoryId: null,
      defaultCostCenterId: null,
      defaultBankAccountId: null,
      createPayable: true,
      createExpense: true,
      requireApprovalBeforeFinance: true,
    },
  },
  {
    name: 'Descontos',
    description: 'Mapeamento padrão para lançamentos de desconto.',
    color: COLOR_BY_SCOPE.GLOBAL,
    metadata: {
      appliesTo: 'deduction',
      relationshipTypes: [],
      defaultFinanceAccountId: null,
      defaultJournalId: null,
      defaultCategoryId: null,
      defaultCostCenterId: null,
      defaultBankAccountId: null,
      createPayable: false,
      createExpense: false,
      requireApprovalBeforeFinance: true,
    },
  },
];

export const TEAM_PAYMENT_TEMPLATE_PRESETS: Record<string, PaymentTemplatePreset[]> = {
  payment_benefit_template: TEAM_PAYMENT_BENEFIT_PRESETS,
  payment_discount_template: TEAM_PAYMENT_DISCOUNT_PRESETS,
  payment_document_template: TEAM_PAYMENT_DOCUMENT_PRESETS,
  payment_finance_setting: TEAM_PAYMENT_FINANCE_PRESETS,
};
