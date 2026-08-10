import {
  BadRequestException,
  ConflictException,
  NotFoundException,
} from '@nestjs/common';
import { LeadFlowAgentService } from './leadflow-agent.service';
import { LeadFlowAgentStatus } from '../enums/leadflow-agent-status.enum';
import { RoomAgentOperationalStatus } from '../enums/room-operational.enums';

function buildAgent(overrides: Record<string, unknown> = {}) {
  return {
    id: 'agent-1',
    tenantId: 'tenant-1',
    workspaceId: 'workspace-1',
    settingsId: 'settings-1',
    contextType: 'agency',
    agencyClientId: null,
    businessModeKey: 'general',
    presetKey: null,
    type: 'custom',
    name: 'Agent',
    description: null,
    status: LeadFlowAgentStatus.Draft,
    isSystem: false,
    isCustom: true,
    isProtected: false,
    behaviorConfig: {},
    promptConfig: {},
    handoffPolicy: {},
    crmPolicy: {},
    channelPolicy: {},
    avatarConfig: {},
    readiness: {},
    publishedVersionId: null,
    metadata: {},
    createdById: 'user-1',
    updatedById: 'user-1',
    archivedAt: null as Date | null,
    deletedAt: null as Date | null,
    deletedById: null as string | null,
    createdAt: new Date('2026-01-01T00:00:00.000Z'),
    updatedAt: new Date('2026-01-01T00:00:00.000Z'),
    ...overrides,
  };
}

function buildSettings(agent: ReturnType<typeof buildAgent>) {
  return {
    id: agent.settingsId,
    tenantId: agent.tenantId,
    workspaceId: agent.workspaceId,
    contextType: agent.contextType,
    agencyClientId: agent.agencyClientId,
    businessModeKey: agent.businessModeKey,
  };
}

function buildService(agent: ReturnType<typeof buildAgent>) {
  const settings = buildSettings(agent);

  const agentsRepository = {
    findOne: jest.fn().mockImplementation(async () => agent),
    save: jest
      .fn()
      .mockImplementation(async (value) => Object.assign(agent, value)),
  };
  const bindingsRepository = {
    find: jest.fn().mockResolvedValue([]),
  };
  const settingsRepository = {
    findOne: jest.fn().mockResolvedValue(settings),
  };
  const conversationsRepository = {
    count: jest.fn().mockResolvedValue(0),
  };
  const presetService = {
    isCustomBusinessMode: jest.fn().mockReturnValue(false),
  };
  const bindingReconciler = {
    reconcile: jest.fn().mockResolvedValue([]),
  };
  const operationsRoomState = {
    recordTransition: jest.fn().mockResolvedValue(undefined),
  };

  const service = new LeadFlowAgentService(
    agentsRepository as never,
    {} as never,
    bindingsRepository as never,
    settingsRepository as never,
    conversationsRepository as never,
    presetService as never,
    {} as never,
    {} as never,
    bindingReconciler as never,
    operationsRoomState as never,
  );

  return {
    service,
    agentsRepository,
    bindingsRepository,
    conversationsRepository,
    bindingReconciler,
    operationsRoomState,
  };
}

const ctx = {
  tenantId: 'tenant-1',
  workspaceId: 'workspace-1',
  userId: 'user-1',
  role: 'admin',
} as never;

