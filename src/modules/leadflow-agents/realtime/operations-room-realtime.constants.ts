export const OPERATIONS_ROOM_NAMESPACE = '/operations-room';
export const OPERATIONS_ROOM_PG_CHANNEL = 'lyra_operations_room_v1';
export const OPERATIONS_ROOM_SOCKET_EVENT = 'operations-room.event';
export const OPERATIONS_ROOM_READY_EVENT = 'operations-room.ready';
export const OPERATIONS_ROOM_RESYNC_EVENT = 'operations-room.resync-required';

export function operationsRoomRealtimeEnabled(): boolean {
  return process.env.OPERATIONS_ROOM_REALTIME_ENABLED === 'true';
}

export type OperationsRoomScope =
  | { scopeKind: 'agency'; agencyClientId: null; companyContextId: null }
  | {
      scopeKind: 'company';
      agencyClientId: string;
      companyContextId: string;
    };

/**
 * Centralized room key so no caller builds the string by hand. Mirrors the
 * `inboxRoom` shape from CC2E: agency mode keeps the tenant/workspace-wide
 * room, client mode adds AgencyClient + Company Context so Company A and
 * Company B of the same client never share a room.
 */
export function operationsRoomKey(
  tenantId: string,
  workspaceId: string,
  scope: OperationsRoomScope,
): string {
  return scope.scopeKind === 'agency'
    ? `operations-room:v1:${tenantId}:${workspaceId}:agency`
    : `operations-room:v1:${tenantId}:${workspaceId}:company:${scope.agencyClientId}:${scope.companyContextId}`;
}
