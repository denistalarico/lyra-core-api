import type {
  InboxChannelEntity,
  InboxChannelStatus,
  InboxChannelType,
} from '../entities/inbox-channel.entity';

export const INBOX_CHANNEL_CUSTOM_NAME_METADATA_KEY = 'customDisplayName';

function getInboxChannelDisplayName(channel: InboxChannelEntity) {
  const customName = channel.metadata?.[INBOX_CHANNEL_CUSTOM_NAME_METADATA_KEY];

  return typeof customName === 'string' && customName.trim()
    ? customName.trim()
    : channel.name;
}

/**
 * Shape returned to API clients for an inbox channel.
 *
 * This is an explicit allowlist: sensitive columns (`accessTokenEncrypted`,
 * `verifyToken`, `webhookSecret`) are intentionally NOT included. Even though
 * the access token is stored encrypted, it must never travel to the client.
 * A safe boolean (`hasAccessToken`) is exposed instead so the UI can tell
 * whether a token is configured.
 */
export type InboxChannelResponse = {
  id: string;
  tenantId: string;
  workspaceId: string;
  name: string;
  type: InboxChannelType;
  status: InboxChannelStatus;
  connectionStatus: InboxChannelEntity['connectionStatus'];
  lifecycleVersion: number;
  credentialVersion: number;
  provider: string | null;
  externalId: string | null;
  externalAccountId: string | null;
  externalPhoneNumberId: string | null;
  externalPageId: string | null;
  hasAccessToken: boolean;
  defaultAssignedUserId: string | null;
  defaultAgentId: string | null;
  defaultPipelineId: string | null;
  aiEnabled: boolean;
  settings: Record<string, unknown>;
  metadata: Record<string, unknown>;
  createdAt: Date;
  updatedAt: Date;
  suspendedAt: Date | null;
  disconnectedAt: Date | null;
  deletedAt: Date | null;
};

/**
 * Maps an {@link InboxChannelEntity} to its sanitized client-facing response,
 * stripping secrets and exposing `hasAccessToken` instead of the raw token.
 */
export function mapInboxChannel(
  channel: InboxChannelEntity,
): InboxChannelResponse {
  return {
    id: channel.id,
    tenantId: channel.tenantId,
    workspaceId: channel.workspaceId,
    name: getInboxChannelDisplayName(channel),
    type: channel.type,
    status: channel.status,
    connectionStatus: channel.connectionStatus,
    lifecycleVersion: channel.lifecycleVersion,
    credentialVersion: channel.credentialVersion,
    provider: channel.provider,
    externalId: channel.externalId,
    externalAccountId: channel.externalAccountId,
    externalPhoneNumberId: channel.externalPhoneNumberId,
    externalPageId: channel.externalPageId,
    hasAccessToken: Boolean(channel.accessTokenEncrypted),
    defaultAssignedUserId: channel.defaultAssignedUserId,
    defaultAgentId: channel.defaultAgentId,
    defaultPipelineId: channel.defaultPipelineId,
    aiEnabled: channel.aiEnabled,
    settings: channel.settings ?? {},
    metadata: channel.metadata ?? {},
    createdAt: channel.createdAt,
    updatedAt: channel.updatedAt,
    suspendedAt: channel.suspendedAt,
    disconnectedAt: channel.disconnectedAt,
    deletedAt: channel.deletedAt,
  };
}
