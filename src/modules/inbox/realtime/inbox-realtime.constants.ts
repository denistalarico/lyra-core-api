export const INBOX_REALTIME_NAMESPACE = '/inbox';
export const INBOX_REALTIME_EVENT = 'inbox.event';
export const INBOX_REALTIME_READY = 'inbox.ready';
export const INBOX_REALTIME_RESYNC = 'inbox.resync';
export const INBOX_PG_CHANNEL = 'lyra_inbox_realtime_v1';
export const inboxRoom = (
  tenantId: string,
  workspaceId: string,
  scope:
    | { scopeKind: 'agency'; agencyClientId: null; companyContextId: null }
    | {
        scopeKind: 'company';
        agencyClientId: string;
        companyContextId: string;
      },
) =>
  scope.scopeKind === 'agency'
    ? `inbox:${tenantId}:${workspaceId}:agency`
    : `inbox:${tenantId}:${workspaceId}:company:${scope.agencyClientId}:${scope.companyContextId}`;
