export type NormalizedMessageDeliveryStatus =
  | 'sent'
  | 'delivered'
  | 'read'
  | 'failed'
  | 'unknown';

export type NormalizedMessageStatusUpdate = {
  tenantId: string;
  workspaceId: string;
  channelId: string;

  provider: string;
  channelType: 'whatsapp' | 'instagram' | 'facebook_messenger' | 'email' | 'other';

  externalMessageId: string;
  status: NormalizedMessageDeliveryStatus;

  recipientId?: string | null;
  occurredAt?: Date;

  rawPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
