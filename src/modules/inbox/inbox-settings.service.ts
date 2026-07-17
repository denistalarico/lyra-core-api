import { Injectable } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import type { RequestContext } from '../../common/context/request-context.interface';
import { PatchInboxSettingsDto } from './dto/patch-inbox-settings.dto';
import { InboxSettingsEntity } from './entities/inbox-settings.entity';

export type EvaluateInboxLeadRulesInput = {
  channelType: string;
  text?: string | null;
  visitor?: {
    name?: string | null;
    email?: string | null;
    phone?: string | null;
  };
};

export type EvaluateInboxLeadRulesResult = {
  isLead: boolean;
  matchedRuleId: string | null;
  matchedRuleName: string | null;
  reason: string | null;
};

const defaultInboxSettings = {
  tags: [
    {
      id: 'tag-new-lead',
      name: 'Novo lead',
      color: '#2563EB',
      status: 'active',
      editable: true,
    },
    {
      id: 'tag-high-intent',
      name: 'Alta intenção',
      color: '#16A34A',
      status: 'active',
      editable: true,
    },
    {
      id: 'tag-budget',
      name: 'Orçamento',
      color: '#F59E0B',
      status: 'active',
      editable: true,
    },
  ],

  channels: [
    {
      type: 'webchat',
      name: 'Webchat',
      status: 'connected',
      enabled: true,
      description: 'Widget público para captar conversas pelo site.',
    },
    {
      type: 'whatsapp',
      name: 'WhatsApp Cloud API',
      status: 'coming_soon',
      enabled: false,
      description: 'Canal oficial para atendimento via WhatsApp.',
    },
    {
      type: 'instagram',
      name: 'Instagram Direct',
      status: 'coming_soon',
      enabled: false,
      description: 'Mensagens diretas do Instagram conectadas ao Inbox.',
    },
    {
      type: 'messenger',
      name: 'Facebook Messenger',
      status: 'coming_soon',
      enabled: false,
      description: 'Mensagens do Facebook centralizadas no Inbox.',
    },
    {
      type: 'email',
      name: 'E-mail',
      status: 'coming_soon',
      enabled: false,
      description: 'Entrada de conversas por caixa de e-mail.',
    },
  ],

  aiAssignmentRules: [
    {
      id: 'ai-rule-whatsapp-default',
      channel: 'whatsapp',
      name: 'IA no WhatsApp dedicado',
      enabled: true,
      triggerMode: 'all_conversations',
      keywords: [],
      action: 'assign_to_ai',
      agentKey: 'main_sales_ai',
      handoffMode: 'on_high_intent',
      description:
        'Toda conversa do número dedicado pode ser assumida pela IA.',
    },
    {
      id: 'ai-rule-instagram-keywords',
      channel: 'instagram',
      name: 'IA por palavra-chave no Instagram',
      enabled: true,
      triggerMode: 'keywords',
      keywords: ['preço', 'valor', 'orçamento', 'atendimento'],
      action: 'assign_to_ai',
      agentKey: 'commercial_ai',
      handoffMode: 'after_qualification',
      description: 'Apenas mensagens com intenção comercial acionam a IA.',
    },
    {
      id: 'ai-rule-facebook-campaign',
      channel: 'messenger',
      name: 'IA por campanha no Messenger',
      enabled: true,
      triggerMode: 'keywords_or_campaign',
      keywords: ['quero saber mais', 'orçamento', 'proposta'],
      action: 'create_lead_and_qualify',
      agentKey: 'commercial_ai',
      handoffMode: 'after_qualification',
      description: 'Converte interações de campanha em lead qualificado.',
    },
  ],

  humanAssignmentRules: [
    {
      id: 'human-rule-random-sales',
      name: 'Rodízio comercial',
      enabled: true,
      strategy: 'random',
      targetRole: 'sales',
      description:
        'Distribuir aleatoriamente entre usuários do time comercial.',
    },
    {
      id: 'human-rule-queue',
      name: 'Ordem da fila',
      enabled: false,
      strategy: 'queue',
      targetRole: 'support',
      description: 'Enviar para o próximo atendente disponível.',
    },
    {
      id: 'human-rule-topic',
      name: 'Por assunto',
      enabled: false,
      strategy: 'topic',
      topics: [
        { keyword: 'pagamento', assignedRole: 'finance' },
        { keyword: 'suporte', assignedRole: 'support' },
        { keyword: 'orçamento', assignedRole: 'sales' },
      ],
      description: 'Direcionar assuntos específicos para usuários ou cargos.',
    },
  ],

  notificationSettings: {
    soundEnabled: true,
    inAppAlertsEnabled: true,
    pushEnabled: false,
    emailEnabled: false,
    quietModeEnabled: false,
    quietHours: {
      start: '18:00',
      end: '08:00',
      timezone: 'America/Sao_Paulo',
    },
  },

  businessHours: {
    enabled: true,
    timezone: 'America/Sao_Paulo',
    days: [
      { day: 'monday', enabled: true, start: '08:00', end: '18:00' },
      { day: 'tuesday', enabled: true, start: '08:00', end: '18:00' },
      { day: 'wednesday', enabled: true, start: '08:00', end: '18:00' },
      { day: 'thursday', enabled: true, start: '08:00', end: '18:00' },
      { day: 'friday', enabled: true, start: '08:00', end: '18:00' },
      { day: 'saturday', enabled: false, start: '08:00', end: '12:00' },
      { day: 'sunday', enabled: false, start: '08:00', end: '12:00' },
    ],
  },

  conversationAutomations: [
    {
      id: 'automation-initial-message',
      type: 'initial_message',
      name: 'Mensagem inicial',
      enabled: true,
      triggerRule: 'always',
      triggerOptions: [
        'always',
        'only_when_ai_active',
        'only_when_human_available',
        'only_outside_business_hours',
        'only_first_conversation',
      ],
      channels: ['webchat', 'whatsapp', 'instagram', 'messenger'],
      message: 'Olá! Recebemos sua mensagem. Como podemos ajudar?',
      description: 'Mensagem enviada ao iniciar uma nova conversa.',
    },
    {
      id: 'automation-out-of-hours',
      type: 'status_message',
      name: 'Mensagem fora do horário',
      enabled: true,
      triggerRule: 'outside_business_hours',
      channels: ['webchat', 'whatsapp', 'instagram', 'messenger'],
      message:
        'No momento estamos fora do horário de atendimento. Assim que retornarmos, vamos te responder.',
      description:
        'Mensagem enviada quando a conversa chega fora do horário configurado.',
    },
  ],

  quickReplies: [
    {
      id: 'quick-reply-price',
      shortcut: '/preco',
      title: 'Explicar valores',
      message:
        'Nossos valores dependem do objetivo e estrutura necessária. Posso te fazer algumas perguntas rápidas?',
      enabled: true,
    },
    {
      id: 'quick-reply-budget',
      shortcut: '/orcamento',
      title: 'Solicitar briefing',
      message:
        'Para preparar um orçamento, preciso entender seu negócio, objetivo e prazo desejado.',
      enabled: true,
    },
    {
      id: 'quick-reply-schedule',
      shortcut: '/agendar',
      title: 'Enviar agendamento',
      message:
        'Podemos agendar uma conversa rápida para entender melhor sua necessidade.',
      enabled: true,
    },
    {
      id: 'quick-reply-support',
      shortcut: '/suporte',
      title: 'Direcionar suporte',
      message: 'Vou encaminhar sua solicitação para o suporte responsável.',
      enabled: true,
    },
  ],

  leadRules: [
    {
      id: 'lead-rule-whatsapp-dedicated',
      channel: 'whatsapp',
      name: 'WhatsApp dedicado comercial',
      enabled: true,
      mode: 'all_conversations',
      description: 'Toda conversa do número comercial é tratada como lead.',
    },
    {
      id: 'lead-rule-webchat-identified',
      channel: 'webchat',
      name: 'Webchat identificado',
      enabled: true,
      mode: 'identified_or_keyword',
      keywords: ['preço', 'valor', 'orçamento', 'proposta', 'agendar'],
      description:
        'Webchat vira lead quando há identificação ou intenção comercial.',
    },
    {
      id: 'lead-rule-social-keywords',
      channel: 'instagram',
      name: 'Redes sociais por intenção',
      enabled: true,
      mode: 'keywords',
      keywords: ['preço', 'valor', 'orçamento', 'quero saber mais'],
      description:
        'Mensagens sociais só viram lead quando indicam intenção comercial.',
    },
  ],

  metadata: {
    composerSendMode: 'ctrl_enter',
  },
};

