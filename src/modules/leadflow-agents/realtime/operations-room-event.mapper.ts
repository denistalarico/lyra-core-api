import { OperationsRoomOutboxEntity } from '../entities';
import {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../enums/room-operational.enums';
import type { OperationsRoomEventEnvelope } from '../types/operations-room.types';
import type { OperationsRoomScope } from './operations-room-realtime.constants';

export function mapOperationsRoomOutboxEvent(
  event: OperationsRoomOutboxEntity,
  scope: OperationsRoomScope,
): OperationsRoomEventEnvelope {
  const payload = event.payload as Record<string, unknown>;
  return {
    contractVersion: 1,
    eventId: event.eventId,
    eventType: 'agent.status.changed',
    occurredAt: event.occurredAt.toISOString(),
    tenantId: event.tenantId,
    workspaceId: event.workspaceId,
    scopeKind: scope.scopeKind,
    agencyClientId: scope.agencyClientId,
    companyContextId: scope.companyContextId,
    roomVersion: event.roomVersion,
    agentRevision: event.agentRevision ?? '0',
    correlationId: event.correlationId,
    payload: {
      agentId: String(payload.agentId),
      status: payload.status as RoomAgentOperationalStatus,
      statusSince: String(payload.statusSince),
      source: payload.source as RoomOperationalSource,
      reasonCode: (payload.reasonCode as string | null) ?? null,
    },
  };
}
