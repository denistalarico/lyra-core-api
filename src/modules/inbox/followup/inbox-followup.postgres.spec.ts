/* eslint-disable @typescript-eslint/no-unsafe-assignment -- Jest asymmetric matchers are typed as any */
import { ConflictException } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { AgencyDataSource } from '../../../database/agency-typeorm.datasource';
import { CreateInboxFollowupTemplates1800300000000 } from '../../../database/migrations/1800300000000-create-inbox-followup-templates';
import { deleteFixtureTenant } from '../../../testing/fixture-tenant';
import { describePostgresIntegration } from '../../../testing/postgres-integration';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { FacebookMessengerOutboundService } from '../channels/facebook-messenger/services/facebook-messenger-outbound.service';
import { InstagramOutboundService } from '../channels/instagram/services/instagram-outbound.service';
import { InboxMetaOperationLedgerService } from '../channels/whatsapp/services/inbox-meta-operation-ledger.service';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxFollowupTemplateEntity } from '../entities/inbox-followup-template.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { InboxMetaOperationEntity } from '../entities/inbox-meta-operation.entity';
import { InboxFollowupTemplatesService } from './inbox-followup-templates.service';
import { InboxFollowupService } from './inbox-followup.service';

const run = describePostgresIntegration();
const DAY = 24 * 60 * 60 * 1_000;

/**
 * IX2 on real queries: the Instagram/Messenger automation and follow-up sends
 * (only the Meta transport is a stub), the one-click send updating the CRM
 * card, the templates' scope, and the migration's up/down/up.
 */
