import {
  governedBusinessContextWriteAllowed,
  InboxGovernedActionWorker,
} from './inbox-governed-action.worker';
import { CrmOpportunityEntity } from '../../crm/entities/crm-opportunity.entity';
import { CrmStageTransitionPolicyEntity } from '../../crm/entities/crm-stage-transition-policy.entity';
import { InboxAgentDecisionEntity } from '../entities/inbox-agent-decision.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { InboxMessageEntity } from '../entities/inbox-message.entity';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities/leadflow-agent.entity';
import { Logger } from '@nestjs/common';
import { createHash } from 'crypto';
import { ContactEntity } from '../../contacts/entities/contact.entity';
import { ContactMethodEntity } from '../../contacts/entities/contact-method.entity';
import { ContactListEntity } from '../../contacts/entities/contact-list.entity';
import { ContactListMemberEntity } from '../../contacts/entities/contact-list-member.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxChannelContactIdentityEntity } from '../entities/inbox-channel-contact-identity.entity';
import { InboxGovernedActionEntity } from '../entities/inbox-governed-action.entity';
import { InboxAutonomyControlEntity } from '../entities/inbox-autonomy-control.entity';

describe('InboxGovernedActionWorker kill switches', () => {
  it('blocks a claimed action when the effect switch is disabled before execution', async () => {
    const action = {
      id: 'action',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      conversationId: 'conversation',
      decisionId: 'decision',
      ownershipVersion: 1,
      policyVersion: 'inbox-autonomy-policy-v1',
      actionType: 'reply',
      actionKey: 'reply',
      policyOutcome: 'allowed',
      status: 'planned',
      applicationResult: {},
      appliedAt: null,
      failedAt: null,
      errorCode: null,
    };
    const save = jest.fn((value: unknown) => Promise.resolve(value));
    const update = jest.fn();
    const repository = {
      findOneBy: jest.fn().mockResolvedValue(action),
      save,
      update,
    };
    const manager = {
      query: jest.fn().mockResolvedValue([{ id: action.id }]),
      getRepository: jest.fn().mockReturnValue(repository),
    };
    const dataSource = {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
      getRepository: jest.fn().mockReturnValue(repository),
      query: jest
        .fn()
        .mockResolvedValue([{ open_count: 0, exception_count: 1 }]),
    };
    const outbound = { sendAgentText: jest.fn() };
    const worker = new InboxGovernedActionWorker(
      dataSource as never,
      {
        autoReplyEnabled: false,
        autoCrmEnabled: false,
        autoHandoffEnabled: false,
      } as never,
      outbound as never,
      { sendAgentText: jest.fn() } as never,
      { sendAgentText: jest.fn() } as never,
      { transition: jest.fn() } as never,
    );

    await worker.processOnce('test-worker');

    expect(outbound.sendAgentText).not.toHaveBeenCalled();
    expect(save).toHaveBeenCalledWith(
      expect.objectContaining({
        status: 'blocked',
        errorCode: 'effect_kill_switch',
      }),
    );
  });

  it('claims reply and CRM effects before the ownership-changing handoff', async () => {
    const query = jest.fn().mockResolvedValue([]);
    const worker = new InboxGovernedActionWorker(
      {
        transaction: (
          callback: (manager: { query: typeof query }) => unknown,
        ) => Promise.resolve(callback({ query })),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );

    await expect(worker.processOnce('worker-test')).resolves.toBeNull();
    expect(query).toHaveBeenCalledWith(
      expect.stringMatching(
        /WHEN 'ensure_contact' THEN 0[\s\S]*WHEN 'ensure_opportunity' THEN 1[\s\S]*WHEN 'reply' THEN 2[\s\S]*WHEN 'set_stage' THEN 3[\s\S]*WHEN 'handoff' THEN 5[\s\S]*ELSE 4/,
      ),
    );
  });

  it('revalidates and applies a pinned AI stage proposal through CRM command authority', async () => {
    const action = {
      id: 'action-stage',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      conversationId: 'conversation',
      decisionId: 'decision',
      ownershipVersion: 4,
      policyVersion: 'inbox-autonomy-policy-v1',
      actionType: 'set_stage',
      actionKey: 'stage',
      auditRef: 'audit',
    };
    const conversation = {
      id: 'conversation',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      opportunityId: 'opportunity',
      ownershipVersion: 4,
      ownershipState: 'ai_active',
      source: 'whatsapp',
    };
    const opportunity = {
      id: 'opportunity',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      pipelineId: 'pipeline',
      stageId: 'stage-current',
      rowVersion: 7,
      inboxConversationId: 'conversation',
      metadata: {},
      businessContext: {},
    };
    const decision = {
      id: 'decision',
      agentId: 'agent',
      contextSnapshot: {
        latestInboundId: 'message-1',
        allowedEvidenceRefs: ['message:message-1'],
      },
      actionPlan: [
        {
          key: 'stage',
          type: 'set_stage',
          allowed: true,
          opportunityId: 'opportunity',
          fromStageId: 'stage-current',
          stageId: 'stage-qualified',
          transitionPolicyId: 'policy',
          transitionPolicyVersion: 3,
          reasonCode: 'ai_qualified',
          opportunityRowVersion: 7,
          evidenceRefs: ['message:message-1'],
          confidence: 0.91,
        },
      ],
    };
    const save = jest.fn((value: unknown) => Promise.resolve(value));
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: jest.fn((entity) => {
        if (entity === InboxConversationEntity)
          return { findOne: jest.fn().mockResolvedValue(conversation) };
        if (entity === InboxMessageEntity)
          return { findOne: jest.fn().mockResolvedValue({ id: 'message-1' }) };
        if (entity === CrmOpportunityEntity)
          return { findOne: jest.fn().mockResolvedValue(opportunity) };
        if (entity === CrmStageTransitionPolicyEntity)
          return {
            findOne: jest.fn().mockResolvedValue({
              id: 'policy',
              allowedActors: ['ai'],
              version: 3,
            }),
          };
        if (
          entity === InboxConversationEventEntity ||
          entity === InboxDomainOutboxEntity
        )
          return { save };
        throw new Error('Unexpected repository');
      }),
    };
    const moveStageWithinTransaction = jest.fn().mockResolvedValue({
      opportunity: {
        ...opportunity,
        stageId: 'stage-qualified',
        rowVersion: 8,
      },
    });
    const worker = new InboxGovernedActionWorker(
      {
        transaction: (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      { moveStageWithinTransaction } as never,
    );
    // This focused test intentionally reaches the private transaction boundary.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const applyCrm = (
      worker as unknown as {
        applyCrm: (
          actionValue: typeof action,
          decisionValue: InboxAgentDecisionEntity,
          conversationValue: InboxConversationEntity,
        ) => Promise<Record<string, unknown>>;
      }
    ).applyCrm.bind(worker);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      applyCrm(
        action,
        decision as unknown as InboxAgentDecisionEntity,
        conversation as unknown as InboxConversationEntity,
      ),
    ).resolves.toEqual({ opportunityId: 'opportunity' });
    expect(moveStageWithinTransaction).toHaveBeenCalledWith(
      manager,
      { tenantId: 'tenant', workspaceId: 'workspace' },
      'opportunity',
      'stage-qualified',
      expect.objectContaining({
        actor: { type: 'ai', agentId: 'agent' },
        expectedVersion: 7,
        expectedTransitionPolicyId: 'policy',
        expectedTransitionPolicyVersion: 3,
        reason: 'ai_qualified',
        idempotencyKey: 'governed:action-stage:stage',
      }),
    );
    expect(save).toHaveBeenCalledTimes(2);
  });

  it('preserves human CRM values while allowing idempotent or governed enrichment', () => {
    expect(
      governedBusinessContextWriteAllowed(
        { niche: 'human value' },
        'niche',
        'agent value',
      ),
    ).toBe(false);
    expect(
      governedBusinessContextWriteAllowed(
        { niche: 'human value' },
        'niche',
        'human value',
      ),
    ).toBe(true);
    expect(
      governedBusinessContextWriteAllowed(
        {
          niche: 'old agent value',
          fieldProvenance: { niche: { source: 'governed_agent' } },
        },
        'niche',
        'new agent value',
      ),
    ).toBe(true);
  });

  it('resolves an optional published human CRM target for handoff coordination', async () => {
    const agentRepository = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'agent',
        publishedVersionId: 'version',
        handoffPolicy: {
          transferOpportunityOnHandoff: true,
          targetPipelineId: 'pipeline-human',
          targetStageId: 'stage-human',
        },
      }),
    };
    const worker = new InboxGovernedActionWorker(
      {
        getRepository: jest.fn((entity) => {
          expect(entity).toBe(LeadFlowAgentEntity);
          return agentRepository;
        }),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    // This focused test intentionally reaches the private policy resolver.
    // eslint-disable-next-line @typescript-eslint/no-unsafe-assignment
    const resolveTransfer = (
      worker as unknown as {
        resolveHandoffTransfer: (
          action: { id: string; tenantId: string; workspaceId: string },
          decision: { agentId: string | null },
        ) => Promise<unknown>;
      }
    ).resolveHandoffTransfer.bind(worker);

    await expect(
      // eslint-disable-next-line @typescript-eslint/no-unsafe-call
      resolveTransfer(
        { id: 'action', tenantId: 'tenant', workspaceId: 'workspace' },
        { agentId: 'agent' },
      ),
    ).resolves.toEqual({
      pipelineId: 'pipeline-human',
      stageId: 'stage-human',
      idempotencyKey: 'handoff:action:pipeline-transfer',
      agentId: 'agent',
    });
  });
});

