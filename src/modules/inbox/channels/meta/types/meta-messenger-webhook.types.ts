export type MetaMessengerWebhookPayload = {
  object?: 'page';
  entry?: MetaMessengerEntry[];
};

export type MetaMessengerEntry = {
  id?: string;
  time?: number;
  messaging?: MetaMessengerMessagingEvent[];
};

export type MetaMessengerMessagingEvent = {
  sender?: MetaMessengerParticipant;
  recipient?: MetaMessengerParticipant;
  timestamp?: number;
  message?: MetaMessengerMessage;
  delivery?: MetaMessengerDelivery;
  read?: MetaMessengerRead;
  reaction?: MetaMessengerReaction;
};

export type MetaMessengerParticipant = {
  id?: string;
};

export type MetaMessengerMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
  attachments?: MetaMessengerAttachment[];
};

export type MetaMessengerAttachment = {
  type?: string;
  payload?: {
    url?: string;
  };
};

// `mids` is optional by Meta's own design (a delivery receipt can arrive with
// only a watermark), so it is never relied on — see message-status-sync's
// watermark-based apply.
export type MetaMessengerDelivery = {
  mids?: string[];
  watermark?: number;
};

export type MetaMessengerRead = {
  watermark?: number;
};

export type MetaMessengerReaction = {
  mid?: string;
  action?: string;
  reaction?: string;
  emoji?: string;
};
