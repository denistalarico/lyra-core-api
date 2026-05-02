// src/common/context/request-context.interface.ts
export interface RequestContext {
  tenantId: string;
  workspaceId?: string;
  userId?: string;
  sessionId?: string;
  role?: string;
}
