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
/** Owned by the consumer; ClientAreaModule registers at init. Absence is fail-closed. */
@Injectable()
export class ClientAreaBridgeRegistry {
  private bridge?: ClientAreaBridgePort;
  private readonly scopeResolvers = new Map<
    ClientAreaModuleKey,
    ClientAreaScopeResolver
  >();
  registerScopeResolver(
    module: ClientAreaModuleKey,
    resolver: ClientAreaScopeResolver,
  ) {
    const current = this.scopeResolvers.get(module);
    if (current && current !== resolver)
      throw new Error(
        `Client Area scope resolver already registered: ${module}`,
      );
    this.scopeResolvers.set(module, resolver);
  }
  resolveScope(
    module: ClientAreaModuleKey,
    context: ClientAreaContext,
    permissionKey: string,
    request: PermissionScopeRequest,
  ) {
    return (
      this.scopeResolvers.get(module)?.(context, permissionKey, request) ??
      Promise.resolve(null)
    );
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
