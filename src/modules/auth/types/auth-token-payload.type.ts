export interface AuthTokenPayload {
  sub: string;
  tenantId: string;
  workspaceId: string;
  role: string;
  sessionId: string;
  email: string;
}
