import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import {
  INBOX_CHANNEL_CUSTOM_NAME_METADATA_KEY,
  mapInboxChannel,
} from './inbox-channel.mapper';

function channel(
  overrides: Partial<InboxChannelEntity> = {},
): InboxChannelEntity {
  const now = new Date('2026-07-20T12:00:00.000Z');

  return {
    id: 'channel-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    name: 'WhatsApp +55 16 99999-0000',
    type: 'whatsapp',
    status: 'active',
    connectionStatus: 'connected',
    lifecycleVersion: 1,
    credentialVersion: 1,
    provider: 'meta',
    externalId: 'external-1',
    externalAccountId: 'account-1',
    externalPhoneNumberId: 'phone-1',
    externalPageId: null,
    accessTokenEncrypted: 'encrypted',
    defaultAssignedUserId: null,
    defaultAgentId: null,
    defaultPipelineId: null,
    aiEnabled: false,
    settings: {},
    metadata: {},
    createdAt: now,
    updatedAt: now,
    suspendedAt: null,
    disconnectedAt: null,
    deletedAt: null,
    ...overrides,
  } as InboxChannelEntity;
}

describe('mapInboxChannel', () => {
  it('uses the persisted custom name as the public channel name', () => {
    const response = mapInboxChannel(
      channel({
        metadata: {
          [INBOX_CHANNEL_CUSTOM_NAME_METADATA_KEY]: 'WhatsApp Comercial',
        },
      }),
    );

    expect(response.name).toBe('WhatsApp Comercial');
  });

  it('falls back to the provider channel name without a custom name', () => {
    expect(mapInboxChannel(channel()).name).toBe('WhatsApp +55 16 99999-0000');
  });

  it('exposes the non-secret canonical pipeline route', () => {
    expect(
      mapInboxChannel(channel({ defaultPipelineId: 'pipeline-1' }))
        .defaultPipelineId,
    ).toBe('pipeline-1');
  });
});
