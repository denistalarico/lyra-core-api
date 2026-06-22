export type ClientLifecycleStepTypeScope = 'onboarding' | 'offboarding' | 'both';

type ClientLifecycleStepTypePreset = {
  name: string;
  description: string;
  color: string;
  metadata: {
    systemKey: string;
    isSystemDefault: true;
    icon: string;
    scope: ClientLifecycleStepTypeScope;
    sortOrder: number;
  };
};

/**
 * Presets padrão de client_lifecycle_step_type. Cada item é garantido individualmente
 * por `metadata.systemKey` (ver ensureClientLifecycleStepTypeDefaults em team.service.ts),
 * nunca pela lista inteira — assim novos presets podem ser adicionados aqui sem
 * afetar tenants que já têm os anteriores.
 */
export const CLIENT_LIFECYCLE_STEP_TYPE_PRESETS: ClientLifecycleStepTypePreset[] = [
  // Escopo "both" (12)
  { name: 'Checklist', description: 'Lista geral de itens a cumprir.', color: 'slate', metadata: { systemKey: 'checklist', isSystemDefault: true, icon: 'CheckSquare', scope: 'both', sortOrder: 1 } },
  { name: 'Documento', description: 'Envio, coleta ou revisão de documentos.', color: 'blue', metadata: { systemKey: 'document', isSystemDefault: true, icon: 'FileText', scope: 'both', sortOrder: 2 } },
  { name: 'Contrato', description: 'Assinatura, revisão ou encerramento contratual.', color: 'indigo', metadata: { systemKey: 'contract', isSystemDefault: true, icon: 'FileSignature', scope: 'both', sortOrder: 3 } },
  { name: 'Aprovação', description: 'Aprovação de responsável, financeiro ou jurídico.', color: 'emerald', metadata: { systemKey: 'approval', isSystemDefault: true, icon: 'BadgeCheck', scope: 'both', sortOrder: 4 } },
  { name: 'Reunião', description: 'Reunião de alinhamento, boas-vindas ou encerramento.', color: 'sky', metadata: { systemKey: 'meeting', isSystemDefault: true, icon: 'CalendarDays', scope: 'both', sortOrder: 5 } },
  { name: 'Acessos', description: 'Criação, revisão ou remoção de acessos.', color: 'violet', metadata: { systemKey: 'access', isSystemDefault: true, icon: 'KeyRound', scope: 'both', sortOrder: 6 } },
  { name: 'Financeiro', description: 'Pagamentos, cobranças, reembolsos ou acertos.', color: 'green', metadata: { systemKey: 'finance', isSystemDefault: true, icon: 'Wallet', scope: 'both', sortOrder: 7 } },
  { name: 'Comunicação', description: 'Avisos, comunicações e notificações ao cliente.', color: 'amber', metadata: { systemKey: 'communication', isSystemDefault: true, icon: 'Megaphone', scope: 'both', sortOrder: 8 } },
  { name: 'Transferência', description: 'Passagem de conhecimento, contas ou responsabilidades.', color: 'purple', metadata: { systemKey: 'handoff', isSystemDefault: true, icon: 'ArrowRightLeft', scope: 'both', sortOrder: 9 } },
  { name: 'Revisão', description: 'Conferência de etapas, entregas ou pendências.', color: 'cyan', metadata: { systemKey: 'review', isSystemDefault: true, icon: 'ClipboardCheck', scope: 'both', sortOrder: 10 } },
  { name: 'Feedback', description: 'Coleta de percepção, avaliação ou retorno do cliente.', color: 'pink', metadata: { systemKey: 'feedback', isSystemDefault: true, icon: 'MessageSquareText', scope: 'both', sortOrder: 11 } },
  { name: 'Personalizado', description: 'Tipo personalizado definido pelo usuário.', color: 'slate', metadata: { systemKey: 'custom', isSystemDefault: true, icon: 'Sparkles', scope: 'both', sortOrder: 12 } },

  // Escopo "onboarding" (14)
  { name: 'Boas-vindas', description: 'Boas-vindas, apresentação inicial e acolhimento do cliente.', color: 'teal', metadata: { systemKey: 'welcome', isSystemDefault: true, icon: 'PartyPopper', scope: 'onboarding', sortOrder: 13 } },
  { name: 'Cadastro do cliente', description: 'Preenchimento e conferência dos dados do cliente.', color: 'blue', metadata: { systemKey: 'client_profile', isSystemDefault: true, icon: 'Building2', scope: 'onboarding', sortOrder: 14 } },
  { name: 'Descoberta', description: 'Levantamento de histórico, concorrência e objetivos.', color: 'amber', metadata: { systemKey: 'discovery', isSystemDefault: true, icon: 'Search', scope: 'onboarding', sortOrder: 15 } },
  { name: 'Briefing', description: 'Coleta de briefing e direcionamento estratégico.', color: 'orange', metadata: { systemKey: 'briefing', isSystemDefault: true, icon: 'ClipboardList', scope: 'onboarding', sortOrder: 16 } },
  { name: 'Alinhamento de escopo', description: 'Alinhamento de escopo, fee e expectativas contratuais.', color: 'rose', metadata: { systemKey: 'scope_alignment', isSystemDefault: true, icon: 'Target', scope: 'onboarding', sortOrder: 17 } },
  { name: 'Kickoff', description: 'Reunião de início e apresentação da equipe responsável.', color: 'violet', metadata: { systemKey: 'kickoff', isSystemDefault: true, icon: 'Rocket', scope: 'onboarding', sortOrder: 18 } },
  { name: 'Materiais da marca', description: 'Coleta de logotipos, manuais e materiais de marca.', color: 'pink', metadata: { systemKey: 'brand_assets', isSystemDefault: true, icon: 'Palette', scope: 'onboarding', sortOrder: 19 } },
  { name: 'Configuração de plataformas', description: 'Configuração de ferramentas e plataformas do cliente.', color: 'indigo', metadata: { systemKey: 'platform_setup', isSystemDefault: true, icon: 'Settings2', scope: 'onboarding', sortOrder: 20 } },
  { name: 'Configuração de rastreamento', description: 'Configuração de pixels, tags e ferramentas de tracking.', color: 'cyan', metadata: { systemKey: 'tracking_setup', isSystemDefault: true, icon: 'ChartNoAxesCombined', scope: 'onboarding', sortOrder: 21 } },
  { name: 'Configuração de cobrança', description: 'Configuração de faturamento e condições financeiras.', color: 'green', metadata: { systemKey: 'billing_setup', isSystemDefault: true, icon: 'CreditCard', scope: 'onboarding', sortOrder: 22 } },
  { name: 'Canais de comunicação', description: 'Definição de canais e rotinas de comunicação com o cliente.', color: 'sky', metadata: { systemKey: 'communication_setup', isSystemDefault: true, icon: 'MessagesSquare', scope: 'onboarding', sortOrder: 23 } },
  { name: 'Fluxo de trabalho', description: 'Definição do fluxo operacional e responsabilidades internas.', color: 'purple', metadata: { systemKey: 'workflow_setup', isSystemDefault: true, icon: 'Workflow', scope: 'onboarding', sortOrder: 24 } },
  { name: 'Primeira entrega', description: 'Primeira entrega e validação junto ao cliente.', color: 'orange', metadata: { systemKey: 'first_delivery', isSystemDefault: true, icon: 'PackageCheck', scope: 'onboarding', sortOrder: 25 } },
  { name: 'Ativação', description: 'Ativação plena do cliente nos serviços contratados.', color: 'green', metadata: { systemKey: 'activation', isSystemDefault: true, icon: 'CirclePlay', scope: 'onboarding', sortOrder: 26 } },

  // Escopo "offboarding" (14)
  { name: 'Aviso de encerramento', description: 'Registro e comunicação do início do encerramento.', color: 'amber', metadata: { systemKey: 'notice', isSystemDefault: true, icon: 'Bell', scope: 'offboarding', sortOrder: 27 } },
  { name: 'Encerramento contratual', description: 'Formalização do encerramento do contrato.', color: 'red', metadata: { systemKey: 'termination', isSystemDefault: true, icon: 'FileX2', scope: 'offboarding', sortOrder: 28 } },
  { name: 'Cobrança final', description: 'Emissão e conferência da cobrança final.', color: 'green', metadata: { systemKey: 'final_invoice', isSystemDefault: true, icon: 'ReceiptText', scope: 'offboarding', sortOrder: 29 } },
  { name: 'Remoção de acessos', description: 'Revogação de acessos e contas da agência nas plataformas do cliente.', color: 'red', metadata: { systemKey: 'access_revocation', isSystemDefault: true, icon: 'LockKeyhole', scope: 'offboarding', sortOrder: 30 } },
  { name: 'Entrega de ativos', description: 'Entrega de arquivos, artes e materiais ao cliente.', color: 'orange', metadata: { systemKey: 'asset_delivery', isSystemDefault: true, icon: 'PackageOpen', scope: 'offboarding', sortOrder: 31 } },
  { name: 'Exportação de dados', description: 'Exportação de bases, relatórios e históricos.', color: 'blue', metadata: { systemKey: 'data_export', isSystemDefault: true, icon: 'Download', scope: 'offboarding', sortOrder: 32 } },
  { name: 'Transferência de conhecimento', description: 'Documentação de processos, status e pendências do cliente.', color: 'purple', metadata: { systemKey: 'knowledge_transfer', isSystemDefault: true, icon: 'BookOpenCheck', scope: 'offboarding', sortOrder: 33 } },
  { name: 'Encerramento de projetos', description: 'Finalização de projetos e atividades em andamento.', color: 'indigo', metadata: { systemKey: 'project_closure', isSystemDefault: true, icon: 'FolderCheck', scope: 'offboarding', sortOrder: 34 } },
  { name: 'Encerramento de campanhas', description: 'Pausa ou encerramento de campanhas ativas.', color: 'red', metadata: { systemKey: 'campaign_shutdown', isSystemDefault: true, icon: 'CircleStop', scope: 'offboarding', sortOrder: 35 } },
  { name: 'Relatório final', description: 'Relatório completo de resultados do período.', color: 'blue', metadata: { systemKey: 'final_report', isSystemDefault: true, icon: 'ChartColumnBig', scope: 'offboarding', sortOrder: 36 } },
  { name: 'Feedback de saída', description: 'Coleta de motivos, percepções e aprendizados de saída.', color: 'pink', metadata: { systemKey: 'exit_feedback', isSystemDefault: true, icon: 'MessagesSquare', scope: 'offboarding', sortOrder: 37 } },
  { name: 'Retenção / renegociação', description: 'Tentativa de retenção ou renegociação antes do encerramento.', color: 'emerald', metadata: { systemKey: 'retention', isSystemDefault: true, icon: 'Handshake', scope: 'offboarding', sortOrder: 38 } },
  { name: 'Arquivamento', description: 'Registro do encerramento e arquivamento do cliente.', color: 'zinc', metadata: { systemKey: 'archive', isSystemDefault: true, icon: 'Archive', scope: 'offboarding', sortOrder: 39 } },
  { name: 'Encerramento do relacionamento', description: 'Mensagem final e encerramento do relacionamento com o cliente.', color: 'teal', metadata: { systemKey: 'farewell', isSystemDefault: true, icon: 'HeartHandshake', scope: 'offboarding', sortOrder: 40 } },
];

export const CLIENT_LIFECYCLE_STEP_TYPE_DEFAULT_ICON = 'Sparkles';
