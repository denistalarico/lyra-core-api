import { NotFoundException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../../../database/agency-typeorm.datasource';
import { deleteFixtureTenant } from '../../../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../../../testing/postgres-integration';
import { InboxAgentDecisionEntity } from '../../../entities/inbox-agent-decision.entity';
import { InboxChannelEntity } from '../../../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../../../entities/inbox-conversation.entity';
import { InboxGovernedActionEntity } from '../../../entities/inbox-governed-action.entity';
import { InboxMessageEntity } from '../../../entities/inbox-message.entity';
import { InboxMetaOperationEntity } from '../../../entities/inbox-meta-operation.entity';
import { InboxProcessingBatchEntity } from '../../../entities/inbox-processing-batch.entity';
import { inboxScopeRequestContext } from '../../../inbox-company-scope';
import { InboxMetaOperationLedgerService } from './inbox-meta-operation-ledger.service';
import { InboxPilotOutboundPolicyService } from './inbox-pilot-outbound-policy.service';
import { WhatsAppOutboundService } from './whatsapp-outbound.service';

const run = describePostgresIntegration();

/**
 * Unattended sends on a company-scoped WhatsApp channel, on real queries.
 *
 * The automation (follow-up) and the agent reply used to call the channel
 * service with a bare `{ tenantId, workspaceId }`, which resolves to agency
 * scope: `findChannelForContext` then refused every company channel as
 * missing. Both now send under the conversation's own scope.
 */
run('WhatsApp outbound on a company-scoped channel', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const companyContactId = randomUUID();
  const agencyClientId = randomUUID();
  const companyContextId = randomUUID();
  const policyVersion = 'inbox-autonomy-policy-v1';

  const resetInbox = () =>
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
    if (AgencyDataSource.options.database !== 'lyra_agency_test') {
      throw new Error('Company-scope regression requires lyra_agency_test.');
    }
    await AgencyDataSource.initialize();
    await AgencyDataSource.query(
      `INSERT INTO contacts (id, tenant_id, workspace_id, type, display_name)
       VALUES ($1, $2, $3, 'organization', 'Company scope regression')`,
      [companyContactId, tenantId, workspaceId],
    );
    await AgencyDataSource.query(
      `INSERT INTO agency_clients (id, tenant_id, workspace_id, contact_id, display_name)
       VALUES ($1, $2, $3, $4, 'Company scope client')`,
      [agencyClientId, tenantId, workspaceId, companyContactId],
    );
    await AgencyDataSource.query(
      `INSERT INTO agency_client_company_contexts
        (id, tenant_id, workspace_id, agency_client_id, company_contact_id, status, is_primary)
       VALUES ($1, $2, $3, $4, $5, 'active', true)`,
      [
        companyContextId,
        tenantId,
        workspaceId,
        agencyClientId,
        companyContactId,
      ],
    );
  });

  beforeEach(async () => {
    await resetInbox();
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Network disabled in company-scope spec.'));
  });

  afterEach(() => jest.restoreAllMocks());

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await resetInbox();
      await AgencyDataSource.query(
        'DELETE FROM agency_client_company_contexts WHERE id = $1',
        [companyContextId],
      );
      await AgencyDataSource.query('DELETE FROM agency_clients WHERE id = $1', [
        agencyClientId,
      ]);
      await AgencyDataSource.query('DELETE FROM contacts WHERE id = $1', [
        companyContactId,
      ]);
      await AgencyDataSource.destroy();
    }
  });

  async function seed() {
    const company = {
      scopeKind: 'company' as const,
      agencyClientId,
      companyContextId,
    };
    const channel = await AgencyDataSource.getRepository(
      InboxChannelEntity,
    ).save({
      tenantId,
      workspaceId,
      name: 'Synthetic company WhatsApp',
      type: 'whatsapp',
      provider: 'meta',
      status: 'active',
      connectionStatus: 'connected',
      externalPhoneNumberId: 'synthetic-company-phone-id',
      accessTokenEncrypted: 'synthetic-encrypted-token',
      ...company,
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
      externalThreadId: '5511988887777',
      ...company,
      status: 'open',
      source: 'whatsapp',
      businessMode: 'general',
      ownershipState: 'ai_active',
      ownershipVersion: 4,
      ownershipChangedAt: new Date(),
      aiEnabled: true,
      qualificationStatus: 'pending',
      metadata: {},
    });
    await AgencyDataSource.getRepository(InboxMessageEntity).save({
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
    return { channel, conversation };
  }

  function service() {
    const outbound = new WhatsAppOutboundService(
      AgencyDataSource,
      AgencyDataSource.getRepository(InboxChannelEntity),
      AgencyDataSource.getRepository(InboxConversationEntity),
      AgencyDataSource.getRepository(InboxMessageEntity),
      { decrypt: () => 'synthetic-token' } as never,
      {} as never,
      new InboxPilotOutboundPolicyService(),
      new InboxMetaOperationLedgerService(
        AgencyDataSource.getRepository(InboxMetaOperationEntity),
      ),
    );
    const sendToMeta = jest
      .spyOn(
        outbound as unknown as {
          sendToMeta: () => Promise<{ messages: Array<{ id: string }> }>;
        },
        'sendToMeta',
      )
      .mockResolvedValue({
        messages: [{ id: `wamid.company.${randomUUID()}` }],
      });
    return { outbound, sendToMeta };
  }

  it('sends the automation follow-up through the company channel', async () => {
    const { conversation } = await seed();
    const { outbound, sendToMeta } = service();

    const result = await outbound.sendAutomationMessage({
      tenantId,
      workspaceId,
      conversationId: conversation.id,
      automationId: randomUUID(),
      text: 'Conseguiu ver a proposta?',
      idempotencyKey: `company:auto:${randomUUID()}`,
    });

    expect(sendToMeta).toHaveBeenCalledTimes(1);
    expect(result.message).toMatchObject({
      senderType: 'system',
      status: 'sent',
    });
  });

  it('sends the agent reply under the conversation scope, never under a bare tenant', async () => {
    const { channel, conversation } = await seed();
    const { outbound, sendToMeta } = service();
    const idempotencyKey = `company:agent:${randomUUID()}`;
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
    await AgencyDataSource.getRepository(InboxGovernedActionEntity).save({
      tenantId,
      workspaceId,
      conversationId: conversation.id,
      decisionId: decision.id,
      ownershipVersion: 4,
      policyVersion,
      actionType: 'reply',
      actionKey: 'reply',
      policyOutcome: 'allowed',
      reasonCode: 'allowed',
      idempotencyKey,
      intentHash: 'b'.repeat(64),
      auditRef: randomUUID(),
      status: 'claimed',
    });
    const input = {
      channelId: channel.id,
      conversationId: conversation.id,
      to: conversation.externalThreadId,
      text: 'Resposta do agente',
      agentId: randomUUID(),
      decisionId: decision.id,
      policyVersion,
      ownershipVersion: 4,
      idempotencyKey,
    };

    // What the worker used to pass: agency scope, so the company channel
    // looked missing.
    await expect(
      outbound.sendAgentText({ ...input, ctx: { tenantId, workspaceId } }),
    ).rejects.toThrow(NotFoundException);

    const result = await outbound.sendAgentText({
      ...input,
      ctx: inboxScopeRequestContext(conversation),
    });

    expect(sendToMeta).toHaveBeenCalledTimes(1);
    expect(result.message).toMatchObject({
      senderType: 'agent',
      status: 'sent',
    });
  });
});
