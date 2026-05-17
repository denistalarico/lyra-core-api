export type NormalizedInboundChannelType =
  | 'internal'
  | 'webchat'
  | 'whatsapp'
  | 'instagram'
  | 'facebook_messenger'
  | 'email'
  | 'phone'
  | 'other';

export type NormalizedInboundMessageType =
  | 'text'
  | 'image'
  | 'audio'
  | 'video'
  | 'file'
  | 'location'
  | 'contact'
  | 'system'
  | 'unknown';

export type NormalizedInboundSender = {
  externalId: string;
  name?: string | null;
  phone?: string | null;
  email?: string | null;
  username?: string | null;
  metadata?: Record<string, unknown>;
};

export type NormalizedInboundAttachment = {
  type: string;
  url?: string | null;
  mimeType?: string | null;
  filename?: string | null;
  size?: number | null;
  externalId?: string | null;
  metadata?: Record<string, unknown>;
};

export type NormalizedInboundMessage = {
  tenantId: string;
  workspaceId: string;

  channelId: string;
  channelType: NormalizedInboundChannelType;
  provider?: string | null;

  externalThreadId: string;
  externalMessageId?: string | null;

  sender: NormalizedInboundSender;

  messageType: NormalizedInboundMessageType;
  content: string;

  attachments?: NormalizedInboundAttachment[];

  occurredAt?: Date;

  rawPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
