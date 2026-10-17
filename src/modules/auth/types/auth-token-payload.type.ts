export interface AuthTokenPayload {
  surface?: 'client_area';
  sub: string;
  tenantId: string;
  workspaceId: string;
  role: string;
  sessionId: string;
  email: string;
}
