export enum RoomAgentOperationalStatus {
  Unknown = 'unknown',
  Available = 'available',
  HandlingConversation = 'handling_conversation',
  HandoffRequested = 'handoff_requested',
  Paused = 'paused',
  Error = 'error',
  Meeting = 'meeting',
  Reporting = 'reporting',
  Offline = 'offline',
}

export enum RoomOperationalSource {
  System = 'system',
  AgentRuntime = 'agent-runtime',
  Inbox = 'inbox',
  Handoff = 'handoff',
  Meeting = 'meeting',
  Reporting = 'reporting',
}

export enum RoomOutboxDeliveryState {
  Pending = 'pending',
}

export const ROOM_OPERATIONAL_STATUS_VALUES = Object.values(
  RoomAgentOperationalStatus,
);

export const ROOM_OPERATIONAL_SOURCE_VALUES = Object.values(
  RoomOperationalSource,
);
