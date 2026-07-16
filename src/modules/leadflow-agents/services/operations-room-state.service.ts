import { BadRequestException, Injectable } from '@nestjs/common';
import { InjectDataSource, InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';
import { LeadFlowAgentEntity } from '../entities/leadflow-agent.entity';
import { LeadFlowAgentOperationalStateEntity } from '../entities/room-operational-state.entity';
import { OperationsRoomOutboxEntity } from '../entities/operations-room-outbox.entity';
import { OperationsRoomRevisionEntity } from '../entities/operations-room-revision.entity';
import {
  ROOM_OPERATIONAL_SOURCE_VALUES,
  ROOM_OPERATIONAL_STATUS_VALUES,
  RoomAgentOperationalStatus,
  RoomOperationalSource,
  RoomOutboxDeliveryState,
} from '../enums/room-operational.enums';
import type {
  OperationsRoomSnapshotResponse,
  RecordAgentOperationalTransitionCommand,
  RecordTransitionResult,
  RoomEventPage,
} from '../types/operations-room.types';
import { randomUUID } from 'node:crypto';
import { OperationsRoomEventBusService } from '../realtime/operations-room-event-bus.service';
import { mapOperationsRoomOutboxEvent } from '../realtime/operations-room-event.mapper';

const AGENCY_CONNECTION = 'agency';
const MAX_REPLAY_LIMIT = 500;
const UNKNOWN_SINCE = new Date(0);

@Injectable()
export class OperationsRoomStateService {
  constructor(
    @InjectDataSource(AGENCY_CONNECTION)
    private readonly dataSource: DataSource,
    @InjectRepository(LeadFlowAgentOperationalStateEntity, AGENCY_CONNECTION)
    private readonly stateRepository: Repository<LeadFlowAgentOperationalStateEntity>,
    @InjectRepository(OperationsRoomOutboxEntity, AGENCY_CONNECTION)
    private readonly outboxRepository: Repository<OperationsRoomOutboxEntity>,
    private readonly eventBus?: OperationsRoomEventBusService,
  ) {}

  async recordTransition(
    command: RecordAgentOperationalTransitionCommand,
  ): Promise<RecordTransitionResult> {
    if (
      !command.tenantId ||
      !command.workspaceId ||
      !command.agentId ||
      !command.sourceEventId ||
      Number.isNaN(command.occurredAt.getTime())
    ) {
      return { kind: 'rejected', reason: 'invalid-context' };
    }
    if (!this.isValidTransitionSource(command.nextStatus, command.source)) {
      return { kind: 'rejected', reason: 'invalid-status-source' };
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        return await this.recordTransitionOnce(command);
      } catch (error) {
        if (!isRetryableSerializationError(error) || attempt === 2) {
          throw error;
        }
        await new Promise((resolve) => setTimeout(resolve, 10 * (attempt + 1)));
      }
    }

    throw new Error('Unreachable transition retry state.');
  }

  private async recordTransitionOnce(
    command: RecordAgentOperationalTransitionCommand,
  ): Promise<RecordTransitionResult> {
    return this.dataSource.transaction('SERIALIZABLE', async (manager) => {
      const agents = manager.getRepository(LeadFlowAgentEntity);
      const states = manager.getRepository(LeadFlowAgentOperationalStateEntity);
      const outbox = manager.getRepository(OperationsRoomOutboxEntity);
      const revisions = manager.getRepository(OperationsRoomRevisionEntity);

      const agent = await agents.findOne({
        where: {
          id: command.agentId,
          tenantId: command.tenantId,
          workspaceId: command.workspaceId,
        },
      });
      if (!agent) return { kind: 'rejected', reason: 'agent-not-found' };

      const duplicate = await outbox.findOne({
        where: {
          tenantId: command.tenantId,
          workspaceId: command.workspaceId,
          source: command.source,
          sourceEventId: command.sourceEventId,
        },
      });
      if (duplicate) {
        const state = await states.findOneBy({
          tenantId: command.tenantId,
          workspaceId: command.workspaceId,
          agentId: command.agentId,
        });
        if (state) return { kind: 'duplicate', state };
      }

      let state = await states
        .createQueryBuilder('state')
        .where('state.tenant_id = :tenantId', { tenantId: command.tenantId })
        .andWhere('state.workspace_id = :workspaceId', {
          workspaceId: command.workspaceId,
        })
        .andWhere('state.agent_id = :agentId', { agentId: command.agentId })
        .setLock('pessimistic_write')
        .getOne();

      const currentRevision = BigInt(state?.agentRevision ?? '0');
      if (
        command.expectedAgentRevision !== null &&
        command.expectedAgentRevision !== undefined &&
        BigInt(command.expectedAgentRevision) !== currentRevision
      ) {
        if (!state) {
          state = this.createState(command, '0', '0');
        }
        return { kind: 'stale', current: state };
      }

      const revision = await revisions
        .createQueryBuilder('revision')
        .where('revision.tenant_id = :tenantId', { tenantId: command.tenantId })
        .andWhere('revision.workspace_id = :workspaceId', {
          workspaceId: command.workspaceId,
        })
        .setLock('pessimistic_write')
        .getOne();
      const nextRoomVersion = BigInt(revision?.roomVersion ?? '0') + 1n;
      const nextAgentRevision = currentRevision + 1n;
      const nextRevision =
        revision ??
        revisions.create({
          tenantId: command.tenantId,
          workspaceId: command.workspaceId,
          roomVersion: '0',
        });
      nextRevision.roomVersion = nextRoomVersion.toString();
      await revisions.save(nextRevision);

      state = state ?? this.createState(command, '0', '0');
      state.status = command.nextStatus;
      state.statusSince = command.occurredAt;
      state.agentRevision = nextAgentRevision.toString();
      state.roomVersion = nextRoomVersion.toString();
      state.source = command.source;
      state.sourceEventId = command.sourceEventId;
      state.reasonCode = sanitizeReasonCode(command.reasonCode);
      const savedState = await states.save(state);

      const event = outbox.create({
        eventId: randomUUID(),
        contractVersion: 1,
        tenantId: command.tenantId,
        workspaceId: command.workspaceId,
        roomVersion: nextRoomVersion.toString(),
        agentId: command.agentId,
        agentRevision: nextAgentRevision.toString(),
        eventType: 'agent.status.changed',
        occurredAt: command.occurredAt,
        source: command.source,
        sourceEventId: command.sourceEventId,
        correlationId: command.correlationId ?? null,
        payload: {
          agentId: command.agentId,
          status: command.nextStatus,
          statusSince: command.occurredAt.toISOString(),
          source: command.source,
          reasonCode: sanitizeReasonCode(command.reasonCode),
        },
        deliveryState: RoomOutboxDeliveryState.Pending,
      });
      const savedEvent = await outbox.save(event);
      return { kind: 'applied', state: savedState, event: savedEvent };
    });
  }

  async getSnapshot(
    tenantId: string,
    workspaceId: string,
    visibleAgentIds: readonly string[],
    timezone: string | null = null,
  ): Promise<OperationsRoomSnapshotResponse> {
    if (!tenantId || !workspaceId)
      throw new BadRequestException('Contexto tenant/workspace obrigatório.');
    const [states, revision] = await Promise.all([
      visibleAgentIds.length
        ? this.stateRepository.findBy(
            visibleAgentIds.map((agentId) => ({
              tenantId,
              workspaceId,
              agentId,
            })),
          )
        : Promise.resolve([]),
      this.dataSource
        .getRepository(OperationsRoomRevisionEntity)
        .findOneBy({ tenantId, workspaceId }),
    ]);
    const byAgent = new Map(states.map((state) => [state.agentId, state]));
    const generatedAt = new Date();
    return {
      contractVersion: 1,
      tenantId,
      workspaceId,
      snapshotVersion: revision?.roomVersion ?? '0',
      generatedAt: generatedAt.toISOString(),
      timezone,
      agents: [...visibleAgentIds].sort().map((agentId) => {
        const state = byAgent.get(agentId);
        return {
          agentId,
          status: state?.status ?? RoomAgentOperationalStatus.Unknown,
          statusSince: (state?.statusSince ?? UNKNOWN_SINCE).toISOString(),
          revision: state?.agentRevision ?? '0',
          source: state?.source ?? RoomOperationalSource.System,
          reasonCode: state?.reasonCode ?? null,
        };
      }),
      realtime: {
        available: this.eventBus?.isReady() ?? false,
        transport: this.eventBus?.isReady() ? 'websocket' : 'none',
        cursor: revision?.roomVersion ?? '0',
      },
    };
  }

  async listRoomEventsAfter(
    tenantId: string,
    workspaceId: string,
    roomVersion: string,
    limit = 100,
  ): Promise<RoomEventPage> {
    if (!tenantId || !workspaceId)
      throw new BadRequestException('Contexto tenant/workspace obrigatório.');
    if (!/^(0|[1-9][0-9]{0,18})$/.test(roomVersion)) {
      throw new BadRequestException('Cursor de roomVersion inválido.');
    }
    const safeLimit = Math.min(
      Math.max(Math.floor(limit), 1),
      MAX_REPLAY_LIMIT,
    );
    const [window] = await this.dataSource.query<
      Array<{ current_version: string; earliest_version: string | null }>
    >(
      `
        SELECT
          COALESCE((SELECT room_version FROM leadflow_operations_room_revision
            WHERE tenant_id = $1 AND workspace_id = $2), 0)::text AS current_version,
          (SELECT min(room_version)::text FROM leadflow_operations_room_event_outbox
            WHERE tenant_id = $1 AND workspace_id = $2) AS earliest_version
      `,
      [tenantId, workspaceId],
    );
    const requested = BigInt(roomVersion);
    const current = BigInt(window?.current_version ?? '0');
    if (requested > current) {
      throw new BadRequestException('Cursor posterior à versão atual do room.');
    }
    const earliest = window?.earliest_version
      ? BigInt(window.earliest_version)
      : null;
    if (
      requested < current &&
      (earliest === null || requested + 1n < earliest)
    ) {
      return { kind: 'snapshot_required', events: [], nextRoomVersion: null };
    }
    const events = await this.outboxRepository
      .createQueryBuilder('event')
      .where('event.tenant_id = :tenantId', { tenantId })
      .andWhere('event.workspace_id = :workspaceId', { workspaceId })
      .andWhere('event.room_version > :roomVersion', { roomVersion })
      .orderBy('event.room_version', 'ASC')
      .take(safeLimit)
      .getMany();
    return {
      kind: 'events',
      events: events.map(mapOperationsRoomOutboxEvent),
      nextRoomVersion: events.at(-1)?.roomVersion ?? null,
    };
  }

  private createState(
    command: RecordAgentOperationalTransitionCommand,
    agentRevision: string,
    roomVersion: string,
  ) {
    return this.stateRepository.create({
      tenantId: command.tenantId,
      workspaceId: command.workspaceId,
      agentId: command.agentId,
      status: RoomAgentOperationalStatus.Unknown,
      statusSince: command.occurredAt,
      agentRevision,
      roomVersion,
      source: RoomOperationalSource.System,
      sourceEventId: null,
      reasonCode: null,
    });
  }

  private isValidTransitionSource(
    status: RoomAgentOperationalStatus,
    source: RoomOperationalSource,
  ) {
    if (!ROOM_OPERATIONAL_STATUS_VALUES.includes(status)) return false;
    if (!ROOM_OPERATIONAL_SOURCE_VALUES.includes(source)) return false;
    return roomStatusSourceAllowed(status, source);
  }
}

export function sanitizeReasonCode(value?: string | null) {
  if (!value || !/^[a-z0-9_.:-]{1,80}$/i.test(value)) return null;
  return value;
}

export function roomStatusSourceAllowed(
  status: RoomAgentOperationalStatus,
  source: RoomOperationalSource,
) {
  const allowed: Record<RoomAgentOperationalStatus, RoomOperationalSource[]> = {
    unknown: [RoomOperationalSource.System],
    available: [RoomOperationalSource.AgentRuntime],
    handling_conversation: [RoomOperationalSource.AgentRuntime],
    handoff_requested: [
      RoomOperationalSource.Inbox,
      RoomOperationalSource.Handoff,
    ],
    paused: [RoomOperationalSource.AgentRuntime],
    error: [RoomOperationalSource.AgentRuntime],
    meeting: [RoomOperationalSource.Meeting],
    reporting: [RoomOperationalSource.Reporting],
    offline: [RoomOperationalSource.AgentRuntime],
  };
  return allowed[status]?.includes(source) ?? false;
}

function isRetryableSerializationError(error: unknown) {
  const code =
    typeof error === 'object' && error !== null && 'code' in error
      ? (error as { code?: unknown }).code
      : null;
  return code === '40001' || code === '40P01';
}
