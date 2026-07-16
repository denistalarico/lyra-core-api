import type {
  RoomAgentOperationalStatus,
  RoomOperationalSource,
} from '../enums/room-operational.enums';

export interface RecordAgentOperationalTransitionCommand {
  tenantId: string;
  workspaceId: string;
  agentId: string;
  nextStatus: RoomAgentOperationalStatus;
  occurredAt: Date;
  source: RoomOperationalSource;
  sourceEventId: string;
  reasonCode?: string | null;
  correlationId?: string | null;
  expectedAgentRevision?: string | null;
}

export type RoomTransitionRejection =
  | 'invalid-context'
  | 'agent-not-found'
  | 'invalid-status-source'
  | 'stale-revision';

export type RecordTransitionResult =
  | {
      kind: 'applied';
      state: import('../entities').LeadFlowAgentOperationalStateEntity;
      event: import('../entities').OperationsRoomOutboxEntity;
    }
  | {
      kind: 'duplicate';
      state: import('../entities').LeadFlowAgentOperationalStateEntity;
    }
  | {
      kind: 'stale';
      current: import('../entities').LeadFlowAgentOperationalStateEntity;
    }
  | { kind: 'rejected'; reason: RoomTransitionRejection };

export interface OperationsRoomEventEnvelope {
  contractVersion: 1;
  eventId: string;
  eventType: 'agent.status.changed';
  occurredAt: string;
  tenantId: string;
  workspaceId: string;
  roomVersion: number;
  agentRevision: number;
  correlationId: string | null;
  payload: {
    agentId: string;
    status: RoomAgentOperationalStatus;
    statusSince: string;
    source: RoomOperationalSource;
    reasonCode: string | null;
  };
}

export interface OperationsRoomSnapshotResponse {
  contractVersion: 1;
  tenantId: string;
  workspaceId: string;
  snapshotVersion: number;
  generatedAt: string;
  timezone: string | null;
  agents: Array<{
    agentId: string;
    status: RoomAgentOperationalStatus;
    statusSince: string;
    revision: number;
    source: RoomOperationalSource;
    reasonCode: string | null;
  }>;
  realtime: {
    available: false;
    transport: 'none';
    cursor: string | null;
  };
}

export interface RoomEventPage {
  kind: 'events' | 'snapshot_required';
  events: OperationsRoomEventEnvelope[];
  nextRoomVersion: number | null;
}
