import { Inject, Injectable, Logger } from '@nestjs/common';
import {
  PLATFORM_WHATSAPP_NOTIFICATION_CONFIG,
  type PlatformWhatsAppNotificationConfigProvider,
} from './platform-whatsapp-notification.config';
import {
  buildPlatformTemplateParameters,
  resolvePlatformWhatsAppTemplate,
  type PlatformWhatsAppTemplateVariables,
} from './platform-whatsapp-notification.catalog';

export interface PlatformWhatsAppSendInput {
  /** Recipient number in E.164 (e.g. +5511999998888). */
  toPhoneE164: string;
  /** Logical template key; the physical name is resolved internally. */
  templateKey: string;
  /** Optional Business Mode scope for future per-mode templates. */
  businessModeKey?: string | null;
  variables: PlatformWhatsAppTemplateVariables;
}

export type PlatformWhatsAppSendOutcome =
  /** Meta accepted the message. */
  | { status: 'sent'; providerMessageId: string }
  /**
   * Deliberately not attempted — provider off, no approved template, or the
   * recipient is not permitted by the current (test) policy. Not a fault.
   */
  | {
      status: 'skipped';
      reasonCode:
        | 'provider_disabled'
        | 'template_unavailable'
        | 'invalid_recipient'
        | 'recipient_not_allowlisted';
    }
  /** Attempted and rejected by Meta or the transport. Message is sanitized. */
  | { status: 'failed'; providerCode: string | null; message: string };

type MetaSendResponse = {
  messages?: { id?: string }[];
  error?: { code?: number; message?: string };
};

/**
 * The Platform WhatsApp Notification Provider's send port.
 *
 * It authenticates with the platform's own env-backed credentials (never a
 * workspace channel connection), resolves the physical template from the logical
 * key, flattens the named variables to Meta's positional body parameters in the
 * approved order, and calls the Cloud API. The approved template carries no
 * button, so the payload never includes a button/URL component.
 *
 * Every outcome is sanitized: the bearer token is never logged, returned or
 * serialized, and a Meta error is reduced to its numeric code and a truncated,
 * detail-free message.
 */
@Injectable()
export class PlatformWhatsAppNotificationSender {
  private readonly logger = new Logger(PlatformWhatsAppNotificationSender.name);

  constructor(
    @Inject(PLATFORM_WHATSAPP_NOTIFICATION_CONFIG)
    private readonly configProvider: PlatformWhatsAppNotificationConfigProvider,
  ) {}

  async sendTemplate(
    input: PlatformWhatsAppSendInput,
  ): Promise<PlatformWhatsAppSendOutcome> {
    const config = this.configProvider.get();
    if (!config.enabled) {
      return { status: 'skipped', reasonCode: 'provider_disabled' };
    }

    const recipient = normalizeRecipient(input.toPhoneE164);
    if (!recipient) {
      return { status: 'skipped', reasonCode: 'invalid_recipient' };
    }

    // Fail-closed on recipients: with no allow-list configured, nobody is
    // permitted — the provider never sends to an unlisted number during testing.
    if (
      config.testRecipientAllowList.length === 0 ||
      !config.testRecipientAllowList.map(normalizeRecipient).includes(recipient)
    ) {
      return { status: 'skipped', reasonCode: 'recipient_not_allowlisted' };
    }

    const template = resolvePlatformWhatsAppTemplate(
      input.templateKey,
      input.businessModeKey ?? null,
    );
    if (!template) {
      return { status: 'skipped', reasonCode: 'template_unavailable' };
    }

    const parameters = buildPlatformTemplateParameters(
      input.templateKey,
      input.variables,
    );
    const body = {
      messaging_product: 'whatsapp',
      recipient_type: 'individual',
      to: recipient,
      type: 'template',
      template: {
        name: template.providerTemplateName,
        language: { code: template.languageCode },
        // Body only: the approved template has no button, so no button/URL
        // component is ever attached here.
        components: [
          {
            type: 'body',
            parameters: parameters.map((text) => ({ type: 'text', text })),
          },
        ],
      },
    };

    try {
      const response = await fetch(
        `https://graph.facebook.com/${config.apiVersion}/${config.phoneNumberId}/messages`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${config.accessToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify(body),
          redirect: 'error',
          signal: AbortSignal.timeout(15_000),
        },
      );

      const data = (await response.json()) as MetaSendResponse;
      const providerMessageId = data.messages?.[0]?.id;

      if (!response.ok || data.error || !providerMessageId) {
        const providerCode =
          typeof data.error?.code === 'number' ? String(data.error.code) : null;
        this.logger.warn(
          `Platform WhatsApp notification rejected (code ${providerCode ?? 'unknown'}).`,
        );
        return {
          status: 'failed',
          providerCode,
          message: sanitizeProviderMessage(data.error?.message),
        };
      }

      return { status: 'sent', providerMessageId };
    } catch {
      // Never surface the transport error verbatim: it could echo request
      // details. A generic, code-less failure is enough for the retry policy.
      this.logger.warn('Platform WhatsApp notification transport error.');
      return {
        status: 'failed',
        providerCode: null,
        message: 'Falha de transporte ao enviar a notificação por WhatsApp.',
      };
    }
  }
}

/**
 * The idempotency identity of one handoff WhatsApp delivery. Deterministic, so
 * the wiring layer can persist it and refuse to resend after a success.
 */
export function buildPlatformWhatsAppDeliveryKey(input: {
  tenantId: string;
  workspaceId: string;
  subjectId: string;
  handoffCycleId: string | number;
  recipientUserId: string;
  templateKey: string;
}): string {
  return [
    'pwa',
    input.tenantId,
    input.workspaceId,
    input.subjectId,
    String(input.handoffCycleId),
    input.recipientUserId,
    input.templateKey,
  ].join(':');
}

/** Digits only (Cloud API accepts the number without a leading '+'). */
function normalizeRecipient(value: string): string | null {
  const digits = (value ?? '').replace(/[^\d]/g, '');
  return /^[1-9]\d{9,14}$/.test(digits) ? digits : null;
}

function sanitizeProviderMessage(message: string | undefined): string {
  if (typeof message !== 'string' || message.trim() === '') {
    return 'A Meta recusou o envio da notificação.';
  }
  return message.replace(/\s+/g, ' ').trim().slice(0, 160);
}
