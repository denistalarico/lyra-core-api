import type { InboxChannelEntity } from '../../entities/inbox-channel.entity';
import type { NormalizedInboundMessage } from '../types/normalized-inbound-message';
import type { NormalizedMessageStatusUpdate } from '../types/normalized-message-status-update';

/**
 * IX4 (D-IX-7): SMS runs on the tenant's own provider account (BYO). Telnyx is
 * the first adapter; Twilio (IX-F9) is the next one, behind this same contract,
 * so the outbound service, the webhook and the follow-up never name a vendor.
 */
export type SmsProviderKey = 'telnyx';

export const SMS_PROVIDERS: readonly SmsProviderKey[] = ['telnyx'];

export function isSmsProviderKey(value: unknown): value is SmsProviderKey {
  return (
    typeof value === 'string' &&
    (SMS_PROVIDERS as readonly string[]).includes(value)
  );
}

export type SmsCredentialsInput = {
  apiKey: string;
  /** E.164, as the provider lists it. */
  phoneNumber: string;
  messagingProfileId: string;
};

/** What the provider says about the number and its webhook configuration. */
export type SmsCredentialCheck = {
  phoneNumber: string;
  messagingProfileId: string;
  messagingProfileName: string | null;
  webhookUrl: string | null;
  webhookFailoverUrl: string | null;
  webhookApiVersion: string | null;
};

export type SmsSendInput = {
  apiKey: string;
  from: string;
  to: string;
  text: string;
  mediaUrls?: readonly string[];
};

/**
 * Routing facts read from a webhook body *before* its signature is checked:
 * they only pick which channel's key verifies it, and nothing is persisted or
 * acted on until that verification passes.
 */
export type SmsWebhookEnvelope = {
  eventId: string;
  eventType: string;
  direction: 'inbound' | 'outbound' | null;
  /** Provider message id (`data.payload.id`). */
  externalMessageId: string | null;
  /** The business number: `to` on inbound, `from` on outbound events. */
  businessNumber: string | null;
  payload: Record<string, unknown>;
};

export type SmsWebhookHeaders = Record<string, string | string[] | undefined>;

export interface SmsProviderAdapter {
  readonly provider: SmsProviderKey;

  /** Validates key, number and the number's link to the messaging profile. */
  validateCredentials(input: SmsCredentialsInput): Promise<SmsCredentialCheck>;

  send(input: SmsSendInput): Promise<{ externalMessageId: string }>;

  /** Parses the raw body; throws `SmsWebhookRejectedError` when malformed. */
  parseWebhook(rawBody: Buffer): SmsWebhookEnvelope;

  /** Throws `SmsWebhookRejectedError` unless signed by this channel's key. */
  verifyWebhook(
    headers: SmsWebhookHeaders,
    rawBody: Buffer,
    channel: InboxChannelEntity,
    now?: Date,
  ): void;

  normalizeInbound(
    envelope: SmsWebhookEnvelope,
    channel: InboxChannelEntity,
  ): NormalizedInboundMessage | null;

  normalizeStatus(
    envelope: SmsWebhookEnvelope,
    channel: InboxChannelEntity,
  ): NormalizedMessageStatusUpdate | null;

  downloadMedia(
    url: string,
    apiKey: string,
    maxBytes: number,
  ): Promise<{ body: Buffer; contentType: string | null }>;
}

/**
 * A provider refusal with a stable, secret-free code. The message shown to
 * people is chosen from the code by the caller, never copied from the vendor.
 */
export class SmsProviderError extends Error {
  constructor(
    readonly code: string,
    readonly providerCode: string | null = null,
  ) {
    super(code);
    this.name = 'SmsProviderError';
  }
}

/** The webhook is answered 401 and nothing about it is persisted. */
export class SmsWebhookRejectedError extends Error {
  constructor(readonly reason: string) {
    super(reason);
    this.name = 'SmsWebhookRejectedError';
  }
}
