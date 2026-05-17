export type MetaWhatsAppWebhookPayload = {
  object?: string;
  entry?: MetaWhatsAppEntry[];
};

export type MetaWhatsAppEntry = {
  id?: string;
  changes?: MetaWhatsAppChange[];
};

export type MetaWhatsAppChange = {
  field?: string;
  value?: MetaWhatsAppChangeValue;
};

export type MetaWhatsAppChangeValue = {
  messaging_product?: string;
  metadata?: {
    display_phone_number?: string;
    phone_number_id?: string;
  };
  contacts?: Array<{
    profile?: {
      name?: string;
    };
    wa_id?: string;
  }>;
  messages?: MetaWhatsAppMessage[];
  statuses?: MetaWhatsAppStatus[];
};

export type MetaWhatsAppMessage = {
  from?: string;
  id?: string;
  timestamp?: string;
  type?: string;
  text?: {
    body?: string;
  };
  image?: MetaWhatsAppMedia;
  audio?: MetaWhatsAppMedia;
  video?: MetaWhatsAppMedia;
  document?: MetaWhatsAppDocument;
  location?: {
    latitude?: number;
    longitude?: number;
    name?: string;
    address?: string;
  };
  contacts?: unknown[];
  button?: {
    text?: string;
    payload?: string;
  };
  interactive?: unknown;
};

export type MetaWhatsAppMedia = {
  id?: string;
  mime_type?: string;
  sha256?: string;
  caption?: string;
};

export type MetaWhatsAppDocument = MetaWhatsAppMedia & {
  filename?: string;
};

export type MetaWhatsAppStatus = {
  id?: string;
  status?: 'sent' | 'delivered' | 'read' | 'failed' | string;
  timestamp?: string;
  recipient_id?: string;
  conversation?: Record<string, unknown>;
  pricing?: Record<string, unknown>;
  errors?: unknown[];
};
