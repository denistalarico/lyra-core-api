export const OPERATIONS_ROOM_NAMESPACE = '/operations-room';
export const OPERATIONS_ROOM_PG_CHANNEL = 'lyra_operations_room_v1';
export const OPERATIONS_ROOM_SOCKET_EVENT = 'operations-room.event';
export const OPERATIONS_ROOM_READY_EVENT = 'operations-room.ready';
export const OPERATIONS_ROOM_RESYNC_EVENT = 'operations-room.resync-required';

export function operationsRoomRealtimeEnabled(): boolean {
  return process.env.OPERATIONS_ROOM_REALTIME_ENABLED === 'true';
}

export function operationsRoomContextRoom(
  tenantId: string,
  workspaceId: string,
): string {
  return `operations-room:v1:${tenantId}:${workspaceId}`;
}
