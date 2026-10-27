import { Injectable, type OnModuleInit } from '@nestjs/common';
import { ClientAreaBridgeRegistry } from '../../common/client-area-bridge/client-area-bridge.registry';
import type { ClientAreaContext } from '../client-area/client-area.types';
import type { PermissionScopeRequest } from '../permissions/types/permission-context.types';
import { OVERVIEW_HEADER_READ_PERMISSIONS } from './analytics-overview-header.controller';

/** CA-AN1 — the one shared Analytics route without a product of its own. */
export const ANALYTICS_OVERVIEW_HEADER_CLIENT_ROUTE =
  'GET /analytics/overview-header';

/**
 * CA-AN1 — scope of the shared Visão Geral header for the Client Area
 * `analytics` module. The header is a company document read with the forced
 * membership scope (`resolveCompanyAwareScope`); there is no id to prove, so
 * the answer is the membership's own company, for this one read only.
 */
export function resolveOverviewHeaderScope(
  context: ClientAreaContext,
  permissionKey: string,
  request: PermissionScopeRequest,
) {
  const method = request.method === 'HEAD' ? 'GET' : request.method;
  const path = (request.routePath ?? '').replace(/^\/api(?=\/)/, '');
  if (
    `${method} ${path}` !== ANALYTICS_OVERVIEW_HEADER_CLIENT_ROUTE ||
    !(OVERVIEW_HEADER_READ_PERMISSIONS as readonly string[]).includes(
      permissionKey,
    )
  )
    return Promise.resolve(null);
  return Promise.resolve({
    tenantId: context.tenantId,
    workspaceId: context.workspaceId,
    agencyClientId: context.agencyClientId,
    companyContextId: context.companyContextId,
    createdById: null,
  });
}

@Injectable()
export class AnalyticsOverviewClientAreaScope implements OnModuleInit {
  constructor(private readonly registry: ClientAreaBridgeRegistry) {}
  onModuleInit() {
    this.registry.registerScopeResolver(
      'analytics',
      resolveOverviewHeaderScope,
    );
  }
}
