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
  clientAreaExposedModules,
  type ClientAreaBridgePort,
} from '../../../common/client-area-bridge/client-area-bridge.registry';
import { PRODUCT_ENTITLEMENT_METADATA } from '../../permissions/decorators/permissions.decorators';
import type {
  ClientAreaMemberAccess,
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

/**
 * CA-AN1 — whether `module` may serve a route declaring `product`
 * (`undefined` = no `@RequireProductEntitlement`). `analytics` reaches the
 * LeadFlow/Social routes of the products active for the company, the CA13
 * facade (`agency`) and product-less shared routes (the Visão Geral header)
 * when at least one product is active. Every other module keeps its single
 * product.
 */
export function clientAreaModuleServesProduct(
  module: ClientAreaModuleKey,
  product: ProductKey | undefined,
  analyticsProducts: readonly string[] = [],
): boolean {
  if (module !== 'analytics')
    return (product ?? 'agency') === clientAreaModuleProduct(module);
  if (product === undefined) return analyticsProducts.length > 0;
  return product === 'agency' || analyticsProducts.includes(product);
}

/** First exposed module the member can use for the route's product. */
function chooseModule(
  modules: readonly ClientAreaModuleKey[],
  memberAccess: Partial<ClientAreaMemberAccess> | undefined,
  product: ProductKey | undefined,
  analyticsProducts?: readonly string[],
): ClientAreaModuleKey {
  const usable = modules.filter(
    (module) =>
      memberAccess?.[module]?.available && memberAccess[module]?.level,
  );
  if (!usable.length) throw new ForbiddenException('Module is unavailable.');
  const module = usable.find((candidate) =>
    clientAreaModuleServesProduct(candidate, product, analyticsProducts),
  );
  if (!module)
    throw new ForbiddenException(
      'Route product does not match the exposed module.',
    );
  return module;
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
    const modules = clientAreaExposedModules(
      this.reflector.get<unknown>(
        CLIENT_AREA_EXPOSED_METADATA,
        execution.getHandler(),
      ),
    );
    if (
      modules.length &&
      execution.switchToHttp().getRequest<ClientAreaRequest>().headers[
        'x-lyra-client-area-company'
      ] === AGENCY_SELF_CONTEXT_ID
    )
      return this.authenticateSelf(execution, modules);
    if (
      !modules.length ||
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
    // One module keeps the per-module company check (and its error code);
    // several are resolved below against the member's access.
    const context = await this.authorization.authorize({
      identity: req.clientAreaIdentity!,
      companyContextId: req.headers['x-lyra-client-area-company'],
      module: modules.length === 1 ? modules[0] : null,
    });
    const declared = this.reflector.getAllAndOverride<ProductKey | undefined>(
      PRODUCT_ENTITLEMENT_METADATA,
      [execution.getHandler(), execution.getClass()],
    );
    const module = chooseModule(
      modules,
      context.memberAccess,
      declared,
      context.analyticsProducts,
    );
    // A product-less Analytics route (the shared header) runs in the context
    // of a product the company has, so product-aware code sees LeadFlow or
    // Social, never `agency`.
    const product: ProductKey =
      declared ??
      (module === 'analytics' ? context.analyticsProducts![0] : 'agency');
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
    req.clientAreaModule = module;
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
    modules: readonly ClientAreaModuleKey[],
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
    const declared = this.reflector.getAllAndOverride<ProductKey | undefined>(
      PRODUCT_ENTITLEMENT_METADATA,
      [execution.getHandler(), execution.getClass()],
    );
    // The self-context has no company products: `analytics` keeps its
    // CA13 meaning (`agency`) here.
    const module = chooseModule(
      modules,
      context.memberAccess,
      declared ?? 'agency',
    );
    const product: ProductKey = declared ?? 'agency';
    for (const key of Object.keys(req.headers))
      if (key.toLowerCase().startsWith('x-')) delete req.headers[key];
    req.clientAreaSelfContext = context;
    req.clientAreaModule = module;
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