describe('InboxGovernedActionWorker social canonical contacts', () => {
  function setup(options: {
    channelType: string;
    externalThreadId: string;
    metadata?: Record<string, unknown>;
    inboundMetadata?: Record<string, unknown>;
    contactId?: string;
    existingIdentityContactId?: string;
  }) {
    const action = {
      id: 'action-contact',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      conversationId: 'conversation',
      policyVersion: 'inbox-autonomy-policy-v1',
    } as InboxGovernedActionEntity;
    const conversation = {
      id: 'conversation',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      channelId: 'channel',
      source: options.channelType,
      externalThreadId: options.externalThreadId,
      title: options.externalThreadId,
      businessMode: 'general',
      metadata: options.metadata ?? {},
      contactId: options.contactId ?? null,
    } as InboxConversationEntity;
    const contacts = {
      save: jest.fn((value: Record<string, unknown>) =>
        Promise.resolve({ ...value, id: 'new-contact' }),
      ),
    };
    const methods = { save: jest.fn().mockResolvedValue({}) };
    const identities = {
      findOneBy: jest
        .fn()
        .mockResolvedValue(
          options.existingIdentityContactId
            ? { contactId: options.existingIdentityContactId }
            : null,
        ),
      save: jest.fn().mockResolvedValue({}),
    };
    const channels = {
      findOneBy: jest.fn().mockResolvedValue({
        id: 'channel',
        tenantId: 'tenant',
        workspaceId: 'workspace',
        type: options.channelType,
        metadata: {},
      }),
    };
    const messages = {
      findOne: jest.fn().mockResolvedValue({
        id: 'latest-inbound',
        metadata: options.inboundMetadata ?? {},
      }),
    };
    const memberInsert = {
      insert: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn().mockResolvedValue({}),
    };
    const repositories = new Map<unknown, unknown>([
      [ContactEntity, contacts],
      [ContactMethodEntity, methods],
      [InboxChannelContactIdentityEntity, identities],
      [InboxChannelEntity, channels],
      [InboxMessageEntity, messages],
      [
        InboxConversationEntity,
        {
          findOne: jest.fn().mockResolvedValue(conversation),
          save: jest.fn().mockResolvedValue(conversation),
        },
      ],
      [
        ContactListEntity,
        { findOneBy: jest.fn().mockResolvedValue({ id: 'list' }) },
      ],
      [ContactListMemberEntity, { createQueryBuilder: () => memberInsert }],
      [InboxConversationEventEntity, { save: jest.fn().mockResolvedValue({}) }],
      [InboxDomainOutboxEntity, { save: jest.fn().mockResolvedValue({}) }],
    ]);
    const manager = {
      query: jest.fn().mockResolvedValue([]),
      getRepository: (entity: unknown) => {
        if (!repositories.has(entity)) throw new Error('Unexpected repository');
        return repositories.get(entity);
      },
    };
    const worker = new InboxGovernedActionWorker(
      {
        transaction: (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      } as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
      {} as never,
    );
    const ensureContact = () =>
      (
        worker as unknown as {
          ensureContact: (
            action: InboxGovernedActionEntity,
            snapshot: InboxConversationEntity,
          ) => Promise<unknown>;
        }
      ).ensureContact(action, conversation);
    return {
      ensureContact,
      conversation,
      contacts,
      methods,
      identities,
      channels,
      messages,
      manager,
    };
  }

  it('creates an Instagram contact using the latest inbound name and username without phone matching', async () => {
    const test = setup({
      channelType: 'instagram',
      externalThreadId: 'instagram:account:17841400000000123',
      inboundMetadata: { senderName: 'Ana Silva', senderUsername: 'ana.silva' },
      metadata: {
        contactName: 'Nome antigo',
        contactEmail: 'ana@example.com',
        avatarUrl: 'https://cdn.example/avatar.jpg',
      },
    });

    await expect(test.ensureContact()).resolves.toEqual({
      contactId: 'new-contact',
      contactOutcome: 'created',
    });
    expect(test.contacts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Ana Silva',
        source: 'leadflow_instagram',
      }),
    );
    expect(test.methods.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'instagram',
        value: '@ana.silva',
        contactId: 'new-contact',
      }),
    );
    expect(test.identities.save).toHaveBeenCalledWith(
      expect.objectContaining({
        channelId: 'channel',
        identityType: 'instagram',
        externalIdentityHash: createHash('sha256')
          .update('instagram:17841400000000123')
          .digest('hex'),
      }),
    );
    expect(test.conversation.contactId).toBe('new-contact');
    expect(test.conversation.metadata.avatarUrl).toBe(
      'https://cdn.example/avatar.jpg',
    );
    expect(
      test.manager.query.mock.calls.some(([sql]) =>
        String(sql).includes('JOIN contact_methods'),
      ),
    ).toBe(false);
    expect(test.channels.findOneBy).toHaveBeenCalledWith({
      id: 'channel',
      tenantId: 'tenant',
      workspaceId: 'workspace',
    });
    expect(test.messages.findOne).toHaveBeenCalledWith(
      expect.objectContaining({
        where: {
          tenantId: 'tenant',
          workspaceId: 'workspace',
          conversationId: 'conversation',
          direction: 'inbound',
        },
        order: { occurredAt: 'DESC', id: 'DESC' },
      }),
    );
  });

  it('creates a Messenger contact when name and email are available', async () => {
    const test = setup({
      channelType: 'facebook_messenger',
      externalThreadId: 'messenger:page:98765432101234567',
      metadata: {
        contactName: 'Maria Souza',
        contactEmail: 'maria@example.com',
      },
    });

    await expect(test.ensureContact()).resolves.toEqual({
      contactId: 'new-contact',
      contactOutcome: 'created',
    });
    expect(test.contacts.save).toHaveBeenCalledWith(
      expect.objectContaining({
        displayName: 'Maria Souza',
        source: 'leadflow_messenger',
      }),
    );
    expect(test.methods.save).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'facebook', value: '98765432101234567' }),
    );
    expect(test.identities.save).toHaveBeenCalledWith(
      expect.objectContaining({
        identityType: 'messenger',
        externalIdentityHash: createHash('sha256')
          .update('messenger:98765432101234567')
          .digest('hex'),
      }),
    );
    expect(
      test.manager.query.mock.calls.some(([sql]) =>
        String(sql).includes('JOIN contact_methods'),
      ),
    ).toBe(false);
  });

  it('does not create a WhatsApp contact without a real name', async () => {
    const test = setup({
      channelType: 'whatsapp',
      externalThreadId: '+5511999999999',
    });

    await expect(test.ensureContact()).rejects.toThrow(
      'contact_basic_data_missing',
    );
    expect(test.contacts.save).not.toHaveBeenCalled();
    expect(test.methods.save).not.toHaveBeenCalled();
  });

  it('does not create a social contact without phone or email', async () => {
    const test = setup({
      channelType: 'instagram',
      externalThreadId: 'instagram:17841400000000123',
      inboundMetadata: {
        senderName: 'Ana Silva',
        senderUsername: 'ana.silva',
      },
    });

    await expect(test.ensureContact()).rejects.toThrow(
      'contact_basic_data_missing',
    );
    expect(test.contacts.save).not.toHaveBeenCalled();
    expect(test.methods.save).not.toHaveBeenCalled();
  });

  it('does not accept an Instagram username as the contact name', async () => {
    const test = setup({
      channelType: 'instagram',
      externalThreadId: 'instagram:17841400000000123',
      inboundMetadata: { senderUsername: '@ana.silva' },
      metadata: { contactEmail: 'ana@example.com' },
    });
    await expect(test.ensureContact()).rejects.toThrow(
      'contact_basic_data_missing',
    );
    expect(test.contacts.save).not.toHaveBeenCalled();
    expect(test.methods.save).not.toHaveBeenCalled();
  });

  it('uses conversation profile metadata and the scoped Instagram ID when no inbound username exists', async () => {
    const test = setup({
      channelType: 'instagram',
      externalThreadId: 'instagram:17841400000000123',
      metadata: {
        contactName: 'Ana do perfil',
        contactPhone: '+5511999999999',
      },
    });
    await test.ensureContact();
    expect(test.contacts.save).toHaveBeenCalledWith(
      expect.objectContaining({ displayName: 'Ana do perfil' }),
    );
    expect(test.methods.save).toHaveBeenCalledWith(
      expect.objectContaining({
        type: 'instagram',
        value: '17841400000000123',
      }),
    );
  });

  it('reuses a channel-scoped social identity without creating another contact or method', async () => {
    const test = setup({
      channelType: 'instagram',
      externalThreadId: 'instagram:17841400000000123',
      existingIdentityContactId: 'existing-contact',
    });
    await expect(test.ensureContact()).resolves.toEqual({
      contactId: 'existing-contact',
      contactOutcome: 'reused',
    });
    expect(test.conversation.contactId).toBe('existing-contact');
    expect(test.contacts.save).not.toHaveBeenCalled();
    expect(test.methods.save).not.toHaveBeenCalled();
    expect(test.identities.findOneBy).toHaveBeenCalledWith({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      channelId: 'channel',
      externalIdentityHash: createHash('sha256')
        .update('instagram:17841400000000123')
        .digest('hex'),
    });
  });

  it('reuses the contact already linked to the conversation without identity lookup or creation', async () => {
    const test = setup({
      channelType: 'instagram',
      externalThreadId: 'instagram:17841400000000123',
      contactId: 'linked-contact',
    });
    await expect(test.ensureContact()).resolves.toEqual({
      contactId: 'linked-contact',
      contactOutcome: 'reused',
    });
    expect(test.contacts.save).not.toHaveBeenCalled();
    expect(test.methods.save).not.toHaveBeenCalled();
    expect(test.identities.findOneBy).not.toHaveBeenCalled();
  });

  it('fails closed for an unsupported channel before creating a contact', async () => {
    const test = setup({
      channelType: 'webchat',
      externalThreadId: 'visitor-123',
    });
    await expect(test.ensureContact()).rejects.toThrow(
      'canonical_identity_unsupported',
    );
    expect(test.contacts.save).not.toHaveBeenCalled();
    expect(test.methods.save).not.toHaveBeenCalled();
  });
});

