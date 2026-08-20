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
};

export type MetaMessengerParticipant = {
  id?: string;
};

export type MetaMessengerMessage = {
  mid?: string;
  text?: string;
  is_echo?: boolean;
};
