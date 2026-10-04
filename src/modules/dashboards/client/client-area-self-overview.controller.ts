import { Controller, Get, UseGuards } from '@nestjs/common';
import {
  ClientAreaSelfContextData,
  RequireClientAreaPermission,
} from '../../client-area/client-area.decorators';
import type { ClientAreaSelfContext } from '../../client-area/client-area.types';
import {
  ClientAreaAuthGuard,
  ClientAreaEnabledGuard,
  ClientAreaSelfContextGuard,
} from '../../client-area/guards/client-area.guards';
import { ClientAreaSelfOverviewService } from './client-area-self-overview.service';

/**
 * PD4 — `GET /client-area/self/overview`, the executive landing of the agency
 * self-context.
 *
 * AUTHORIZATION, AND WHAT IS NOT ACCEPTED
 * ---------------------------------------
 * Three guards, in order (§18):
 *
 *   `ClientAreaEnabledGuard`     the whole surface 404s when the platform gate
 *                                is off — hiding the UI is not enough;
 *   `ClientAreaAuthGuard`        Client Area JWT (own secret, `typ`
 *                                `client_area`) + live `surface='client_area'`
 *                                session + the Agency application gate;
 *   `ClientAreaSelfContextGuard` active self access, the agency's Client Area
 *                                on, its self-context on, and the person still
 *                                an eligible Owner/Admin — re-evaluated on
 *                                this request, never cached from login.
 *
 * The method takes **no parameter of any kind**: no body, no query, no path
 * segment. There is nothing for a caller to forge, because `tenantId`,
 * `workspaceId` and `userId` are read from the self access row the guard just
 * validated (§20). A request carrying `tenantId`, `workspaceId`, `clientId` or
 * `companyContextId` is not rejected — those values are simply never read, in
 * any code path, which is the stronger property.
 *
 * An Agency JWT cannot reach this handler: it fails `ClientAreaAuthGuard`,
 * whose strategy verifies a different secret and requires
 * `typ='client_area'`. An external client's token authenticates but has no
 * self access, so the self guard answers the same generic 404 as every other
 * broken link in the chain (PD3 §28 — nothing is enumerable).
 */
@Controller('client-area/self')
@UseGuards(
  ClientAreaEnabledGuard,
  ClientAreaAuthGuard,
  ClientAreaSelfContextGuard,
)
export class ClientAreaSelfOverviewController {
  constructor(private readonly overview: ClientAreaSelfOverviewService) {}

  @Get('overview')
  @RequireClientAreaPermission('client_area.self.overview.view')
  get(@ClientAreaSelfContextData() context: ClientAreaSelfContext) {
    return this.overview.getOverview(context);
  }
}
