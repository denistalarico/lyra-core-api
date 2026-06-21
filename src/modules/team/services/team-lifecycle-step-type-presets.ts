export type LifecycleStepTypeScope = 'onboarding' | 'offboarding' | 'both';

type LifecycleStepTypePreset = {
  name: string;
  description: string;
  color: string;
  metadata: {
    systemKey: string;
    isSystemDefault: true;
    icon: string;
    scope: LifecycleStepTypeScope;
    sortOrder: number;
  };
};

/**
 * Presets padrão de lifecycle_step_type. Cada item é garantido individualmente
 * por `metadata.systemKey` (ver ensureLifecycleStepTypeDefaults em team.service.ts),
 * nunca pela lista inteira — assim novos presets podem ser adicionados aqui sem
 * afetar tenants que já têm os anteriores.
 */
export const TEAM_LIFECYCLE_STEP_TYPE_PRESETS: LifecycleStepTypePreset[] = [
  {
    name: 'Checklist',
    description: 'Lista geral de itens a cumprir.',
    color: 'slate',
    metadata: { systemKey: 'checklist', isSystemDefault: true, icon: 'CheckSquare', scope: 'both', sortOrder: 1 },
  },
  {
    name: 'Documento',
    description: 'Envio, coleta ou revisão de documentos.',
    color: 'blue',
    metadata: { systemKey: 'document', isSystemDefault: true, icon: 'FileText', scope: 'both', sortOrder: 2 },
  },
  {
    name: 'Contrato',
    description: 'Assinatura, revisão ou encerramento contratual.',
    color: 'indigo',
    metadata: { systemKey: 'contract', isSystemDefault: true, icon: 'FileSignature', scope: 'both', sortOrder: 3 },
  },
  {
    name: 'Aprovação',
    description: 'Aprovação de gestor, financeiro, jurídico ou responsável.',
    color: 'emerald',
    metadata: { systemKey: 'approval', isSystemDefault: true, icon: 'BadgeCheck', scope: 'both', sortOrder: 4 },
  },
  {
    name: 'Reunião',
    description: 'Reunião de alinhamento, boas-vindas ou desligamento.',
    color: 'sky',
    metadata: { systemKey: 'meeting', isSystemDefault: true, icon: 'CalendarDays', scope: 'both', sortOrder: 5 },
  },
  {
    name: 'Acessos',
    description: 'Criação, revisão ou remoção de acessos.',
    color: 'violet',
    metadata: { systemKey: 'access', isSystemDefault: true, icon: 'KeyRound', scope: 'both', sortOrder: 6 },
  },
  {
    name: 'Equipamentos',
    description: 'Entrega, devolução ou conferência de equipamentos.',
    color: 'zinc',
    metadata: { systemKey: 'equipment', isSystemDefault: true, icon: 'Laptop', scope: 'both', sortOrder: 7 },
  },
  {
    name: 'Financeiro',
    description: 'Pagamentos, benefícios, reembolsos ou acertos.',
    color: 'green',
    metadata: { systemKey: 'finance', isSystemDefault: true, icon: 'Wallet', scope: 'both', sortOrder: 8 },
  },
  {
    name: 'Comunicação',
    description: 'Avisos internos, comunicações e notificações.',
    color: 'amber',
    metadata: { systemKey: 'communication', isSystemDefault: true, icon: 'Megaphone', scope: 'both', sortOrder: 9 },
  },
  {
    name: 'Transferência',
    description: 'Passagem de conhecimento, responsabilidades ou projetos.',
    color: 'purple',
    metadata: { systemKey: 'handoff', isSystemDefault: true, icon: 'ArrowRightLeft', scope: 'both', sortOrder: 10 },
  },
  {
    name: 'Feedback',
    description: 'Coleta de percepção, avaliação ou retorno.',
    color: 'pink',
    metadata: { systemKey: 'feedback', isSystemDefault: true, icon: 'MessageSquareText', scope: 'both', sortOrder: 11 },
  },
  {
    name: 'Revisão final',
    description: 'Conferência final antes de concluir o processo.',
    color: 'cyan',
    metadata: { systemKey: 'review', isSystemDefault: true, icon: 'ClipboardCheck', scope: 'both', sortOrder: 12 },
  },
  {
    name: 'Boas-vindas',
    description: 'Boas-vindas, apresentação inicial e acolhimento.',
    color: 'teal',
    metadata: { systemKey: 'welcome', isSystemDefault: true, icon: 'PartyPopper', scope: 'onboarding', sortOrder: 13 },
  },
  {
    name: 'Cadastro do perfil',
    description: 'Preenchimento e conferência dos dados do colaborador.',
    color: 'blue',
    metadata: { systemKey: 'profile_setup', isSystemDefault: true, icon: 'UserRoundCog', scope: 'onboarding', sortOrder: 14 },
  },
  {
    name: 'Configuração do ambiente',
    description: 'Preparação de ferramentas, workspace, canais e rotinas.',
    color: 'violet',
    metadata: { systemKey: 'workspace_setup', isSystemDefault: true, icon: 'Settings2', scope: 'onboarding', sortOrder: 15 },
  },
  {
    name: 'Alinhamento da função',
    description: 'Alinhamento de cargo, responsabilidades, metas e escopo.',
    color: 'orange',
    metadata: { systemKey: 'role_alignment', isSystemDefault: true, icon: 'Target', scope: 'onboarding', sortOrder: 16 },
  },
  {
    name: 'Treinamento',
    description: 'Capacitação, manuais, vídeos e orientações.',
    color: 'yellow',
    metadata: { systemKey: 'training', isSystemDefault: true, icon: 'GraduationCap', scope: 'onboarding', sortOrder: 17 },
  },
  {
    name: 'Cultura e políticas',
    description: 'Valores, políticas internas e boas práticas.',
    color: 'lime',
    metadata: { systemKey: 'culture', isSystemDefault: true, icon: 'Landmark', scope: 'onboarding', sortOrder: 18 },
  },
  {
    name: 'Primeira tarefa',
    description: 'Primeira entrega guiada ou atividade prática.',
    color: 'rose',
    metadata: { systemKey: 'first_task', isSystemDefault: true, icon: 'Rocket', scope: 'onboarding', sortOrder: 19 },
  },
  {
    name: 'Período de experiência',
    description: 'Acompanhamento inicial, milestones e avaliação.',
    color: 'amber',
    metadata: { systemKey: 'probation', isSystemDefault: true, icon: 'Hourglass', scope: 'onboarding', sortOrder: 20 },
  },
  {
    name: 'Aviso de desligamento',
    description: 'Registro e comunicação do início do desligamento.',
    color: 'amber',
    metadata: { systemKey: 'notice', isSystemDefault: true, icon: 'Bell', scope: 'offboarding', sortOrder: 21 },
  },
  {
    name: 'Entrevista de desligamento',
    description: 'Conversa final, motivos, feedbacks e aprendizados.',
    color: 'pink',
    metadata: { systemKey: 'exit_interview', isSystemDefault: true, icon: 'MessagesSquare', scope: 'offboarding', sortOrder: 22 },
  },
  {
    name: 'Remoção de acessos',
    description: 'Revogação de contas, permissões e sistemas.',
    color: 'red',
    metadata: { systemKey: 'access_revocation', isSystemDefault: true, icon: 'LockKeyhole', scope: 'offboarding', sortOrder: 23 },
  },
  {
    name: 'Devolução de equipamentos',
    description: 'Devolução de notebook, celular, crachá ou materiais.',
    color: 'orange',
    metadata: { systemKey: 'asset_return', isSystemDefault: true, icon: 'PackageCheck', scope: 'offboarding', sortOrder: 24 },
  },
  {
    name: 'Transferência de conhecimento',
    description: 'Documentação de processos, status e pendências.',
    color: 'purple',
    metadata: { systemKey: 'knowledge_transfer', isSystemDefault: true, icon: 'BookOpenCheck', scope: 'offboarding', sortOrder: 25 },
  },
  {
    name: 'Transição de projetos',
    description: 'Redistribuição de tarefas, clientes e responsabilidades.',
    color: 'indigo',
    metadata: { systemKey: 'project_transition', isSystemDefault: true, icon: 'GitBranch', scope: 'offboarding', sortOrder: 26 },
  },
  {
    name: 'Acerto final',
    description: 'Pagamento final, reembolsos, benefícios e descontos.',
    color: 'green',
    metadata: { systemKey: 'final_payment', isSystemDefault: true, icon: 'ReceiptText', scope: 'offboarding', sortOrder: 27 },
  },
  {
    name: 'Documento de encerramento',
    description: 'Termo de desligamento, encerramento ou declaração.',
    color: 'red',
    metadata: { systemKey: 'termination_document', isSystemDefault: true, icon: 'FileX2', scope: 'offboarding', sortOrder: 28 },
  },
  {
    name: 'Encerramento de conta',
    description: 'Finalização de cadastro, vínculo e registros internos.',
    color: 'zinc',
    metadata: { systemKey: 'account_closure', isSystemDefault: true, icon: 'UserRoundX', scope: 'offboarding', sortOrder: 29 },
  },
  {
    name: 'Encerramento',
    description: 'Mensagem final, agradecimento e comunicação ao time.',
    color: 'teal',
    metadata: { systemKey: 'farewell', isSystemDefault: true, icon: 'Handshake', scope: 'offboarding', sortOrder: 30 },
  },
  {
    name: 'Personalizado',
    description: 'Tipo personalizado definido pelo usuário.',
    color: 'slate',
    metadata: { systemKey: 'custom', isSystemDefault: true, icon: 'Sparkles', scope: 'both', sortOrder: 31 },
  },
];

export const LIFECYCLE_STEP_TYPE_DEFAULT_ICON = 'Sparkles';