@Injectable()
export class InboxSettingsService {
  constructor(
    @InjectRepository(InboxSettingsEntity, 'agency')
    private readonly settingsRepository: Repository<InboxSettingsEntity>,
  ) {}

  async getSettings(ctx: RequestContext) {
    return this.ensureSettings(ctx);
  }

  async patchSettings(ctx: RequestContext, dto: PatchInboxSettingsDto) {
    const settings = await this.ensureSettings(ctx);

    if (dto.tags !== undefined) settings.tags = dto.tags;
    if (dto.channels !== undefined) settings.channels = dto.channels;
    if (dto.aiAssignmentRules !== undefined) {
      settings.aiAssignmentRules = dto.aiAssignmentRules;
    }
    if (dto.humanAssignmentRules !== undefined) {
      settings.humanAssignmentRules = dto.humanAssignmentRules;
    }
    if (dto.notificationSettings !== undefined) {
      settings.notificationSettings = dto.notificationSettings;
    }
    if (dto.businessHours !== undefined) {
      settings.businessHours = dto.businessHours;
    }
    if (dto.conversationAutomations !== undefined) {
      settings.conversationAutomations = dto.conversationAutomations;
    }
    if (dto.quickReplies !== undefined)
      settings.quickReplies = dto.quickReplies;
    if (dto.leadRules !== undefined) settings.leadRules = dto.leadRules;
    if (dto.metadata !== undefined) settings.metadata = dto.metadata;

    return this.settingsRepository.save(settings);
  }

