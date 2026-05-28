import {
  ContractCategory,
  ContractSignatureMode,
  ContractTargetType,
} from './enums';

export type ContractTemplatePreset = {
  key: string;
  label: string;
  description: string;
  category: ContractCategory;
  targetType: ContractTargetType;
  defaultSignatureMode: ContractSignatureMode;
  requiredVariables: string[];
  recommendedVariables: string[];
  variableGroups: Array<{
    key: string;
    label: string;
    fields: Array<{
      key: string;
      label: string;
      type: 'text' | 'email' | 'phone' | 'currency' | 'number' | 'percent' | 'date' | 'boolean' | 'textarea';
      required?: boolean;
      description?: string;
    }>;
  }>;
};

export const CONTRACT_TEMPLATE_PRESETS: ContractTemplatePreset[] = [
  {
    key: 'client_recurring_marketing_services',
    label: 'Cliente recorrente — Serviços de marketing digital',
    description:
      'Modelo para contratos recorrentes com clientes de marketing digital, gestão de redes sociais, tráfego pago e serviços mensais.',
    category: ContractCategory.ClientRecurring,
    targetType: ContractTargetType.Client,
    defaultSignatureMode: ContractSignatureMode.Manual,
    requiredVariables: [
      'contract.number',
      'contract.date',
      'contract.city',
      'contract.jurisdiction',
      'agency.legalName',
      'agency.taxId',
      'agency.address',
      'agency.email',
      'agency.signerName',
      'client.legalName',
      'client.taxId',
      'client.address',
      'client.email',
      'responsible.fullName',
      'responsible.cpf',
      'responsible.phone',
      'responsible.email',
      'offer.services',
      'offer.monthlyPublications',
      'offer.recurringAmount',
      'offer.invoiceDueDay',
      'offer.contractTermMonths',
      'offer.initialTermMonths',
      'offer.autoRenewal',
      'offer.terminationPenalty',
    ],
    recommendedVariables: [
      'offer.setupFee',
      'offer.lateFeePercent',
      'offer.monthlyInterestPercent',
      'offer.renewalTermMonths',
      'offer.adsBudgetResponsibility',
      'offer.reportDeliveryDay',
      'offer.contentApprovalDeadlineDays',
      'offer.serviceSuspensionAfterDays',
    ],
    variableGroups: [
      {
        key: 'contract',
        label: 'Dados do contrato',
        fields: [
          { key: 'contract.number', label: 'Número do contrato', type: 'text', required: true },
          { key: 'contract.date', label: 'Data do contrato', type: 'date', required: true },
          { key: 'contract.city', label: 'Cidade/UF', type: 'text', required: true },
          { key: 'contract.jurisdiction', label: 'Foro', type: 'text', required: true },
        ],
      },
      {
        key: 'agency',
        label: 'Dados da empresa contratada',
        fields: [
          { key: 'agency.legalName', label: 'Razão social', type: 'text', required: true },
          { key: 'agency.taxId', label: 'CNPJ', type: 'text', required: true },
          { key: 'agency.address', label: 'Endereço comercial', type: 'textarea', required: true },
          { key: 'agency.email', label: 'E-mail comercial', type: 'email', required: true },
          { key: 'agency.signerName', label: 'Responsável pela assinatura', type: 'text', required: true },
        ],
      },
      {
        key: 'client',
        label: 'Dados do cliente',
        fields: [
          { key: 'client.legalName', label: 'Razão social/Nome do cliente', type: 'text', required: true },
          { key: 'client.taxId', label: 'CNPJ/CPF', type: 'text', required: true },
          { key: 'client.address', label: 'Endereço', type: 'textarea', required: true },
          { key: 'client.email', label: 'E-mail comercial', type: 'email', required: true },
        ],
      },
      {
        key: 'responsible',
        label: 'Responsável pelo cliente',
        fields: [
          { key: 'responsible.fullName', label: 'Nome completo', type: 'text', required: true },
          { key: 'responsible.cpf', label: 'CPF', type: 'text', required: true },
          { key: 'responsible.phone', label: 'Telefone', type: 'phone', required: true },
          { key: 'responsible.email', label: 'E-mail', type: 'email', required: true },
        ],
      },
      {
        key: 'offer',
        label: 'Dados da oferta',
        fields: [
          { key: 'offer.services', label: 'Produtos/serviços contratados', type: 'textarea', required: true },
          { key: 'offer.monthlyPublications', label: 'Publicações mensais', type: 'number', required: true },
          { key: 'offer.recurringAmount', label: 'Valor recorrente', type: 'currency', required: true },
          { key: 'offer.setupFee', label: 'Entrada/setup', type: 'currency' },
          { key: 'offer.invoiceDueDay', label: 'Dia de vencimento da fatura', type: 'number', required: true },
          { key: 'offer.lateFeePercent', label: 'Multa moratória (%)', type: 'percent' },
          { key: 'offer.monthlyInterestPercent', label: 'Juros de mora ao mês (%)', type: 'percent' },
          { key: 'offer.contractTermMonths', label: 'Tempo total do contrato em meses', type: 'number', required: true },
          { key: 'offer.initialTermMonths', label: 'Vigência inicial em meses', type: 'number', required: true },
          { key: 'offer.autoRenewal', label: 'Renovação automática', type: 'boolean', required: true },
          { key: 'offer.renewalTermMonths', label: 'Período de renovação em meses', type: 'number' },
          { key: 'offer.terminationPenalty', label: 'Multa rescisória', type: 'textarea', required: true },
        ],
      },
    ],
  },
  {
    key: 'client_short_term_marketing_services',
    label: 'Cliente pontual/curto prazo — Serviços de marketing digital',
    description:
      'Modelo reduzido para projetos avulsos, landing pages, sites, estruturação digital, identidade visual e serviços com escopo fechado.',
    category: ContractCategory.ClientShortTerm,
    targetType: ContractTargetType.Client,
    defaultSignatureMode: ContractSignatureMode.Manual,
    requiredVariables: [
      'contract.number',
      'contract.date',
      'contract.city',
      'contract.jurisdiction',
      'agency.legalName',
      'agency.taxId',
      'agency.address',
      'agency.email',
      'agency.signerName',
      'client.legalName',
      'client.taxId',
      'client.address',
      'client.email',
      'responsible.fullName',
      'responsible.cpf',
      'responsible.phone',
      'responsible.email',
      'offer.services',
      'offer.totalAmount',
      'offer.paymentTerms',
      'offer.deliveryDeadline',
    ],
    recommendedVariables: [
      'offer.adsBudgetResponsibility',
      'offer.revisionLimit',
      'offer.terminationPenalty',
    ],
    variableGroups: [
      {
        key: 'contract',
        label: 'Dados do contrato',
        fields: [
          { key: 'contract.number', label: 'Número do contrato', type: 'text', required: true },
          { key: 'contract.date', label: 'Data do contrato', type: 'date', required: true },
          { key: 'contract.city', label: 'Cidade/UF', type: 'text', required: true },
          { key: 'contract.jurisdiction', label: 'Foro', type: 'text', required: true },
        ],
      },
      {
        key: 'agency',
        label: 'Dados da contratada',
        fields: [
          { key: 'agency.legalName', label: 'Razão social', type: 'text', required: true },
          { key: 'agency.taxId', label: 'CNPJ', type: 'text', required: true },
          { key: 'agency.address', label: 'Endereço comercial', type: 'textarea', required: true },
          { key: 'agency.email', label: 'E-mail comercial', type: 'email', required: true },
          { key: 'agency.signerName', label: 'Responsável pela assinatura', type: 'text', required: true },
        ],
      },
      {
        key: 'client',
        label: 'Dados do cliente',
        fields: [
          { key: 'client.legalName', label: 'Razão social/Nome do cliente', type: 'text', required: true },
          { key: 'client.taxId', label: 'CNPJ/CPF', type: 'text', required: true },
          { key: 'client.address', label: 'Endereço', type: 'textarea', required: true },
          { key: 'client.email', label: 'E-mail comercial', type: 'email', required: true },
        ],
      },
      {
        key: 'responsible',
        label: 'Responsável pelo cliente',
        fields: [
          { key: 'responsible.fullName', label: 'Nome completo', type: 'text', required: true },
          { key: 'responsible.cpf', label: 'CPF', type: 'text', required: true },
          { key: 'responsible.phone', label: 'Telefone', type: 'phone', required: true },
          { key: 'responsible.email', label: 'E-mail', type: 'email', required: true },
        ],
      },
      {
        key: 'offer',
        label: 'Dados da oferta',
        fields: [
          { key: 'offer.services', label: 'Serviços contratados', type: 'textarea', required: true },
          { key: 'offer.totalAmount', label: 'Valor total', type: 'currency', required: true },
          { key: 'offer.paymentTerms', label: 'Forma de pagamento', type: 'textarea', required: true },
          { key: 'offer.deliveryDeadline', label: 'Prazo de entrega', type: 'text', required: true },
          { key: 'offer.revisionLimit', label: 'Limite de revisões', type: 'number' },
          { key: 'offer.terminationPenalty', label: 'Multa rescisória', type: 'textarea' },
        ],
      },
    ],
  },
  {
    key: 'mei_contractor_monthly_services',
    label: 'Prestador MEI/Freelancer — Mensal por entrega',
    description:
      'Modelo para prestadores autônomos, MEIs ou freelancers pagos mensalmente por entregas, sem controle de jornada.',
    category: ContractCategory.MeiContractor,
    targetType: ContractTargetType.TeamMember,
    defaultSignatureMode: ContractSignatureMode.Manual,
    requiredVariables: [
      'contract.number',
      'contract.startDate',
      'contract.endDate',
      'contract.date',
      'contract.city',
      'contract.jurisdiction',
      'contract.autoRenewal',
      'agency.legalName',
      'agency.taxId',
      'agency.address',
      'agency.signerName',
      'contractor.fullName',
      'contractor.cpf',
      'contractor.birthDate',
      'contractor.nationality',
      'contractor.address',
      'role.title',
      'role.description',
      'payment.monthlyAmount',
      'payment.paymentTerms',
      'payment.dueDay',
      'work.executionMode',
    ],
    recommendedVariables: [
      'contractor.companyLegalName',
      'contractor.companyTaxId',
      'payment.billingDocument',
      'work.locationMode',
      'work.noTimeTracking',
      'work.autonomyStatement',
    ],
    variableGroups: [
      {
        key: 'contract',
        label: 'Dados do contrato',
        fields: [
          { key: 'contract.number', label: 'Número do contrato', type: 'text', required: true },
          { key: 'contract.startDate', label: 'Início da vigência', type: 'date', required: true },
          { key: 'contract.endDate', label: 'Fim da vigência', type: 'date', required: true },
          { key: 'contract.autoRenewal', label: 'Renovação automática', type: 'boolean', required: true },
          { key: 'contract.date', label: 'Data de assinatura', type: 'date', required: true },
          { key: 'contract.city', label: 'Cidade/UF', type: 'text', required: true },
          { key: 'contract.jurisdiction', label: 'Foro', type: 'text', required: true },
        ],
      },
      {
        key: 'agency',
        label: 'Dados da empresa contratante',
        fields: [
          { key: 'agency.legalName', label: 'Razão social', type: 'text', required: true },
          { key: 'agency.taxId', label: 'CNPJ', type: 'text', required: true },
          { key: 'agency.address', label: 'Endereço', type: 'textarea', required: true },
          { key: 'agency.signerName', label: 'Representante legal', type: 'text', required: true },
        ],
      },
      {
        key: 'contractor',
        label: 'Dados do prestador',
        fields: [
          { key: 'contractor.companyLegalName', label: 'Razão social do MEI/empresa', type: 'text' },
          { key: 'contractor.companyTaxId', label: 'CNPJ do MEI/empresa', type: 'text' },
          { key: 'contractor.fullName', label: 'Nome completo', type: 'text', required: true },
          { key: 'contractor.cpf', label: 'CPF', type: 'text', required: true },
          { key: 'contractor.birthDate', label: 'Data de nascimento', type: 'date', required: true },
          { key: 'contractor.nationality', label: 'Nacionalidade', type: 'text', required: true },
          { key: 'contractor.address', label: 'Endereço', type: 'textarea', required: true },
        ],
      },
      {
        key: 'role',
        label: 'Função e escopo',
        fields: [
          { key: 'role.title', label: 'Cargo/Função', type: 'text', required: true },
          { key: 'role.description', label: 'Descrição dos serviços', type: 'textarea', required: true },
        ],
      },
      {
        key: 'payment',
        label: 'Pagamento',
        fields: [
          { key: 'payment.monthlyAmount', label: 'Valor mensal', type: 'currency', required: true },
          { key: 'payment.paymentTerms', label: 'Condições de pagamento', type: 'text', required: true, description: 'Ex.: integral, 60/40, quinzenal.' },
          { key: 'payment.dueDay', label: 'Dia de vencimento', type: 'number', required: true },
          { key: 'payment.billingDocument', label: 'Documento de cobrança', type: 'text', description: 'Ex.: Nota Fiscal, RPA, recibo.' },
        ],
      },
      {
        key: 'work',
        label: 'Forma de execução',
        fields: [
          { key: 'work.executionMode', label: 'Por hora ou por trabalho/entrega', type: 'text', required: true },
          { key: 'work.locationMode', label: 'Home office ou local', type: 'text' },
          { key: 'work.noTimeTracking', label: 'Sem controle de jornada', type: 'boolean' },
          { key: 'work.autonomyStatement', label: 'Declaração de autonomia', type: 'textarea' },
        ],
      },
    ],
  },
  {
    key: 'contractor_home_hour_services',
    label: 'Prestador — Home office por hora',
    description:
      'Modelo para prestador autônomo em home office com pagamento por hora efetivamente validada.',
    category: ContractCategory.Freelancer,
    targetType: ContractTargetType.TeamMember,
    defaultSignatureMode: ContractSignatureMode.Manual,
    requiredVariables: [
      'contract.number',
      'contract.termMonths',
      'contract.date',
      'contract.city',
      'contract.jurisdiction',
      'agency.legalName',
      'agency.taxId',
      'agency.address',
      'agency.signerName',
      'contractor.fullName',
      'contractor.cpf',
      'contractor.nationality',
      'contractor.address',
      'role.title',
      'role.description',
      'payment.hourlyAmount',
      'payment.reportDueDay',
      'payment.dueDay',
      'work.locationMode',
    ],
    recommendedVariables: [
      'payment.billingDocument',
      'work.noTimeTracking',
      'work.activitiesApprovalRule',
      'contract.autoRenewal',
    ],
    variableGroups: [
      {
        key: 'contract',
        label: 'Dados do contrato',
        fields: [
          { key: 'contract.number', label: 'Número do contrato', type: 'text', required: true },
          { key: 'contract.termMonths', label: 'Vigência em meses', type: 'number', required: true },
          { key: 'contract.autoRenewal', label: 'Renovação automática', type: 'boolean' },
          { key: 'contract.date', label: 'Data de assinatura', type: 'date', required: true },
          { key: 'contract.city', label: 'Cidade/UF', type: 'text', required: true },
          { key: 'contract.jurisdiction', label: 'Foro', type: 'text', required: true },
        ],
      },
      {
        key: 'agency',
        label: 'Dados da empresa contratante',
        fields: [
          { key: 'agency.legalName', label: 'Razão social', type: 'text', required: true },
          { key: 'agency.taxId', label: 'CNPJ', type: 'text', required: true },
          { key: 'agency.address', label: 'Endereço', type: 'textarea', required: true },
          { key: 'agency.signerName', label: 'Representante legal', type: 'text', required: true },
        ],
      },
      {
        key: 'contractor',
        label: 'Dados do prestador',
        fields: [
          { key: 'contractor.fullName', label: 'Nome completo', type: 'text', required: true },
          { key: 'contractor.cpf', label: 'CPF', type: 'text', required: true },
          { key: 'contractor.nationality', label: 'Nacionalidade', type: 'text', required: true },
          { key: 'contractor.address', label: 'Endereço', type: 'textarea', required: true },
        ],
      },
      {
        key: 'role',
        label: 'Função e escopo',
        fields: [
          { key: 'role.title', label: 'Cargo/Função', type: 'text', required: true },
          { key: 'role.description', label: 'Descrição dos serviços', type: 'textarea', required: true },
        ],
      },
      {
        key: 'payment',
        label: 'Pagamento por hora',
        fields: [
          { key: 'payment.hourlyAmount', label: 'Valor por hora', type: 'currency', required: true },
          { key: 'payment.reportDueDay', label: 'Dia limite para envio de relatório/planilha', type: 'number', required: true },
          { key: 'payment.dueDay', label: 'Dia de pagamento', type: 'number', required: true },
          { key: 'payment.billingDocument', label: 'Documento de cobrança', type: 'text' },
        ],
      },
      {
        key: 'work',
        label: 'Forma de execução',
        fields: [
          { key: 'work.locationMode', label: 'Home office ou local', type: 'text', required: true },
          { key: 'work.noTimeTracking', label: 'Sem controle de jornada', type: 'boolean' },
          { key: 'work.activitiesApprovalRule', label: 'Regra de validação das horas/atividades', type: 'textarea' },
        ],
      },
    ],
  },
];