describe('InboxGovernedActionWorker readable effect failures', () => {
  afterEach(() => jest.restoreAllMocks());

  it('sends the agent reply under the conversation company scope', async () => {
    const sendAgentText = jest.fn().mockRejectedValue(new Error('stop'));
    await failReply(new Error('stop'), {
      sendAgentText,
      conversation: {
        tenantId: 'tenant',
        workspaceId: 'workspace',
        scopeKind: 'company',
        agencyClientId: 'client-1',
        companyContextId: 'company-a',
      },
    });

    const [[payload]] = sendAgentText.mock.calls as Array<
      [{ ctx: Record<string, unknown> }]
    >;
    expect(payload.ctx).toMatchObject({
      tenantId: 'tenant',
      workspaceId: 'workspace',
      managedContext: {
        operatingMode: 'client',
        clientId: 'client-1',
        companyContextId: 'company-a',
      },
    });
  });

  async function failReply(
    error: Error,
    options: {
      sendAgentText?: jest.Mock;
      conversation?: Record<string, unknown>;
    } = {},
  ) {
    const action = {
      id: 'action-reply',
      tenantId: 'tenant',
      workspaceId: 'workspace',
      conversationId: 'conversation',
      decisionId: 'decision',
      actionType: 'reply',
      ownershipVersion: 1,
      policyOutcome: 'allowed',
      applicationResult: {},
    };
    const actionRepository = {
      findOneBy: jest.fn().mockResolvedValue(action),
      update: jest
        .fn<Promise<unknown>, [string, Partial<InboxGovernedActionEntity>]>()
        .mockResolvedValue({}),
    };
    const repositories = new Map<unknown, unknown>([
      [InboxGovernedActionEntity, actionRepository],
      [
        InboxAgentDecisionEntity,
        {
          findOneBy: jest.fn().mockResolvedValue({
            id: 'decision',
            agentId: 'agent',
            proposal: { reply: 'private reply body' },
          }),
        },
      ],
      [
        InboxConversationEntity,
        {
          findOneBy: jest.fn().mockResolvedValue({
            id: 'conversation',
            channelId: 'channel',
            externalThreadId: '+5511999999999',
            aiEnabled: true,
            ownershipState: 'ai_active',
            ownershipVersion: 1,
            ...options.conversation,
          }),
        },
      ],
      [
        InboxChannelEntity,
        { findOneBy: jest.fn().mockResolvedValue({ type: 'whatsapp' }) },
      ],
      [
        InboxAutonomyControlEntity,
        { findOneBy: jest.fn().mockResolvedValue(null) },
      ],
    ]);
    const manager = {
      query: jest.fn().mockResolvedValue([{ id: action.id }]),
      getRepository: (entity: unknown) => repositories.get(entity),
    };
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    const worker = new InboxGovernedActionWorker(
      {
        transaction: (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
        getRepository: manager.getRepository,
        query: jest.fn().mockResolvedValue([]),
      } as never,
      { autoReplyEnabled: true } as never,
      {
        sendAgentText:
          options.sendAgentText ?? jest.fn().mockRejectedValue(error),
      } as never,
      {} as never,
      {} as never,
      {} as never,
    );
    await expect(worker.processOnce('worker-test')).resolves.toBeNull();
    const failed = actionRepository.update.mock.calls.find(
      ([, value]) => value.status === 'failed',
    );
    expect(failed).toBeDefined();
    return {
      failure: failed?.[1] as {
        errorCode: string;
        applicationResult: { errorClass: string; errorMessage: string };
      },
      warn,
    };
  }

  it('persists a readable TypeORM relation failure and logs its action type without changing errorCode', async () => {
    const error = new Error(
      'Relation with property path conversation in entity was not found',
    );
    error.name = 'TypeORMError';
    const { failure, warn } = await failReply(error);
    expect(failure.errorCode).toBe('effect_failed');
    expect(failure.applicationResult).toEqual({
      errorClass: 'TypeORMError',
      errorMessage: error.message,
    });
    expect(warn).toHaveBeenCalledWith(
      expect.objectContaining({
        actionType: 'reply',
        errorClass: 'TypeORMError',
        errorCode: 'effect_failed',
      }),
    );
  });

  it('keeps slug reason codes stable and never includes tokens, phone numbers or message body in diagnostics', async () => {
    const secret = 'EAAprivate-access-token';
    const phone = '+5511999999999';
    const body = 'private reply body';
    const error = Object.assign(
      new Error(
        `Provider rejected access_token=${secret} phone=${phone} body=${body} ${'x'.repeat(400)}`,
      ),
      { response: { reasonCode: 'provider_unavailable' } },
    );
    const { failure, warn } = await failReply(error);
    expect(failure.errorCode).toBe('provider_unavailable');
    expect(failure.applicationResult.errorClass).toBe('Error');
    expect(failure.applicationResult.errorMessage.length).toBeLessThanOrEqual(
      300,
    );
    const diagnostics = JSON.stringify({
      result: failure.applicationResult,
      logs: warn.mock.calls,
    });
    expect(diagnostics).not.toContain(secret);
    expect(diagnostics).not.toContain(phone);
    expect(diagnostics).not.toContain(body);
  });
});

describe('InboxGovernedActionWorker per-channel reply dispatch', () => {
  it('routes each channel to its own outbound service, SMS included (IX4)', () => {
    const whatsapp = { name: 'whatsapp' };
    const instagram = { name: 'instagram' };
    const messenger = { name: 'messenger' };
    const sms = { name: 'sms' };
    const worker = new InboxGovernedActionWorker(
      {} as never,
      {} as never,
      whatsapp as never,
      instagram as never,
      messenger as never,
      {} as never,
      undefined,
      undefined,
      undefined,
      sms as never,
    );
    const dispatch = (type: string | undefined) =>
      (
        worker as unknown as {
          outboundForChannelType: (type: string | undefined) => unknown;
        }
      ).outboundForChannelType(type);

    expect(dispatch('whatsapp')).toBe(whatsapp);
    expect(dispatch('instagram')).toBe(instagram);
    expect(dispatch('facebook_messenger')).toBe(messenger);
    expect(dispatch('sms')).toBe(sms);
    // Unknown types fail the action instead of leaving through WhatsApp.
    expect(dispatch('email')).toBeNull();
    expect(dispatch(undefined)).toBeNull();
  });
});