describe('LeadFlowAgentService lifecycle (archive / unarchive / soft delete)', () => {
  describe('archive', () => {
    it('sets status and archivedAt, reconciles bindings, and records offline status', async () => {
      const agent = buildAgent({ status: LeadFlowAgentStatus.Active });
      const {
        service,
        agentsRepository,
        bindingReconciler,
        operationsRoomState,
      } = buildService(agent);

      const result = await service.archive(ctx, agent.id);

      expect(result.status).toBe(LeadFlowAgentStatus.Archived);
      expect(agentsRepository.save).toHaveBeenCalled();
      expect(agent.archivedAt).toBeInstanceOf(Date);
      expect(bindingReconciler.reconcile).toHaveBeenCalledWith(ctx, {
        trigger: 'agent_archived',
      });
      expect(operationsRoomState.recordTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          nextStatus: RoomAgentOperationalStatus.Offline,
        }),
      );
    });

    it('rejects archiving a protected agent', async () => {
      const agent = buildAgent({ isProtected: true });
      const { service, agentsRepository } = buildService(agent);

      await expect(service.archive(ctx, agent.id)).rejects.toThrow(
        BadRequestException,
      );
      expect(agentsRepository.save).not.toHaveBeenCalled();
    });

    it('is idempotent when the agent is already archived', async () => {
      const agent = buildAgent({
        status: LeadFlowAgentStatus.Archived,
        archivedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const {
        service,
        agentsRepository,
        bindingReconciler,
        operationsRoomState,
      } = buildService(agent);

      await service.archive(ctx, agent.id);

      expect(agentsRepository.save).not.toHaveBeenCalled();
      expect(bindingReconciler.reconcile).not.toHaveBeenCalled();
      expect(operationsRoomState.recordTransition).not.toHaveBeenCalled();
    });
  });

  describe('unarchive', () => {
    it('restores an archived agent to draft and clears archivedAt', async () => {
      const agent = buildAgent({
        status: LeadFlowAgentStatus.Archived,
        archivedAt: new Date('2026-01-01T00:00:00.000Z'),
      });
      const { service } = buildService(agent);

      const result = await service.unarchive(ctx, agent.id);

      expect(result.status).toBe(LeadFlowAgentStatus.Draft);
      expect(agent.archivedAt).toBeNull();
    });

    it('rejects unarchiving a non-archived agent', async () => {
      const agent = buildAgent({ status: LeadFlowAgentStatus.Draft });
      const { service } = buildService(agent);

      await expect(service.unarchive(ctx, agent.id)).rejects.toThrow(
        BadRequestException,
      );
    });
  });

  describe('softDelete', () => {
    it('archives and soft-deletes an operational agent in one safe action', async () => {
      const agent = buildAgent({ status: LeadFlowAgentStatus.Draft });
      const {
        service,
        agentsRepository,
        bindingReconciler,
        operationsRoomState,
      } = buildService(agent);

      const result = await service.softDelete(ctx, agent.id);

      expect(result.status).toBe(LeadFlowAgentStatus.Archived);
      expect(agent.archivedAt).toBeInstanceOf(Date);
      expect(agent.deletedAt).toBeInstanceOf(Date);
      expect(agentsRepository.save).toHaveBeenCalled();
      expect(bindingReconciler.reconcile).toHaveBeenCalledWith(ctx, {
        trigger: 'agent_archived',
      });
      expect(operationsRoomState.recordTransition).toHaveBeenCalledWith(
        expect.objectContaining({
          nextStatus: RoomAgentOperationalStatus.Offline,
        }),
      );
    });

    it('rejects deletion of a protected agent', async () => {
      const agent = buildAgent({ isProtected: true });
      const { service, agentsRepository } = buildService(agent);

      await expect(service.softDelete(ctx, agent.id)).rejects.toThrow(
        BadRequestException,
      );
      expect(agentsRepository.save).not.toHaveBeenCalled();
    });

    it('rejects deletion when the agent has a live assigned conversation', async () => {
      const agent = buildAgent({ status: LeadFlowAgentStatus.Active });
      const { service, agentsRepository, conversationsRepository } =
        buildService(agent);
      conversationsRepository.count.mockResolvedValue(2);

      await expect(service.softDelete(ctx, agent.id)).rejects.toThrow(
        ConflictException,
      );
      expect(agentsRepository.save).not.toHaveBeenCalled();
      expect(agent.status).toBe(LeadFlowAgentStatus.Active);
      expect(agent.deletedAt).toBeNull();
    });

    it('soft-deletes when there is no live conversation, setting deletedAt/deletedById', async () => {
      const agent = buildAgent({ status: LeadFlowAgentStatus.Archived });
      const { service, agentsRepository } = buildService(agent);

      const result = await service.softDelete(ctx, agent.id);

      expect(agent.deletedAt).toBeInstanceOf(Date);
      expect(agent.deletedById).toBe('user-1');
      expect(result.status).toBe(LeadFlowAgentStatus.Archived);
      const lastFindOneCall =
        agentsRepository.findOne.mock.calls[
          agentsRepository.findOne.mock.calls.length - 1
        ];
      expect(lastFindOneCall[0]).toMatchObject({ withDeleted: true });
    });
  });

  describe('governance guard on activate/pause/publish', () => {
    it.each(['activate', 'pause', 'publish'] as const)(
      '%s rejects an archived agent',
      async (method) => {
        const agent = buildAgent({ status: LeadFlowAgentStatus.Archived });
        const { service } = buildService(agent);

        await expect(
          (service[method] as (ctx: unknown, id: string) => Promise<unknown>)(
            ctx,
            agent.id,
          ),
        ).rejects.toThrow(BadRequestException);
      },
    );
  });

  describe('tenant isolation', () => {
    it('404s when the agent does not resolve in the caller tenant/workspace scope', async () => {
      const agent = buildAgent();
      const { service, agentsRepository } = buildService(agent);
      agentsRepository.findOne.mockResolvedValueOnce(null);

      await expect(service.archive(ctx, agent.id)).rejects.toThrow(
        NotFoundException,
      );
    });
  });
});
