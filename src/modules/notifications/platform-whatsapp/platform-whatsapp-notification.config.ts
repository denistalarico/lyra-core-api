/**
 * Configuration for the Platform WhatsApp Notification Provider.
 *
 * This is the platform's OWN internal notification channel — deliberately kept
 * separate from the Inbox's per-workspace WhatsApp outbound, which authenticates
 * with a per-channel token stored on the channel entity. The two may consume the
 * same phone number during testing, but this provider never consults a workspace
 * channel connection: an internal alert must never surface in the Inbox, nor
 * create a conversation, lead or opportunity.
 *
 * The access token is read from the environment and never persisted, logged, or
 * returned in any DTO/response/error. The interface is intentionally provider-
 * shaped so an `AdminDatabaseWhatsAppNotificationConfigProvider` can replace the
 * env-backed one later without touching the sender or its consumers.
 */
export interface PlatformWhatsAppNotificationConfig {
  /** Whether the provider may attempt a send at all. Default-closed. */
  enabled: boolean;
  /** Cloud API bearer token. Sensitive: never log, persist, or serialize. */
  accessToken: string;
  /** Sender phone number id (Cloud API path segment). */
  phoneNumberId: string;
  /** Graph API version, e.g. `v24.0`. */
  apiVersion: string;
  /** Default template language, e.g. `pt_BR`. */
  defaultLanguageCode: string;
  /**
   * Recipient E.164 numbers allowed during the test phase. Empty means the
   * provider is fail-closed on recipients (no send) until either this is set or
   * a future policy verifies numbers — never an implicit "allow all".
   */
  testRecipientAllowList: readonly string[];
}

/** Injection token for the config provider port. */
export const PLATFORM_WHATSAPP_NOTIFICATION_CONFIG =
  'PLATFORM_WHATSAPP_NOTIFICATION_CONFIG';

/** The port the sender depends on; swappable (env now, Admin DB later). */
export interface PlatformWhatsAppNotificationConfigProvider {
  get(): PlatformWhatsAppNotificationConfig;
}

/**
 * Reads the provider configuration from the environment.
 *
 * Reuses the WhatsApp credentials that already live in `.env`
 * (`WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`) — audited as NOT consumed
 * by any code today (the Inbox outbound uses per-channel DB tokens), so there is
 * no duplication and no conflict. `META_GRAPH_API_VERSION` is shared with the
 * Inbox outbound for a single source of truth on the Graph version.
 *
 * `PLATFORM_WHATSAPP_NOTIFICATIONS_ENABLED` is the kill switch: off unless
 * exactly 'true', and even then `enabled` stays false without both credentials.
 */
export class EnvPlatformWhatsAppNotificationConfigProvider
  implements PlatformWhatsAppNotificationConfigProvider
{
  private readonly config: PlatformWhatsAppNotificationConfig;

  constructor(env: NodeJS.ProcessEnv = process.env) {
    const accessToken = (env.WHATSAPP_ACCESS_TOKEN ?? '').trim();
    const phoneNumberId = (env.WHATSAPP_PHONE_NUMBER_ID ?? '').trim();
    const switchedOn =
      env.PLATFORM_WHATSAPP_NOTIFICATIONS_ENABLED === 'true';

    this.config = {
      enabled: switchedOn && accessToken !== '' && phoneNumberId !== '',
      accessToken,
      phoneNumberId,
      apiVersion: (env.META_GRAPH_API_VERSION ?? 'v24.0').trim(),
      defaultLanguageCode: (
        env.PLATFORM_WHATSAPP_NOTIFICATIONS_DEFAULT_LANGUAGE ?? 'pt_BR'
      ).trim(),
      testRecipientAllowList: parseAllowList(
        env.PLATFORM_WHATSAPP_NOTIFICATIONS_TEST_RECIPIENTS,
      ),
    };
  }

  get(): PlatformWhatsAppNotificationConfig {
    return this.config;
  }
}

function parseAllowList(raw: string | undefined): readonly string[] {
  return (raw ?? '')
    .split(',')
    .map((entry) => entry.trim())
    .filter((entry) => entry !== '');
}