  private async ensureSettings(ctx: RequestContext) {
    let settings = await this.settingsRepository.findOne({
      where: {
        tenantId: ctx.tenantId,
        workspaceId: ctx.workspaceId,
      },
    });

    if (settings) {
      if (!settings.metadata?.composerSendMode) {
        settings.metadata = {
          ...(settings.metadata ?? {}),
          composerSendMode: 'ctrl_enter',
        };

        return this.settingsRepository.save(settings);
      }

      return settings;
    }

    settings = this.settingsRepository.create({
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      ...defaultInboxSettings,
    });

    return this.settingsRepository.save(settings);
  }
  async evaluateLeadRules(
    ctx: RequestContext,
    input: EvaluateInboxLeadRulesInput,
  ): Promise<EvaluateInboxLeadRulesResult> {
    const settings = await this.ensureSettings(ctx);
    const normalizedChannel = input.channelType.toLowerCase();
    const normalizedText = (input.text ?? '').toLowerCase();

    const rules = settings.leadRules.filter((rule) => {
      const enabled = rule.enabled !== false;
      const channel =
        typeof rule.channel === 'string' ? rule.channel.toLowerCase() : '';

      return enabled && channel === normalizedChannel;
    });

    for (const rule of rules) {
      const mode = typeof rule.mode === 'string' ? rule.mode : '';
      const ruleId = typeof rule.id === 'string' ? rule.id : null;
      const ruleName = typeof rule.name === 'string' ? rule.name : null;

      if (mode === 'all_conversations') {
        return {
          isLead: true,
          matchedRuleId: ruleId,
          matchedRuleName: ruleName,
          reason: 'all_conversations',
        };
      }

      const hasVisitorIdentity = Boolean(
        input.visitor?.name || input.visitor?.email || input.visitor?.phone,
      );

      if (mode === 'identified_or_keyword' && hasVisitorIdentity) {
        return {
          isLead: true,
          matchedRuleId: ruleId,
          matchedRuleName: ruleName,
          reason: 'visitor_identified',
        };
      }

      const keywords = Array.isArray(rule.keywords) ? rule.keywords : [];
      const matchedKeyword = keywords.find((keyword) => {
        return normalizedText.includes(String(keyword).toLowerCase());
      });

      if (matchedKeyword) {
        return {
          isLead: true,
          matchedRuleId: ruleId,
          matchedRuleName: ruleName,
          reason: `keyword:${String(matchedKeyword)}`,
        };
      }
    }

    return {
      isLead: false,
      matchedRuleId: null,
      matchedRuleName: null,
      reason: null,
    };
  }
}
