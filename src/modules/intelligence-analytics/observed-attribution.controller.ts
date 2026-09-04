import {
  BadRequestException,
  Controller,
  ForbiddenException,
  Get,
  NotFoundException,
  Param,
  ParseUUIDPipe,
  UseGuards,
} from '@nestjs/common';
import { RequestContextData } from '../../common/context/request-context.decorator';
import type { RequestContext } from '../../common/context/request-context.interface';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { PermissionsGuard, RequirePermission } from '../permissions';
import { PlatformPermissionService } from '../permissions/services/platform-permission.service';
import { ObservedAttributionService } from './observed-attribution.service';

/**
 * Both entitlements, for the reason the cohort endpoint gives.
 *
 * This response is more explicitly cross-product than I3's: it names an ad, a
 * campaign and an account from Social in the same object as a conversation and
 * an opportunity from LeadFlow. A tenant entitled to only one of the two would
 * read the other's data out of an endpoint whose path mentions neither.
 */
const REQUIRED_PRODUCTS = ['social', 'leadflow'] as const;

/** Both operational read permissions — see the cohort controller. */
const REQUIRED_PERMISSIONS = [
  'social.analytics.reports.view.operational',
  'leadflow.analytics.reports.view.operational',
] as const;

/**
 * One conversation's observed attribution.
 *
 * ## Why a single-conversation endpoint, and only that
 *
 * The smallest surface that makes the bridge usable. A listing endpoint —
 * "every attributed conversation for this ad, this period" — is a different
 * feature with different questions attached (pagination, windowing, ordering,
 * and the aggregate semantics that come with them), and building it now would
 * mean answering them before there is a single production observation to
 * validate against. The individual lookup is complete and correct on its own,
 * and is what a future listing would be composed from.
 *
 * ## Scope comes from context, never from the request
 *
 * There is no client parameter. The conversation id is the only input, and it
 * is resolved *inside* the caller's own scope — a conversation belonging to
 * another client is not found, rather than found and refused. That keeps the
 * endpoint usable unchanged by a future Client Area, where the managed context
 * simply is the client.
 */
@Controller('intelligence/attribution')
export class ObservedAttributionController {
  constructor(
    private readonly attribution: ObservedAttributionService,
    private readonly permissionService: PlatformPermissionService,
  ) {}

  @Get('conversations/:conversationId')
  @UseGuards(JwtAuthGuard, PermissionsGuard)
  // Only one key can be declared: `RequirePermission` is `SetMetadata` under a
  // single key, so a second decorator would overwrite this one. The second is
  // asserted in code below, exactly as the cohort endpoint does.
  @RequirePermission(REQUIRED_PERMISSIONS[0])
  async conversation(
    @RequestContextData() ctx: RequestContext,
    @Param('conversationId', new ParseUUIDPipe()) conversationId: string,
  ) {
    const scope = this.requireScope(ctx);

    await this.requireCrossDomainAccess(ctx);

    const view = await this.attribution.conversation(scope, conversationId);

    /**
     * The same 404 for "no such conversation" and "not yours".
     *
     * A 403 here would confirm that the id names a real conversation in some
     * other tenant, which is the one bit an enumerator needs.
     */
    if (!view) {
      throw new NotFoundException('Conversation not found.');
    }

    return view;
  }

  /** Both entitlements and both permissions, before any domain is read. */
  private async requireCrossDomainAccess(ctx: RequestContext): Promise<void> {
    if (!ctx.tenantId || !ctx.userId || !ctx.role) {
      throw new BadRequestException('Authenticated context is required.');
    }

    const permissionContext = {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      userId: ctx.userId,
      role: ctx.role,
    };

    for (const productKey of REQUIRED_PRODUCTS) {
      const allowed = await this.permissionService.canAccessProduct(
        permissionContext,
        productKey,
      );

      if (!allowed) {
        throw new ForbiddenException(
          `Product "${productKey}" is not enabled for this tenant.`,
        );
      }
    }

    await this.permissionService.assertCan(
      permissionContext,
      REQUIRED_PERMISSIONS[1],
    );
  }

  /**
   * The authenticated scope, with the managed client resolved from context.
   *
   * Identical to the cohort controller's, deliberately: two endpoints that
   * resolved "which client is this?" differently would eventually disagree, and
   * the disagreement would surface as one client's conversation under
   * another's name.
   */
  private requireScope(ctx: RequestContext) {
    if (!ctx.tenantId || !ctx.workspaceId) {
      throw new BadRequestException(
        'Tenant and workspace context are required.',
      );
    }

    const managedContext = ctx.managedContext;
    const agencyClientId =
      managedContext?.operatingMode === 'client'
        ? (managedContext.clientId ?? null)
        : null;

    if (managedContext?.operatingMode === 'client' && !agencyClientId) {
      throw new BadRequestException('Client context is required.');
    }

    return {
      tenantId: ctx.tenantId,
      workspaceId: ctx.workspaceId,
      agencyClientId,
    };
  }
}
