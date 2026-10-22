import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../../../testing/postgres-integration';
import { InboxAgentDecisionEntity } from '../../../entities/inbox-agent-decision.entity';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../../../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../../../entities/inbox-domain-outbox.entity';
import { InboxGovernedActionEntity } from '../../../entities/inbox-governed-action.entity';
import { InboxMessageEntity } from '../../../entities/inbox-message.entity';
import { InboxMetaOperationEntity } from '../../../entities/inbox-meta-operation.entity';
import { InboxProcessingBatchEntity } from '../../../entities/inbox-processing-batch.entity';
import { InboxMetaOperationLedgerService } from './inbox-meta-operation-ledger.service';
import { InboxPilotOutboundPolicyService } from './inbox-pilot-outbound-policy.service';
import { WhatsAppOutboundService } from './whatsapp-outbound.service';

const run = describePostgresIntegration();

run('WhatsApp outbound PostgreSQL regression (AI-01)', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const agentId = randomUUID();
  const recipient = '5511999999999';
  const policyVersion = 'inbox-autonomy-policy-v1';

  const resetFixtures = () =>
    deleteFixtureTenant(AgencyDataSource, tenantId, [
      'inbox_governed_actions',
      'inbox_meta_operations',
      'inbox_agent_decisions',
      'inbox_processing_batches',
      'inbox_conversation_events',
      'inbox_messages',
      'inbox_conversations',
      'inbox_domain_outbox',
      'inbox_channels',
    ]);

  beforeAll(async () => {
    // This regression has a narrower target than the shared disposable-DB gate.
    if (AgencyDataSource.options.database !== 'lyra_agency_test') {
      throw new Error('WhatsApp regression requires lyra_agency_test.');
    }
    await AgencyDataSource.initialize();
  });

  beforeEach(async () => {
    await resetFixtures();
    // Fail closed if a future code path bypasses the provider stub below.
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Network disabled in WhatsApp regression.'));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await resetFixtures();
      await AgencyDataSource.destroy();
    }
  });

  it.each([
    ['sendText', 'user'],
    ['sendAgentText', 'agent'],
    ['sendAutomationMessage', 'system'],
  ] as const)(
    '%s commits pending before the provider call and deduplicates its retry',
    async (method, senderType) => {
      const channels = AgencyDataSource.getRepository(InboxChannelEntity);
      const conversations = AgencyDataSource.getRepository(
        InboxConversationEntity,
      );
      const messages = AgencyDataSource.getRepository(InboxMessageEntity);
      const channel = await channels.save({
        tenantId,
        workspaceId,
        name: 'Synthetic WhatsApp regression',
        type: 'whatsapp',
        provider: 'meta',
        status: 'active',
        connectionStatus: 'connected',
        externalPhoneNumberId: 'synthetic-phone-id',
        accessTokenEncrypted: 'synthetic-encrypted-token',
        scopeKind: 'agency',
        agencyClientId: null,
        companyContextId: null,
        aiEnabled: true,
        settings: {},
        metadata: {},
      });
      const conversation = await conversations.save({
        tenantId,
        workspaceId,
        channelId: channel.id,
        externalThreadId: recipient,
        scopeKind: 'agency',
        agencyClientId: null,
        companyContextId: null,
        status: 'open',
        source: 'whatsapp',
        businessMode: 'general',
        ownershipState: method === 'sendText' ? 'human_active' : 'ai_active',
        ownershipVersion: 4,
        ownershipChangedAt: new Date(),
        aiEnabled: method !== 'sendText',
        qualificationStatus: 'pending',
        metadata: {},
      });
      // A recent real inbound row opens the automation's customer-service window.
      await messages.save({
        tenantId,
        workspaceId,
        channelId: channel.id,
        conversationId: conversation.id,
        direction: 'inbound',
        senderType: 'contact',
        messageType: 'text',
        content: 'Synthetic inbound',
        status: 'received',
        attachments: [],
        metadata: {},
        occurredAt: new Date(),
      });

      const idempotencyKey = `ix1:${method}:${randomUUID()}`;
      const automationId = randomUUID();
      let decisionId: string = randomUUID();
      if (method === 'sendAgentText') {
        const batch = await AgencyDataSource.getRepository(
          InboxProcessingBatchEntity,
        ).save({
          tenantId,
          workspaceId,
          conversationId: conversation.id,
          channelId: channel.id,
          dueAt: new Date(),
          status: 'completed',
        });
        const decision = await AgencyDataSource.getRepository(
          InboxAgentDecisionEntity,
        ).save({
          tenantId,
          workspaceId,
          conversationId: conversation.id,
          batchId: batch.id,
          ownershipVersion: 4,
          idempotencyKey: `decision:${batch.id}`,
          correlationId: randomUUID(),
          status: 'approved',
        });
        decisionId = decision.id;
        await AgencyDataSource.getRepository(InboxGovernedActionEntity).save({
          tenantId,
          workspaceId,
          conversationId: conversation.id,
          decisionId,
          ownershipVersion: 4,
          policyVersion,
          actionType: 'reply',
          actionKey: 'reply',
          policyOutcome: 'allowed',
          reasonCode: 'allowed',
          idempotencyKey,
          intentHash: 'a'.repeat(64),
          auditRef: randomUUID(),
          status: 'claimed',
        });
      }

      const service = new WhatsAppOutboundService(
        AgencyDataSource,
        channels,
        conversations,
        messages,
        { decrypt: () => 'synthetic-token' } as never,
        {} as never,
        new InboxPilotOutboundPolicyService(),
        new InboxMetaOperationLedgerService(
          AgencyDataSource.getRepository(InboxMetaOperationEntity),
        ),
      );
      // Only the provider transport is replaced: query builders, repositories,
      // transactions, governed authorization and operation ledger remain real.
      const transport = service as unknown as {
        sendToMeta: () => Promise<{ messages: Array<{ id: string }> }>;
      };
      const sendToMeta = jest
        .spyOn(transport, 'sendToMeta')
        .mockImplementation(async () => {
          const pending = await messages.findOneByOrFail({
            tenantId,
            workspaceId,
            idempotencyKey,
          });
          expect(pending).toMatchObject({
            conversationId: conversation.id,
            channelId: channel.id,
            direction: 'outbound',
            senderType,
            status: 'pending',
            externalMessageId: null,
            sentAt: null,
          });
          return { messages: [{ id: `wamid.synthetic.${method}` }] };
        });
      const common = {
        ctx: { tenantId, workspaceId, userId },
        channelId: channel.id,
        conversationId: conversation.id,
        to: recipient,
        text: 'Synthetic outbound',
        idempotencyKey,
      };
      const send = () => {
        if (method === 'sendAgentText') {
          return service.sendAgentText({
            ...common,
            agentId,
            decisionId,
            policyVersion,
            ownershipVersion: 4,
          });
        }
        if (method === 'sendAutomationMessage') {
          return service.sendAutomationMessage({
            tenantId,
            workspaceId,
            conversationId: conversation.id,
            automationId,
            text: common.text,
            idempotencyKey,
          });
        }
        return service.sendText(common);
      };

      const first = await send();
      const replay = await send();

      expect(sendToMeta).toHaveBeenCalledTimes(1);
      expect(global.fetch).not.toHaveBeenCalled();
      expect(first.message).toMatchObject({
        status: 'sent',
        senderType,
        externalMessageId: `wamid.synthetic.${method}`,
      });
      expect(replay.message.id).toBe(first.message.id);
      expect(replay.message.status).toBe('sent');
      expect(await messages.countBy({ tenantId, idempotencyKey })).toBe(1);
      expect(
        await AgencyDataSource.getRepository(
          InboxConversationEventEntity,
        ).countBy({ tenantId, eventType: 'message_sent' }),
      ).toBe(1);
      expect(
        await AgencyDataSource.getRepository(InboxDomainOutboxEntity).countBy({
          tenantId,
          eventName: 'leadflow.inbox.conversation.message.sent',
        }),
      ).toBe(1);
      await expect(
        AgencyDataSource.getRepository(
          InboxMetaOperationEntity,
        ).findOneByOrFail({
          tenantId,
          idempotencyKey,
        }),
      ).resolves.toMatchObject({ state: 'replayed', replayCount: 1 });
    },
  );
});
