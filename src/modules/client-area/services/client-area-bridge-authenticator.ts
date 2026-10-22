import {
  ForbiddenException,
  Injectable,
  Optional,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
import { ClientAreaSelfAccessService } from './client-area-self-access.service';
import { isClientAreaSelfModulesEnabled } from '../client-area-self-modules';
import { AGENCY_SELF_CONTEXT_ID } from '../client-area.types';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { AgencyClient } from '../../clients/entities/agency-client.entity';
import { ClientAreaAuthGuard } from '../guards/client-area.guards';
import { ClientAreaAuthorizationService } from './client-area-authorization.service';
import {
  CLIENT_AREA_EXPOSED_METADATA,
  type ClientAreaBridgePort,
} from '../../../common/client-area-bridge/client-area-bridge.registry';
import { PRODUCT_ENTITLEMENT_METADATA } from '../../permissions/decorators/permissions.decorators';
import type {
  ClientAreaModuleKey,
  ClientAreaRequest,
} from '../client-area.types';
import type { AuthenticatedRequest } from '../../auth/types/authenticated-request.type';
import type { ProductKey } from '../../../common/context/request-context.interface';

export function clientAreaModuleProduct(
  module: ClientAreaModuleKey,
): ProductKey {
  return module === 'approvals' || module.startsWith('social_')
    ? 'social'
    : module.startsWith('leadflow_')
      ? 'leadflow'
      : 'agency';
}
@Injectable()
export class ClientAreaBridgeAuthenticator implements ClientAreaBridgePort {
  constructor(
    private readonly config: ConfigService,
    private readonly guard: ClientAreaAuthGuard,
    private readonly authorization: ClientAreaAuthorizationService,
    private readonly reflector: Reflector,
    @InjectRepository(AgencyClient, 'agency')
    private readonly clients: Repository<AgencyClient>,
    @Optional() private readonly selfAccess?: ClientAreaSelfAccessService,
  ) {}
  async authenticate(execution: ExecutionContext): Promise<boolean> {
    const module = this.reflector.get<ClientAreaModuleKey | undefined>(
      CLIENT_AREA_EXPOSED_METADATA,
      execution.getHandler(),
    );
    if (
      module &&
      execution.switchToHttp().getRequest<ClientAreaRequest>().headers[
        'x-lyra-client-area-company'
      ] === AGENCY_SELF_CONTEXT_ID
    )
      return this.authenticateSelf(execution, module);
    if (
      !module ||
      this.config
        .get<string>('CLIENT_AREA_BRIDGE_ENABLED')
        ?.trim()
        .toLowerCase() !== 'true'
    )
      throw new UnauthorizedException();
    await this.guard.canActivate(execution);
    const req = execution
      .switchToHttp()
      .getRequest<ClientAreaRequest & AuthenticatedRequest>();
    const context = await this.authorization.authorize({
      identity: req.clientAreaIdentity!,
      companyContextId: req.headers['x-lyra-client-area-company'],
      module,
    });
    if (
      !context.memberAccess?.[module]?.available ||
      !context.memberAccess[module].level
    )
      throw new ForbiddenException('Module is unavailable.');
    const product =
      this.reflector.getAllAndOverride<ProductKey | undefined>(
        PRODUCT_ENTITLEMENT_METADATA,
        [execution.getHandler(), execution.getClass()],
      ) ?? 'agency';
    if (product !== clientAreaModuleProduct(module))
      throw new ForbiddenException(
        'Route product does not match the exposed module.',
      );
    const client = await this.clients.findOne({
      where: {
        id: context.agencyClientId,
        tenantId: context.tenantId,
        workspaceId: context.workspaceId,
      },
    });
    if (!client) throw new UnauthorizedException();
    for (const key of Object.keys(req.headers))
      if (key.toLowerCase().startsWith('x-')) delete req.headers[key];
    req.clientAreaContext = context;
    req.user = {
      surface: 'client_area',
      sub: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      sessionId: context.sessionId,
      email: req.clientAreaIdentity!.email,
      role: 'client_area_actor',
    };
    req.managedContext = {
      operatingMode: 'client',
      clientId: context.agencyClientId,
      companyContextId: context.companyContextId,
      managedTenantId: client.managedTenantId,
      productKey: product,
    };
    return true;
  }

  /**
   * CA15 / D-CA15-1 — the agency in its own Client Area. Same exposed routes,
   * but over the agency's own data: the operator acts with the Agency role
   * re-validated by `resolveSelfContext` and the Agency operating mode. No
   * company scope is synthesized (PD3 §18).
   */
  private async authenticateSelf(
    execution: ExecutionContext,
    module: ClientAreaModuleKey,
  ): Promise<boolean> {
    if (!this.selfAccess || !isClientAreaSelfModulesEnabled(this.config))
      throw new UnauthorizedException();
    await this.guard.canActivate(execution);
    const req = execution
      .switchToHttp()
      .getRequest<ClientAreaRequest & AuthenticatedRequest>();
    const context = await this.selfAccess.resolveSelfContext(
      req.clientAreaIdentity!,
    );
    if (!context) throw new UnauthorizedException();
    if (!context.memberAccess?.[module]?.available)
      throw new ForbiddenException('Module is unavailable.');
    const product =
      this.reflector.getAllAndOverride<ProductKey | undefined>(
        PRODUCT_ENTITLEMENT_METADATA,
        [execution.getHandler(), execution.getClass()],
      ) ?? 'agency';
    if (product !== clientAreaModuleProduct(module))
      throw new ForbiddenException(
        'Route product does not match the exposed module.',
      );
    for (const key of Object.keys(req.headers))
      if (key.toLowerCase().startsWith('x-')) delete req.headers[key];
    req.clientAreaSelfContext = context;
    req.user = {
      sub: context.userId,
      tenantId: context.tenantId,
      workspaceId: context.workspaceId,
      sessionId: context.sessionId,
      email: req.clientAreaIdentity!.email,
      role: context.agencyRole,
    };
    req.managedContext = {
      operatingMode: 'agency',
      clientId: null,
      companyContextId: null,
      managedTenantId: null,
      productKey: product,
    };
    return true;
  }
}
