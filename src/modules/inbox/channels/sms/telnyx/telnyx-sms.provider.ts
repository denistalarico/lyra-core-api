import { Injectable, Logger } from '@nestjs/common';
import { createPublicKey, verify, type KeyObject } from 'crypto';
import type { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import type {
  NormalizedInboundAttachment,
  NormalizedInboundMessage,
} from '../../types/normalized-inbound-message';
import type {
  NormalizedMessageDeliveryStatus,
  NormalizedMessageStatusUpdate,
} from '../../types/normalized-message-status-update';
import {
  SmsProviderError,
  SmsWebhookRejectedError,
  type SmsCredentialCheck,
  type SmsCredentialsInput,
  type SmsProviderAdapter,
  type SmsSendInput,
  type SmsWebhookEnvelope,
  type SmsWebhookHeaders,
} from '../sms-provider.adapter';

const TELNYX_API = 'https://api.telnyx.com/v2';

/** Telnyx rejects webhooks older than this; so do we (replay protection). */
export const TELNYX_SIGNATURE_TOLERANCE_SECONDS = 300;

/** ASN.1 SPKI header for a raw 32-byte Ed25519 public key. */
const ED25519_SPKI_PREFIX = Buffer.from('302a300506032b6570032100', 'hex');

/** Parts of an MMS that are layout or duplicate text, never a file to show. */
const IGNORED_MMS_CONTENT_TYPES = new Set([
  'application/smil',
  'application/smil+xml',
  'text/plain',
]);

/**
 * Turns the public key the Telnyx portal shows (base64 of the raw 32 bytes)
 * into a key object. A base64 SPKI DER is accepted too. Anything else is not
 * a key, and connecting with it would make every webhook fail verification.
 */
export function parseTelnyxPublicKey(value: string) {
  const trimmed = value.trim();
  if (!/^[A-Za-z0-9+/=_-]{40,120}$/.test(trimmed)) {
    throw new SmsProviderError('sms_public_key_invalid');
  }
  const raw = Buffer.from(trimmed, 'base64');
  const der =
    raw.length === 32
      ? Buffer.concat([ED25519_SPKI_PREFIX, raw])
      : raw.length === 44 && raw.subarray(0, 12).equals(ED25519_SPKI_PREFIX)
        ? raw
        : null;
  if (!der) throw new SmsProviderError('sms_public_key_invalid');
  try {
    return createPublicKey({ key: der, format: 'der', type: 'spki' });
  } catch {
    throw new SmsProviderError('sms_public_key_invalid');
  }
}

/**
 * Ed25519 over `"<timestamp>|<raw body>"`, with a 300 s window. Pure, so the
 * spec exercises the exact check the webhook runs.
 */
export function verifyTelnyxSignature(input: {
  publicKey: string;
  signature: string | undefined;
  timestamp: string | undefined;
  rawBody: Buffer;
  now: Date;
}): void {
  if (!input.signature || !input.timestamp) {
    throw new SmsWebhookRejectedError('signature_missing');
  }
  if (!/^\d{9,11}$/.test(input.timestamp)) {
    throw new SmsWebhookRejectedError('timestamp_invalid');
  }
  const ageSeconds =
    Math.floor(input.now.getTime() / 1000) - Number(input.timestamp);
  if (Math.abs(ageSeconds) > TELNYX_SIGNATURE_TOLERANCE_SECONDS) {
    throw new SmsWebhookRejectedError('timestamp_outside_tolerance');
  }
  let key: KeyObject;
  try {
    key = parseTelnyxPublicKey(input.publicKey);
  } catch {
    throw new SmsWebhookRejectedError('public_key_invalid');
  }
  const signature = Buffer.from(input.signature, 'base64');
  const signed = Buffer.concat([
    Buffer.from(`${input.timestamp}|`, 'utf8'),
    input.rawBody,
  ]);
  let valid = false;
  try {
    valid = signature.length === 64 && verify(null, signed, key, signature);
  } catch {
    valid = false;
  }
  if (!valid) throw new SmsWebhookRejectedError('signature_invalid');
}

@Injectable()
export class TelnyxSmsProvider implements SmsProviderAdapter {
  readonly provider = 'telnyx' as const;
  private readonly logger = new Logger(TelnyxSmsProvider.name);

  async validateCredentials(
    input: SmsCredentialsInput,
  ): Promise<SmsCredentialCheck> {
    const numbers = await this.request(
      input.apiKey,
      'GET',
      `/phone_numbers?${new URLSearchParams({
        'filter[phone_number]': input.phoneNumber,
      }).toString()}`,
    );
    const list = Array.isArray(numbers.data) ? numbers.data : [];
    const number = list
      .filter(isRecord)
      .find((item) => item.phone_number === input.phoneNumber);
    if (!number) throw new SmsProviderError('sms_number_not_found');
    if (number.status !== 'active') {
      throw new SmsProviderError('sms_number_inactive');
    }
    if (number.messaging_profile_id !== input.messagingProfileId) {
      throw new SmsProviderError('sms_messaging_profile_mismatch');
    }

    const profileResponse = await this.request(
      input.apiKey,
      'GET',
      `/messaging_profiles/${encodeURIComponent(input.messagingProfileId)}`,
    );
    const profile = isRecord(profileResponse.data) ? profileResponse.data : {};
    if (profile.enabled === false) {
      throw new SmsProviderError('sms_messaging_profile_disabled');
    }
    return {
      phoneNumber: input.phoneNumber,
      messagingProfileId: input.messagingProfileId,
      messagingProfileName: readString(profile.name),
      webhookUrl: readString(profile.webhook_url),
      webhookFailoverUrl: readString(profile.webhook_failover_url),
      webhookApiVersion:
        profile.webhook_api_version === undefined ||
        profile.webhook_api_version === null
          ? null
          : String(profile.webhook_api_version as string | number),
    };
  }

  async send(input: SmsSendInput): Promise<{ externalMessageId: string }> {
    const response = await this.request(input.apiKey, 'POST', '/messages', {
      from: input.from,
      to: input.to,
      text: input.text,
      ...(input.mediaUrls?.length ? { media_urls: [...input.mediaUrls] } : {}),
    });
    const data = isRecord(response.data) ? response.data : {};
    const id = readString(data.id);
    if (!id) throw new SmsProviderError('provider_send_unconfirmed');
    return { externalMessageId: id };
  }

  parseWebhook(rawBody: Buffer): SmsWebhookEnvelope {
    let parsed: unknown;
    try {
      parsed = JSON.parse(rawBody.toString('utf8'));
    } catch {
      throw new SmsWebhookRejectedError('payload_invalid');
    }
    const data = isRecord(parsed) && isRecord(parsed.data) ? parsed.data : null;
    const payload = data && isRecord(data.payload) ? data.payload : null;
    const eventId = readString(data?.id);
    const eventType = readString(data?.event_type);
    if (!data || !payload || !eventId || !eventType) {
      throw new SmsWebhookRejectedError('payload_invalid');
    }
    const direction =
      payload.direction === 'inbound' || payload.direction === 'outbound'
        ? payload.direction
        : null;
    const from = isRecord(payload.from)
      ? readString(payload.from.phone_number)
      : null;
    const firstTo =
      Array.isArray(payload.to) && isRecord(payload.to[0])
        ? readString(payload.to[0].phone_number)
        : null;
    return {
      eventId,
      eventType,
      direction,
      externalMessageId: readString(payload.id),
      businessNumber: direction === 'inbound' ? firstTo : from,
      payload,
    };
  }

  verifyWebhook(
    headers: SmsWebhookHeaders,
    rawBody: Buffer,
    channel: InboxChannelEntity,
    now = new Date(),
  ): void {
    const publicKey = readString(channel.metadata?.webhookPublicKey);
    if (!publicKey) throw new SmsWebhookRejectedError('public_key_missing');
    verifyTelnyxSignature({
      publicKey,
      signature: headerValue(headers, 'telnyx-signature-ed25519'),
      timestamp: headerValue(headers, 'telnyx-timestamp'),
      rawBody,
      now,
    });
  }

  normalizeInbound(
    envelope: SmsWebhookEnvelope,
    channel: InboxChannelEntity,
  ): NormalizedInboundMessage | null {
    if (envelope.eventType !== 'message.received') return null;
    const payload = envelope.payload;
    const from = isRecord(payload.from)
      ? readString(payload.from.phone_number)
      : null;
    if (!from || !envelope.externalMessageId) return null;

    const attachments: NormalizedInboundAttachment[] = (
      Array.isArray(payload.media) ? payload.media : []
    )
      .filter(isRecord)
      .map((media, index) => ({ media, index }))
      .filter(({ media }) => {
        const contentType = readString(media.content_type)?.toLowerCase();
        return (
          readString(media.url) !== null &&
          !(contentType && IGNORED_MMS_CONTENT_TYPES.has(contentType))
        );
      })
      .map(({ media, index }) => {
        const mimeType = readString(media.content_type)?.toLowerCase() ?? null;
        return {
          type: attachmentType(mimeType),
          mimeType,
          size: typeof media.size === 'number' ? media.size : null,
          // One provider message can carry several files; the index keeps
          // each one its own asset under the per-provider unique key.
          externalId: `${envelope.externalMessageId}:${index}`,
          metadata: {
            directUrl: readString(media.url),
            ...(readString(media.sha256)
              ? { sha256: readString(media.sha256) }
              : {}),
          },
        };
      });

    const text = readString(payload.text) ?? '';
    const messageType = text
      ? 'text'
      : attachments[0]
        ? (attachments[0].type as NormalizedInboundMessage['messageType'])
        : 'unknown';
    const occurredAt = readDate(payload.received_at) ?? new Date();

    return {
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      channelType: 'sms',
      provider: 'telnyx',
      externalThreadId: from,
      externalMessageId: envelope.externalMessageId,
      sender: { externalId: from, phone: from },
      messageType,
      content:
        text ||
        (attachments.length
          ? attachments[0].type === 'image'
            ? '[imagem]'
            : '[arquivo]'
          : ''),
      attachments,
      occurredAt,
      metadata: {
        smsType: readString(payload.type),
        smsParts: typeof payload.parts === 'number' ? payload.parts : null,
      },
    };
  }

  normalizeStatus(
    envelope: SmsWebhookEnvelope,
    channel: InboxChannelEntity,
  ): NormalizedMessageStatusUpdate | null {
    if (
      envelope.eventType !== 'message.sent' &&
      envelope.eventType !== 'message.finalized'
    ) {
      return null;
    }
    if (!envelope.externalMessageId) return null;
    const recipient =
      Array.isArray(envelope.payload.to) && isRecord(envelope.payload.to[0])
        ? envelope.payload.to[0]
        : {};
    const providerStatus = readString(recipient.status);
    const status = mapTelnyxStatus(envelope.eventType, providerStatus);
    if (!status) return null;
    const firstError =
      Array.isArray(envelope.payload.errors) &&
      isRecord(envelope.payload.errors[0])
        ? envelope.payload.errors[0]
        : null;
    const errorCode = firstError ? readString(String(firstError.code)) : null;
    return {
      tenantId: channel.tenantId,
      workspaceId: channel.workspaceId,
      channelId: channel.id,
      provider: 'telnyx',
      channelType: 'sms',
      externalMessageId: envelope.externalMessageId,
      status,
      recipientId: readString(recipient.phone_number),
      occurredAt:
        readDate(envelope.payload.completed_at) ??
        readDate(envelope.payload.sent_at) ??
        undefined,
      metadata: {
        providerStatus,
        ...(errorCode && /^\d{1,10}$/.test(errorCode)
          ? { providerErrorCode: errorCode }
          : {}),
      },
    };
  }

  async downloadMedia(url: string, apiKey: string, maxBytes: number) {
    let parsed: URL;
    try {
      parsed = new URL(url);
    } catch {
      throw new Error('untrusted_media_url');
    }
    if (parsed.protocol !== 'https:') throw new Error('untrusted_media_url');
    // The Bearer is the tenant's API key: it only goes to Telnyx itself. A
    // media URL on another host (a pre-signed object store) is fetched bare.
    const telnyxHost =
      parsed.hostname === 'telnyx.com' ||
      parsed.hostname.endsWith('.telnyx.com');
    const response = await fetch(parsed, {
      headers: telnyxHost ? { Authorization: `Bearer ${apiKey}` } : {},
      redirect: 'error',
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok) throw new Error('media_download_failed');
    const declared = Number(response.headers.get('content-length') ?? 0);
    if (declared > maxBytes) throw new Error('media_too_large');
    const body = Buffer.from(await response.arrayBuffer());
    if (body.length > maxBytes) throw new Error('media_too_large');
    return { body, contentType: response.headers.get('content-type') };
  }

  private async request(
    apiKey: string,
    method: 'GET' | 'POST',
    path: string,
    body?: Record<string, unknown>,
  ): Promise<Record<string, unknown>> {
    let response: Response;
    try {
      response = await fetch(`${TELNYX_API}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${apiKey}`,
          Accept: 'application/json',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
        redirect: 'error',
        signal: AbortSignal.timeout(15_000),
      });
    } catch {
      throw new SmsProviderError('provider_unreachable');
    }
    const parsed: unknown = await response.json().catch(() => ({}));
    const data = isRecord(parsed) ? parsed : {};
    if (response.ok) return data;

    const firstError =
      Array.isArray(data.errors) && isRecord(data.errors[0])
        ? data.errors[0]
        : null;
    const rawCode =
      firstError && firstError.code !== undefined
        ? String(firstError.code as string | number)
        : null;
    const providerCode = rawCode && /^\d{1,10}$/.test(rawCode) ? rawCode : null;
    // Status and numeric code only: the vendor's detail can quote numbers and
    // the request, and none of it is needed to diagnose.
    this.logger.warn(
      `Telnyx request failed: method=${method} status=${response.status} code=${providerCode ?? 'none'}`,
    );
    if (response.status === 401 || response.status === 403) {
      throw new SmsProviderError(
        method === 'POST' && response.status === 403
          ? 'provider_send_refused'
          : 'sms_credentials_invalid',
        providerCode,
      );
    }
    if (response.status === 404) {
      throw new SmsProviderError(
        path.startsWith('/messaging_profiles')
          ? 'sms_messaging_profile_not_found'
          : 'provider_resource_not_found',
        providerCode,
      );
    }
    throw new SmsProviderError(
      method === 'POST' ? 'provider_send_failed' : 'provider_request_failed',
      providerCode,
    );
  }
}

function mapTelnyxStatus(
  eventType: string,
  providerStatus: string | null,
): NormalizedMessageDeliveryStatus | null {
  if (eventType === 'message.sent') return 'sent';
  switch (providerStatus) {
    case 'delivered':
      return 'delivered';
    case 'delivery_failed':
    case 'sending_failed':
      return 'failed';
    // No confirmation is not a failure: the message stays `sent`.
    case 'delivery_unconfirmed':
    case 'sent':
      return 'sent';
    default:
      return null;
  }
}

function attachmentType(mimeType: string | null) {
  if (mimeType?.startsWith('image/')) return 'image';
  if (mimeType?.startsWith('video/')) return 'video';
  if (mimeType?.startsWith('audio/')) return 'audio';
  return 'file';
}

function headerValue(headers: SmsWebhookHeaders, name: string) {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function readDate(value: unknown): Date | null {
  const text = readString(value);
  if (!text) return null;
  const date = new Date(text);
  return Number.isFinite(date.getTime()) ? date : null;
}
