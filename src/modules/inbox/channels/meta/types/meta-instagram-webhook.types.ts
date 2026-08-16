export type MetaInstagramWebhookPayload = {
  object?: string;
  entry?: MetaInstagramEntry[];
};

export type MetaInstagramEntry = {
  id?: string;
  time?: number;
  messaging?: MetaInstagramMessagingEvent[];
};

export type MetaInstagramMessagingEvent = {
  sender?: MetaInstagramParticipant;
  recipient?: MetaInstagramParticipant;
  timestamp?: number;
  message?: MetaInstagramMessage;
};

export type MetaInstagramParticipant = {
  id?: string;
  username?: string;
};

export type MetaInstagramMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  is_self?: boolean;
  reply_to?: {
    mid?: string;
  };
  attachments?: MetaInstagramAttachment[];
};

export type MetaInstagramAttachment = {
  type?: string;
  payload?: {
    url?: string;
  };
};
