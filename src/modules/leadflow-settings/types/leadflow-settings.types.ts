export type LeadFlowJsonObject = Record<string, unknown>;

export type LeadFlowAppInstanceStatus =
  | 'active'
  | 'inactive'
  | 'pending'
  | 'disabled';

export type LeadFlowAppInstance = {
  id: string;
  label: string;
  purpose: string;
  status: LeadFlowAppInstanceStatus;
};

export type LeadFlowAppConfig = {
  enabled: boolean;
  limit: number;
  instances: LeadFlowAppInstance[];
};

export type LeadFlowEnabledAppsConfig = Record<string, LeadFlowAppConfig>;

export type LeadFlowIntegrationConnection = {
  id: string;
  channelId?: string | null;
  widgetId?: string | null;
  label: string;
  purpose: string;
  status: LeadFlowAppInstanceStatus;
};

export type LeadFlowIntegrationConfig = {
  enabled: boolean;
  provider: string;
  limit: number;
  connections: LeadFlowIntegrationConnection[];
};

export type LeadFlowEnabledIntegrationsConfig = Record<
  string,
  LeadFlowIntegrationConfig
>;

export const DEFAULT_LEADFLOW_ENABLED_APPS_SCHEMA: LeadFlowEnabledAppsConfig = {
  webchat: {
    enabled: true,
    limit: 1,
    instances: [
      {
        id: 'default',
        label: 'Webchat principal',
        purpose: 'leads',
        status: 'active',
      },
    ],
  },
  whatsapp: {
    enabled: true,
    limit: 3,
    instances: [
      {
        id: 'leads',
        label: 'WhatsApp Leads',
        purpose: 'lead_capture',
        status: 'active',
      },
      {
        id: 'support',
        label: 'WhatsApp Suporte',
        purpose: 'support',
        status: 'active',
      },
    ],
  },
  forms: {
    enabled: false,
    limit: 0,
    instances: [],
  },
  appointments: {
    enabled: false,
    limit: 0,
    instances: [],
  },
  contacts: {
    enabled: true,
    limit: 1,
    instances: [
      {
        id: 'default',
        label: 'Contatos',
        purpose: 'relationship',
        status: 'active',
      },
    ],
  },
  quotes: {
    enabled: false,
    limit: 0,
    instances: [],
  },
  email: {
    enabled: false,
    limit: 0,
    instances: [],
  },
};

export const DEFAULT_LEADFLOW_ENABLED_INTEGRATIONS_SCHEMA: LeadFlowEnabledIntegrationsConfig =
  {
    whatsapp: {
      enabled: true,
      provider: 'meta',
      limit: 3,
      connections: [
        {
          id: 'leads',
          channelId: null,
          label: 'WhatsApp Leads',
          purpose: 'lead_capture',
          status: 'pending',
        },
      ],
    },
    webchat: {
      enabled: true,
      provider: 'lyra_webchat',
      limit: 1,
      connections: [
        {
          id: 'default',
          widgetId: null,
          label: 'Webchat principal',
          purpose: 'lead_capture',
          status: 'pending',
        },
      ],
    },
  };
