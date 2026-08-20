import { InboxSettingsEntity } from '../../entities/inbox-settings.entity';
import type { NormalizedInboundMessage } from '../types/normalized-inbound-message';
import { InboundMessageIngestionService } from './inbound-message-ingestion.service';

describe('InboundMessageIngestionService Messenger defaults', () => {
  const service = new InboundMessageIngestionService({} as never, {} as never);
  const input: NormalizedInboundMessage = {
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    channelId: 'messenger-channel-1',
    channelType: 'facebook_messenger',
    provider: 'meta',
    externalThreadId: 'facebook_messenger:page-1:psid-1',
    externalMessageId: 'mid-1',
    sender: { externalId: 'psid-1' },
    messageType: 'text',
    content: 'Olá',
  };

  it('qualifies Messenger inbound by default when no channel rule exists', async () => {
    const settingsRepository = {
      findOne: jest.fn().mockResolvedValue(null),
    };
    const manager = {
      getRepository: jest.fn((entity: unknown) => {
        expect(entity).toBe(InboxSettingsEntity);
        return settingsRepository;
      }),
    };

    await expect(service['qualify'](manager as never, input)).resolves.toEqual({
      status: 'qualified',
      reason: 'facebook_messenger_default',
    });
  });

  it('uses the Messenger fallback title without exposing the PSID', () => {
    const title = service['createConversationTitle'](input);

    expect(title).toBe('Lead do Messenger');
    expect(title).not.toContain('psid-1');
  });
});
