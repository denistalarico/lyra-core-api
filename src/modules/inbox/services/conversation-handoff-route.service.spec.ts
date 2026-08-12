import { AgencyWorkspaceUserEntity } from '../../agency/entities/agency-settings.entities';
import { LeadFlowAgentEntity } from '../../leadflow-agents/entities/leadflow-agent.entity';
import { InboxChannelEntity } from '../entities/inbox-channel.entity';
import { InboxConversationEntity } from '../entities/inbox-conversation.entity';
import { InboxConversationEventEntity } from '../entities/inbox-conversation-event.entity';
import { InboxDomainOutboxEntity } from '../entities/inbox-domain-outbox.entity';
import { ConversationOwnershipService } from './conversation-ownership.service';

/**
 * Para onde vai o handoff.
 *
 * O destino é configuração do agente que atendia — um SDR entrega ao
 * comercial, uma recepção entrega à secretária. Só quando o agente não diz
 * nada valem os fallbacks genéricos.
 */
const SECRETARY = '44444444-4444-4444-8444-444444444444';
const SALES = '55555555-5555-4555-8555-555555555555';

function harness(options: {
  agentTargetUserIds?: string[];
  assignedUserId?: string | null;
  channelDefaultAssignedUserId?: string | null;
  activeMemberIds?: string[];
}) {
  const conversation = {
    id: 'conversation',
    tenantId: 'tenant',
    workspaceId: 'workspace',
    channelId: 'channel',
    opportunityId: null,
    assignedAgentId: 'agent',
    assignedUserId: options.assignedUserId ?? null,
    ownershipState: 'ai_active',
    ownershipVersion: 1,
    ownershipChangedAt: new Date('2026-08-11T10:00:00.000Z'),
    qualificationStatus: 'qualified',
    status: 'open',
    aiEnabled: true,
    metadata: {},
  } as unknown as InboxConversationEntity;

  const activeMemberIds =
    options.activeMemberIds ?? options.agentTargetUserIds ?? [];

  const queryBuilder = {
    update: jest.fn().mockReturnThis(),
    set: jest.fn().mockReturnThis(),
    where: jest.fn().mockReturnThis(),
    execute: jest.fn().mockResolvedValue({ affected: 0 }),
  };

  const manager = {
    createQueryBuilder: jest.fn(() => queryBuilder),
    getRepository: jest.fn((entity) => {
      if (entity === InboxConversationEntity) {
        return {
          findOne: jest.fn().mockResolvedValue(conversation),
          save: jest.fn(async (value) => value),
        };
      }
      if (entity === InboxConversationEventEntity)
        return { save: jest.fn(async (value) => value) };
      if (entity === InboxDomainOutboxEntity)
        return { save: jest.fn(async (value) => value) };
      if (entity === InboxChannelEntity) {
        return {
          findOneBy: jest.fn().mockResolvedValue({
            id: 'channel',
            defaultAssignedUserId: options.channelDefaultAssignedUserId ?? null,
            metadata: {},
          }),
        };
      }
      if (entity === LeadFlowAgentEntity) {
        return {
          findOneBy: jest.fn().mockResolvedValue({
            id: 'agent',
            handoffPolicy: options.agentTargetUserIds
              ? { targetUserIds: options.agentTargetUserIds }
              : {},
          }),
        };
      }
      if (entity === AgencyWorkspaceUserEntity) {
        return {
          find: jest.fn(async (query) => {
            // Owners: consultado por role, não por lista de ids.
            if (!Array.isArray(query.where)) {
              return [{ userId: 'owner-user' }];
            }
            return query.where
              .filter((clause: { userId: string }) =>
                activeMemberIds.includes(clause.userId),
              )
              .map((clause: { userId: string }) => ({ userId: clause.userId }));
          }),
        };
      }
      throw new Error(`Unexpected repository: ${String(entity)}`);
    }),
  };

  const publishHandoffRequested = jest.fn().mockResolvedValue(undefined);
  const service = new ConversationOwnershipService(
    {
      transaction: jest.fn(
        (callback: (value: typeof manager) => Promise<unknown>) =>
          callback(manager),
      ),
    } as never,
    { publishHandoffRequested } as never,
  );

  return { service, publishHandoffRequested };
}

const ctx = { tenantId: 'tenant', workspaceId: 'workspace' } as never;

describe('handoff notification routing', () => {
  it('notifies the users the agent designated', async () => {
    const { service, publishHandoffRequested } = harness({
      agentTargetUserIds: [SECRETARY],
      // Mesmo com responsável na conversa, quem manda é a configuração.
      assignedUserId: 'someone-else',
    });

    await service.transition(ctx, 'conversation', 'request_handoff');

    expect(publishHandoffRequested).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: [SECRETARY] }),
    );
  });

  it('notifies every designated user of a team handoff', async () => {
    const { service, publishHandoffRequested } = harness({
      agentTargetUserIds: [SECRETARY, SALES],
    });

    await service.transition(ctx, 'conversation', 'request_handoff');

    expect(publishHandoffRequested).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: [SECRETARY, SALES] }),
    );
  });

  it('falls back to the inherited route when the agent designates nobody', async () => {
    const { service, publishHandoffRequested } = harness({
      channelDefaultAssignedUserId: 'channel-owner',
    });

    await service.transition(ctx, 'conversation', 'request_handoff');

    expect(publishHandoffRequested).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ['channel-owner'] }),
    );
  });

  // Uma configuração antiga apontando para quem saiu da equipe não pode
  // engolir a notificação.
  it('ignores designated users who are no longer active in the workspace', async () => {
    const { service, publishHandoffRequested } = harness({
      agentTargetUserIds: [SECRETARY],
      activeMemberIds: [],
      channelDefaultAssignedUserId: 'channel-owner',
    });

    await service.transition(ctx, 'conversation', 'request_handoff');

    expect(publishHandoffRequested).toHaveBeenCalledWith(
      expect.objectContaining({ recipientUserIds: ['channel-owner'] }),
    );
  });
});
