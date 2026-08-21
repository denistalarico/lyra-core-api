export type NormalizedMessageReactionAction = 'react' | 'unreact';

export type NormalizedMessageReactionUpdate = {
  tenantId: string;
  workspaceId: string;
  channelId: string;

  provider: string;
  channelType: 'whatsapp' | 'instagram' | 'facebook_messenger' | 'email' | 'other';

  externalMessageId: string;
  senderId: string | null;
  action: NormalizedMessageReactionAction;
  emoji: string | null;
  occurredAt: Date;

  rawPayload?: Record<string, unknown>;
  metadata?: Record<string, unknown>;
};