run('Inbox assisted follow-up PostgreSQL (IX2)', () => {
  const tenantId = randomUUID();
  const workspaceId = randomUUID();
  const userId = randomUUID();
  const migration = new CreateInboxFollowupTemplates1800300000000();
  const previousTag = process.env.INBOX_META_HUMAN_AGENT_TAG_ENABLED;

  const resetFixtures = () =>
    deleteFixtureTenant(AgencyDataSource, tenantId, [
      'inbox_meta_operations',
      'inbox_conversation_events',
      'inbox_messages',
      'inbox_conversations',
      'inbox_domain_outbox',
      'inbox_channels',
      'inbox_followup_templates',
      'crm_opportunities',
      'crm_stages',
      'crm_pipelines',
    ]);

  beforeAll(async () => {
    if (AgencyDataSource.options.database !== 'lyra_agency_test') {
      throw new Error('IX2 follow-up spec requires lyra_agency_test.');
    }
    await AgencyDataSource.initialize();
    const runner = AgencyDataSource.createQueryRunner();
    try {
      await migration.up(runner);
    } finally {
      await runner.release();
    }
  });

  beforeEach(async () => {
    await resetFixtures();
    process.env.INBOX_META_HUMAN_AGENT_TAG_ENABLED = 'true';
    jest
      .spyOn(global, 'fetch')
      .mockRejectedValue(new Error('Network disabled in IX2 spec.'));
  });

  afterEach(() => {
    jest.restoreAllMocks();
    if (previousTag === undefined) {
      delete process.env.INBOX_META_HUMAN_AGENT_TAG_ENABLED;
    } else {
      process.env.INBOX_META_HUMAN_AGENT_TAG_ENABLED = previousTag;
    }
  });

  afterAll(async () => {
    if (AgencyDataSource.isInitialized) {
      await resetFixtures();
      await AgencyDataSource.destroy();
    }
  });

  type ChannelKind = 'instagram' | 'facebook_messenger';

  function services() {
    const args = [
      AgencyDataSource,
      AgencyDataSource.getRepository(InboxChannelEntity),
      AgencyDataSource.getRepository(InboxConversationEntity),
      AgencyDataSource.getRepository(InboxMessageEntity),
      { decrypt: () => 'synthetic-token' },
      {},
      new InboxMetaOperationLedgerService(
        AgencyDataSource.getRepository(InboxMetaOperationEntity),
      ),
      {},
      {},
    ] as const;
    const instagram = new InstagramOutboundService(
      ...(args as unknown as ConstructorParameters<
        typeof InstagramOutboundService
      >),
    );
    const messenger = new FacebookMessengerOutboundService(
      ...(args as unknown as ConstructorParameters<
        typeof FacebookMessengerOutboundService
      >),
    );
    const templates = new InboxFollowupTemplatesService(
      AgencyDataSource.getRepository(InboxFollowupTemplateEntity),
    );
    const followup = new InboxFollowupService(
      AgencyDataSource,
      instagram,
      messenger,
      templates,
    );
    return { instagram, messenger, templates, followup };
  }

  /** Replaces only the transport, recording every body Meta would receive. */
  function stubMeta(service: object) {
    const bodies: Array<Record<string, unknown>> = [];
    const spy = jest
      .spyOn(
        service as unknown as {
          sendToMeta: (...args: unknown[]) => Promise<unknown>;
        },
        'sendToMeta',
      )
      .mockImplementation((...args: unknown[]) => {
        bodies.push(args[2] as Record<string, unknown>);
        return Promise.resolve({ message_id: `mid.${bodies.length}` });
      });
    return { spy, bodies };
  }

  async function seed(kind: ChannelKind, lastInboundAgoMs: number) {
    const channel = await AgencyDataSource.getRepository(
      InboxChannelEntity,
    ).save({
      tenantId,
      workspaceId,
      name: `Synthetic ${kind}`,
      type: kind,
      provider: 'meta',
      status: 'active',
      connectionStatus: 'connected',
      externalAccountId: `account-${kind}`,
      externalPageId: `page-${kind}`,
      accessTokenEncrypted: 'synthetic-encrypted-token',
      scopeKind: 'agency',
      agencyClientId: null,
      companyContextId: null,
      aiEnabled: true,
      settings: {},
      metadata: {},
    });
    const prefix = kind === 'instagram' ? 'instagram' : 'facebook_messenger';
    const conversation = await AgencyDataSource.getRepository(
      InboxConversationEntity,
    ).save({
      tenantId,
      workspaceId,
      channelId: channel.id,
      externalThreadId: `${prefix}:scoped-${randomUUID().slice(0, 8)}`,
      scopeKind: 'agency',
      agencyClientId: null,
      companyContextId: null,
      status: 'open',
      source: kind,
      businessMode: 'general',
      ownershipState: 'ai_active',
      ownershipVersion: 2,
      ownershipChangedAt: new Date(),
      aiEnabled: true,
      qualificationStatus: 'pending',
      metadata: { contactName: 'Marina Souza' },
    });
    await AgencyDataSource.getRepository(InboxMessageEntity).save({
      tenantId,
      workspaceId,
      channelId: channel.id,
      conversationId: conversation.id,
      direction: 'inbound',
      senderType: 'contact',
      messageType: 'text',
      content: 'Oi',
      status: 'received',
      attachments: [],
      metadata: {},
      occurredAt: new Date(Date.now() - lastInboundAgoMs),
    });
    return { channel, conversation };
  }

  async function seedOpportunity(
    conversation: InboxConversationEntity,
    attempts: unknown[],
  ) {
    const [pipeline] = await AgencyDataSource.query<Array<{ id: string }>>(
      `INSERT INTO crm_pipelines (tenant_id, workspace_id, name, scope_kind)
       VALUES ($1, $2, 'IX2', 'agency') RETURNING id`,
      [tenantId, workspaceId],
    );
    const [stage] = await AgencyDataSource.query<Array<{ id: string }>>(
      `INSERT INTO crm_stages (tenant_id, workspace_id, pipeline_id, name)
       VALUES ($1, $2, $3, 'Novo') RETURNING id`,
      [tenantId, workspaceId, pipeline.id],
    );
    const [opportunity] = await AgencyDataSource.query<Array<{ id: string }>>(
      `INSERT INTO crm_opportunities
         (tenant_id, workspace_id, pipeline_id, stage_id, title, scope_kind,
          contact_name, inbox_conversation_id, metadata)
       VALUES ($1, $2, $3, $4, 'Lead IX2', 'agency', 'Marina Souza', $5, $6)
       RETURNING id`,
      [
        tenantId,
        workspaceId,
        pipeline.id,
        stage.id,
        conversation.id,
        JSON.stringify({ followUp: { attempts } }),
      ],
    );
    return opportunity.id;
  }

  const outboxFor = (messageId: string) =>
    AgencyDataSource.getRepository(InboxDomainOutboxEntity).findOneByOrFail({
      tenantId,
      idempotencyKey: `message.sent:${messageId}`,
    });

  it.each(['instagram', 'facebook_messenger'] as const)(
    '%s: automation text inside the window is the system, untagged and idempotent',
    async (kind) => {
      const { conversation } = await seed(kind, 2 * 60 * 60 * 1_000);
      const all = services();
      const service = kind === 'instagram' ? all.instagram : all.messenger;
      const meta = stubMeta(service);
      const automationId = randomUUID();
      const input = {
        tenantId,
        workspaceId,
        conversationId: conversation.id,
        automationId,
        idempotencyKey: `ix2:auto:${randomUUID()}`,
        text: 'Conseguiu ver a proposta?',
      };

      const first = await service.sendAutomationMessage(input);
      const replay = await service.sendAutomationMessage(input);

      expect(meta.spy).toHaveBeenCalledTimes(1);
      expect(meta.bodies[0].tag).toBeUndefined();
      expect(meta.bodies[0].messaging_type).toBe(
        kind === 'instagram' ? undefined : 'RESPONSE',
      );
      expect(first.message).toMatchObject({
        senderType: 'system',
        status: 'sent',
        metadata: expect.objectContaining({ automationId }),
      });
      expect(replay.message.id).toBe(first.message.id);
      expect((await outboxFor(first.message.id)).payload).toMatchObject({
        authorType: 'system',
        automationId,
      });
    },
  );

  it.each(['instagram', 'facebook_messenger'] as const)(
    '%s: past 24h an automation is refused before anything is written',
    async (kind) => {
      const { conversation } = await seed(kind, 3 * DAY);
      const all = services();
      const service = kind === 'instagram' ? all.instagram : all.messenger;
      const meta = stubMeta(service);

      await expect(
        service.sendAutomationMessage({
          tenantId,
          workspaceId,
          conversationId: conversation.id,
          automationId: randomUUID(),
          idempotencyKey: `ix2:auto:${randomUUID()}`,
          text: 'Oi?',
        }),
      ).rejects.toThrow(
        new ConflictException('human_agent_tag_requires_human'),
      );
      expect(meta.spy).not.toHaveBeenCalled();
      expect(
        await AgencyDataSource.getRepository(InboxMessageEntity).countBy({
          tenantId,
          conversationId: conversation.id,
          direction: 'outbound',
        }),
      ).toBe(0);
    },
  );

  it.each(['instagram', 'facebook_messenger'] as const)(
    '%s: one-click follow-up goes out as a person with HUMAN_AGENT and marks the card',
    async (kind) => {
      const { conversation } = await seed(kind, 3 * DAY);
      const all = services();
      const service = kind === 'instagram' ? all.instagram : all.messenger;
      const meta = stubMeta(service);
      const automationId = randomUUID();
      const channel =
        kind === 'instagram' ? 'instagram_direct' : 'facebook_messenger';
      const opportunityId = await seedOpportunity(conversation, [
        {
          stepKey: 'd3',
          result: 'manual_pending',
          channel,
          at: new Date().toISOString(),
          runId: 'timer-d3',
          automationId,
          expiresAt: new Date(Date.now() + 4 * DAY).toISOString(),
          proposedText: null,
        },
      ]);
      const ctx = { tenantId, workspaceId, userId };
      const template = await all.templates.create(ctx, {
        name: 'D+3 padrão',
        stepKey: 'd3',
        channelTypes: [kind],
        body: 'Oi {{contact.firstName}}, conseguiu pensar na proposta?',
      });
      const dto = {
        templateId: template.id,
        stepKey: 'd3' as const,
        idempotencyKey: `ix2:followup:${randomUUID()}`,
      };

      const result = await all.followup.send(ctx, conversation.id, dto);
      await all.followup.send(ctx, conversation.id, dto);

      expect(meta.spy).toHaveBeenCalledTimes(1);
      expect(meta.bodies[0]).toMatchObject({
        messaging_type: 'MESSAGE_TAG',
        tag: 'HUMAN_AGENT',
        message: { text: 'Oi Marina, conseguiu pensar na proposta?' },
      });
      expect(result.message).toMatchObject({
        senderType: 'user',
        senderUserId: userId,
        metadata: expect.objectContaining({
          messageTag: 'HUMAN_AGENT',
          followUpStepKey: 'd3',
          automationId,
        }),
      });
      // The person nudged the lead; the agent keeps the conversation.
      await expect(
        AgencyDataSource.getRepository(InboxConversationEntity).findOneByOrFail(
          { id: conversation.id },
        ),
      ).resolves.toMatchObject({ ownershipState: 'ai_active' });
      expect((await outboxFor(result.message.id)).payload).toMatchObject({
        authorType: 'user',
        automationId,
        followUpStepKey: 'd3',
      });
      const card = await AgencyDataSource.getRepository(
        CrmOpportunityEntity,
      ).findOneByOrFail({ id: opportunityId });
      expect(
        (card.metadata.followUp as { attempts: unknown[] }).attempts,
      ).toEqual([
        expect.objectContaining({
          stepKey: 'd3',
          result: 'sent',
          runId: 'timer-d3',
        }),
      ]);
      await expect(
        all.followup.getMessagingWindow(ctx, conversation.id),
      ).resolves.toMatchObject({
        channelType: kind,
        pendingFollowUp: null,
        humanAgentExpiresAt: expect.any(String),
      });
    },
  );

  it('refuses the one-click send once the 7-day human window closed', async () => {
    const { conversation } = await seed('instagram', 8 * DAY);
    const all = services();
    const meta = stubMeta(all.instagram);

    await expect(
      all.followup.send({ tenantId, workspaceId, userId }, conversation.id, {
        text: 'Oi, ainda por aí?',
        stepKey: 'd7',
        idempotencyKey: `ix2:followup:${randomUUID()}`,
      }),
    ).rejects.toThrow(
      new ConflictException('instagram_outside_standard_messaging_window'),
    );
    expect(meta.spy).not.toHaveBeenCalled();
  });

  it('keeps templates inside their company scope', async () => {
    const { templates } = services();
    const agency = { tenantId, workspaceId, userId };
    const created = await templates.create(agency, {
      name: 'Qualquer passo',
      stepKey: 'any',
      body: 'Oi {{contact.firstName}}!',
    });
    const company = {
      ...agency,
      managedContext: {
        productKey: 'leadflow' as const,
        operatingMode: 'client' as const,
        clientId: randomUUID(),
        companyContextId: randomUUID(),
        managedTenantId: null,
      },
    };

    await expect(templates.list(company)).resolves.toEqual([]);
    await expect(
      templates.update(company, created.id, { name: 'Invasão' }),
    ).rejects.toThrow('Follow-up template not found.');
    await expect(
      templates.update(agency, created.id, { isActive: false }),
    ).resolves.toMatchObject({ name: 'Qualquer passo', isActive: false });
  });

  it('migrates down and up again', async () => {
    const runner = AgencyDataSource.createQueryRunner();
    try {
      await migration.down(runner);
      expect(await runner.hasTable('inbox_followup_templates')).toBe(false);
      await migration.up(runner);
      await migration.up(runner);
      expect(await runner.hasTable('inbox_followup_templates')).toBe(true);
      await expect(
        runner.query(
          `INSERT INTO inbox_followup_templates
             (tenant_id, workspace_id, scope_kind, name, step_key, body)
           VALUES ($1, $2, 'agency', 'x', 'd5', 'y')`,
          [tenantId, workspaceId],
        ),
      ).rejects.toThrow(/CK_inbox_followup_templates_step/);
    } finally {
      await runner.release();
    }
  });
});
