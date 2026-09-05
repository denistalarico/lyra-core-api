import type { SocialPlannerSettings } from './contracts';

export const DEFAULT_SOCIAL_PLANNER_SETTINGS: SocialPlannerSettings = {
  monthlyContentVolume: 8,

  funnelDistribution: {
    discovery: 37.5,
    recognition: 25,
    consideration: 25,
    decision: 12.5,
  },

  contentTypes: [
    { key: 'informative', label: 'Informativo', enabled: true },
    { key: 'infographic', label: 'Infográfico', enabled: true },
    { key: 'question', label: 'Pergunta', enabled: true },
    { key: 'behind_scenes', label: 'Bastidores', enabled: true },
    { key: 'meme', label: 'Meme', enabled: true },
    { key: 'promotion', label: 'Divulgação', enabled: true },
    { key: 'news', label: 'Notícia', enabled: true },
    { key: 'tips', label: 'Dicas', enabled: true },
    { key: 'results', label: 'Resultados', enabled: true },
    { key: 'commemorative', label: 'Comemorativo', enabled: true },
    { key: 'curiosities', label: 'Curiosidades', enabled: true },
    { key: 'feedback', label: 'Feedback', enabled: true },
    { key: 'storytelling', label: 'Storytelling', enabled: true },
    { key: 'photography', label: 'Fotografia', enabled: true },
    { key: 'demonstration', label: 'Demonstração', enabled: true },
    { key: 'pas', label: 'PAS', enabled: true },
    { key: 'aida', label: 'AIDA', enabled: true },
    { key: 'offer', label: 'Oferta', enabled: true },
  ],

  objectives: [
    { key: 'awareness', label: 'Reconhecimento', enabled: true },
    { key: 'engagement', label: 'Engajamento', enabled: true },
    { key: 'education', label: 'Educação', enabled: true },
    { key: 'authority', label: 'Autoridade', enabled: true },
    { key: 'traffic', label: 'Tráfego', enabled: true },
    { key: 'leads', label: 'Leads', enabled: true },
    { key: 'conversion', label: 'Conversão', enabled: true },
    {
      key: 'retention_community',
      label: 'Retenção / Comunidade',
      enabled: true,
    },
  ],

  creativeFormats: [
    { key: 'image', label: 'Imagem', enabled: true },
    { key: 'carousel', label: 'Carrossel', enabled: true },
    { key: 'short_video', label: 'Reel / Vídeo curto', enabled: true },
    { key: 'story', label: 'Story', enabled: true },
  ],

  ctaDefaults: {
    awareness: ['Saiba mais', 'Siga para acompanhar'],
    engagement: ['Comente', 'Salve este post', 'Compartilhe'],
    education: ['Salve para consultar depois'],
    authority: ['Saiba mais'],
    traffic: ['Acesse o link'],
    leads: ['Fale conosco', 'Solicite um orçamento'],
    conversion: ['Compre agora', 'Fale conosco'],
    retention_community: ['Compartilhe', 'Conte sua experiência'],
  },

  hashtagDefaults: {
    mandatory: [],
    suggestedCount: 5,
    complementWithAi: true,
  },

  firstCommentDefaults: {
    enabled: false,
    template: null,
  },

  hookLibrary: [],

  milestones: [
    {
      key: 'copy',
      label: 'Copy',
      daysBeforePublication: 7,
      enabled: true,
    },
    {
      key: 'creative',
      label: 'Criativo',
      daysBeforePublication: 4,
      enabled: true,
    },
    {
      key: 'approval',
      label: 'Aprovação',
      daysBeforePublication: 3,
      enabled: true,
    },
    {
      key: 'scheduling',
      label: 'Programação',
      daysBeforePublication: 1,
      enabled: true,
    },
  ],
};
