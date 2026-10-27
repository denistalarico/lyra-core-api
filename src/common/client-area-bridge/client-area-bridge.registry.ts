import type {
  ClientAreaContext,
  ClientAreaModuleKey,
} from '../../modules/client-area/client-area.types';
import type { PermissionScopeRequest } from '../../modules/permissions/types/permission-context.types';
import {
  Global,
  Injectable,
  Module,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
export const CLIENT_AREA_EXPOSED_METADATA = 'client_area:exposed';
/**
 * CA-AN1 — the modules a handler is exposed to, in declaration order. The
 * metadata is an array since CA-AN1; a bare string (older decorator) still
 * reads as one module.
 */
export function clientAreaExposedModules(
  metadata: unknown,
): ClientAreaModuleKey[] {
  if (typeof metadata === 'string') return [metadata as ClientAreaModuleKey];
  return Array.isArray(metadata) ? (metadata as ClientAreaModuleKey[]) : [];
}
export interface ClientAreaBridgePort {
  authenticate(context: ExecutionContext): Promise<boolean>;
}
/** A product resolves the row; the shared evaluator still proves the exact membership grain. */
export type ClientAreaScopedResource = {
  tenantId: string;
  workspaceId: string;
  agencyClientId: string;
  companyContextId: string;
  createdById: string | null;
};
export type ClientAreaScopeResolver = (
  context: ClientAreaContext,
  permissionKey: string,
  request: PermissionScopeRequest,
) => Promise<ClientAreaScopedResource | null>;
export type ClientAreaActorNamesResolver = (
  tenantId: string,
  userIds: readonly string[],
) => Promise<Record<string, string>>;
/**
 * Owned by the consumer; ClientAreaModule registers at init. Absence is
 * fail-closed. A module may have several resolvers (CA-AN1: `analytics`
 * spans the Social, LeadFlow, CA13 and header tables); each answers only for
 * its own route table, and the first non-null answer wins.
 */
@Injectable()
export class ClientAreaBridgeRegistry {
  private bridge?: ClientAreaBridgePort;
  private actorNames?: ClientAreaActorNamesResolver;
  registerActorDirectory(resolver: ClientAreaActorNamesResolver) {
    this.actorNames = resolver;
  }
  resolveActorNames(
    tenantId: string,
    userIds: readonly string[],
  ): Promise<Record<string, string>> {
    return this.actorNames?.(tenantId, userIds) ?? Promise.resolve({});
  }
  private readonly scopeResolvers = new Map<
    ClientAreaModuleKey,
    ClientAreaScopeResolver[]
  >();
  registerScopeResolver(
    module: ClientAreaModuleKey,
    resolver: ClientAreaScopeResolver,
  ) {
    const current = this.scopeResolvers.get(module) ?? [];
    if (!current.includes(resolver))
      this.scopeResolvers.set(module, [...current, resolver]);
  }
  async resolveScope(
    module: ClientAreaModuleKey,
    context: ClientAreaContext,
    permissionKey: string,
    request: PermissionScopeRequest,
  ): Promise<ClientAreaScopedResource | null> {
    for (const resolver of this.scopeResolvers.get(module) ?? []) {
      const resource = await resolver(context, permissionKey, request);
      if (resource) return resource;
    }
    return null;
  }
  register(bridge: ClientAreaBridgePort) {
    if (this.bridge && this.bridge !== bridge)
      throw new Error('Client Area bridge already registered.');
    this.bridge = bridge;
  }
  authenticate(context: ExecutionContext) {
    if (!this.bridge) throw new UnauthorizedException();
    return this.bridge.authenticate(context);
  }
}
@Global()
@Module({
  providers: [ClientAreaBridgeRegistry],
  exports: [ClientAreaBridgeRegistry],
})
export class ClientAreaBridgeRegistryModule {}
