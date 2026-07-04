// src/common/context/request-context.interface.ts
export type ProductKey = 'agency' | 'leadflow' | 'social';
export type OperatingMode = 'agency' | 'client';

export interface ManagedContext {
  productKey: ProductKey;
  operatingMode: OperatingMode;
  clientId: string | null;
  managedTenantId: string | null;
  clientName?: string | null;
}

export interface RequestContext {
  tenantId: string;
  workspaceId?: string;
  userId?: string;
  sessionId?: string;
  role?: string;
  managedContext?: ManagedContext;
}
