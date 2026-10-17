import {
  ForbiddenException,
  Injectable,
  UnauthorizedException,
  type ExecutionContext,
} from '@nestjs/common';
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
  ) {}
  async authenticate(execution: ExecutionContext): Promise<boolean> {
    const module = this.reflector.get<ClientAreaModuleKey | undefined>(
      CLIENT_AREA_EXPOSED_METADATA,
      execution.getHandler(),
    );
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
}
