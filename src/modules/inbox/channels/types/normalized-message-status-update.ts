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

/**
 * Some providers (Messenger) don't identify delivery/read per message id —
 * they report a timestamp up to which every message the page sent has been
 * delivered or read. This is that shape: it targets a thread, not a message.
 */
export type NormalizedMessageStatusWatermarkUpdate = {
  tenantId: string;
  workspaceId: string;
  channelId: string;

  provider: string;
  channelType: 'whatsapp' | 'instagram' | 'facebook_messenger' | 'email' | 'other';

  externalThreadId: string;
  status: Extract<NormalizedMessageDeliveryStatus, 'delivered' | 'read'>;
  watermark: Date;

  recipientId?: string | null;
  metadata?: Record<string, unknown>;
};
