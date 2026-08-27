import { randomUUID } from 'crypto';
import { NotFoundException } from '@nestjs/common';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { InboxAgentDecisionEntity } from '../entities/inbox-agent-decision.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxChannelLifecycleRequestEntity } from '../entities/inbox-channel-lifecycle-request.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { InboxProcessingBatchEntity } from '../entities/inbox-processing-batch.entity';
import { InboxChannelLifecycleService } from './inbox-channel-lifecycle.service';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { deleteFixtureTenant } from '../../../testing/fixture-tenant';

const run = describePostgresIntegration();

run('InboxChannelLifecycleService PostgreSQL isolation', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const actorUserId = randomUUID();
  const service = new InboxChannelLifecycleService(AgencyDataSource);

  const resetFixtures = () =>
    deleteFixtureTenant(AgencyDataSource, tenantId, [
      'inbox_channel_lifecycle_requests',
      'inbox_domain_outbox',
      'leadflow_event_deliveries',
      'inbox_agent_decisions',
      'inbox_processing_batches',
      'inbox_messages',
      'inbox_conversations',
      'inbox_channels',
    ]);

  beforeAll(async () => {
    await AgencyDataSource.initialize();
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await resetFixtures();
      await AgencyDataSource.destroy();
    }
  });

  beforeEach(resetFixtures);

  it('serializes concurrent disconnects and atomically preserves history while cancelling work', async () => {
    const channel = await AgencyDataSource.getRepository(
      InboxChannelEntity,
    ).save({
      tenantId,
      workspaceId,
      name: 'WhatsApp Pilot',
      type: 'whatsapp',
      provider: 'meta',
      status: 'active',
      connectionStatus: 'connected',
      lifecycleVersion: 1,
      credentialVersion: 1,
      externalPhoneNumberId: 'phone-audit-id',
      externalAccountId: 'waba-audit-id',
      accessTokenEncrypted: 'encrypted-local-token',
      verifyToken: 'local-verify-token',
      webhookSecret: 'local-webhook-secret',
      aiEnabled: true,
      settings: {},
      metadata: {},
    });
    const conversation = await AgencyDataSource.getRepository(
      InboxConversationEntity,
    ).save({
      tenantId,
      workspaceId,
      channelId: channel.id,
      status: 'open',
      source: 'whatsapp',
      businessMode: 'general',
      aiEnabled: true,
      ownershipState: 'ai_active',
      ownershipVersion: 4,
      ownershipReason: 'activation_policy',
      ownershipChangedAt: new Date(),
      qualificationStatus: 'qualified',
      metadata: {},
    });
    const message = await AgencyDataSource.getRepository(
      InboxMessageEntity,
    ).save({
      tenantId,
      workspaceId,
      conversationId: conversation.id,
      channelId: channel.id,
      direction: 'inbound',
      senderType: 'contact',
      messageType: 'text',
      content: 'mensagem preservada',
      status: 'received',
      attachments: [],
      metadata: {},
      occurredAt: new Date(),
    });
    const batch = await AgencyDataSource.getRepository(
      InboxProcessingBatchEntity,
    ).save({
      tenantId,
      workspaceId,
      conversationId: conversation.id,
      channelId: channel.id,
      generation: 1,
      status: 'pending',
      dueAt: new Date(),
      messageCount: 1,
    });
    const decision = await AgencyDataSource.getRepository(
      InboxAgentDecisionEntity,
    ).save({
      tenantId,
      workspaceId,
      conversationId: conversation.id,
      batchId: batch.id,
      ownershipVersion: 4,
      schemaVersion: 1,
      idempotencyKey: `decision:${batch.id}`,
      correlationId: randomUUID(),
      status: 'proposed',
      proposal: {},
      policyResult: {},
      contextSnapshot: {},
      promptLayers: [],
      usage: {},
      actionPlan: [],
      appliedActions: [],
    });
    const ctx = {
      tenantId,
      workspaceId,
      userId: actorUserId,
    } as never;

    const results = await Promise.all([
      service.execute(
        ctx,
        channel.id,
        'disconnect',
        'same-disconnect-key',
        'piloto',
      ),
      service.execute(
        ctx,
        channel.id,
        'disconnect',
        'same-disconnect-key',
        'piloto',
      ),
    ]);

    expect(results.map((item) => item.idempotent).sort()).toEqual([
      false,
      true,
    ]);
    const persistedChannel = await AgencyDataSource.getRepository(
      InboxChannelEntity,
    ).findOneByOrFail({ id: channel.id });
    expect(persistedChannel).toMatchObject({
      status: 'inactive',
      connectionStatus: 'disconnected',
      aiEnabled: false,
      accessTokenEncrypted: null,
      verifyToken: null,
      webhookSecret: null,
      externalPhoneNumberId: 'phone-audit-id',
      externalAccountId: 'waba-audit-id',
      disconnectedBy: actorUserId,
    });
    await expect(
      AgencyDataSource.getRepository(InboxMessageEntity).findOneByOrFail({
        id: message.id,
      }),
    ).resolves.toBeDefined();
    await expect(
      AgencyDataSource.getRepository(InboxConversationEntity).findOneByOrFail({
        id: conversation.id,
      }),
    ).resolves.toMatchObject({
      aiEnabled: false,
      ownershipState: 'paused',
      ownershipVersion: 5,
      ownershipReason: 'channel_disconnected',
    });
    await expect(
      AgencyDataSource.getRepository(
        InboxProcessingBatchEntity,
      ).findOneByOrFail({ id: batch.id }),
    ).resolves.toMatchObject({
      status: 'cancelled',
      errorCode: 'channel_disconnected',
    });
    await expect(
      AgencyDataSource.getRepository(InboxAgentDecisionEntity).findOneByOrFail({
        id: decision.id,
      }),
    ).resolves.toMatchObject({
      status: 'invalidated',
      errorCode: 'channel_disconnected',
    });
    expect(
      await AgencyDataSource.getRepository(
        InboxChannelLifecycleRequestEntity,
      ).count(),
    ).toBe(1);
    expect(
      (await AgencyDataSource.getRepository(InboxDomainOutboxEntity).find())
        .map((event) => event.eventName)
        .sort(),
    ).toEqual([
      'inbox.channel.credential_removed',
      'inbox.channel.disconnect_requested',
      'inbox.channel.disconnected',
      'inbox.channel.pending_work_cancelled',
    ]);
  });

  it('does not resolve a channel from another workspace', async () => {
    const channel = await AgencyDataSource.getRepository(
      InboxChannelEntity,
    ).save({
      tenantId,
      workspaceId,
      name: 'Scoped channel',
      type: 'manual',
      status: 'active',
      connectionStatus: 'connected',
      aiEnabled: false,
      settings: {},
      metadata: {},
    });

    await expect(
      service.execute(
        { tenantId, workspaceId: randomUUID(), userId: actorUserId } as never,
        channel.id,
        'disconnect',
        'cross-workspace-key',
      ),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
